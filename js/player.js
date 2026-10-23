// 音を鳴らす仕組み
//
// タイマーで音を小さくする・止める・合図音を鳴らす動作は、すべて「音の側の時計」
// （AudioContext の時刻）にあらかじめ予約する。iPhone で画面を消すとプログラムの
// 時計は遅れることがあるが、音の側の時計は遅れないため。

import { encodeWav } from './noise.js';

const FADE_SECONDS = 0.3;
const PHASE_FADE_SECONDS = 3;
const POMODORO_CYCLES = 24;

// iPhone のマナーモードでも鳴るようにする（対応している iOS のみ）
function preferPlayback() {
  if ('audioSession' in navigator) navigator.audioSession.type = 'playback';
}

function safeStop(node, at) {
  try {
    node.stop(at);
  } catch {
    // すでに停止を予約済み
  }
}

// 本番の鳴らし方（方式1：Web Audio API）
//   音 → 音ごとの補正 → envelope（タイマーによる増減）→ [高音カット] → master（音量）→ スピーカー
//   合図音 → master
export class SoundEngine {
  // onInterrupted: ロック画面の停止ボタンや電話などで、iPhone 側に音を止められたときに呼ぶ
  constructor(log, { onInterrupted } = {}) {
    this.log = log;
    this.onInterrupted = onInterrupted;
    this.ctx = null;
    this.session = null;
  }

  // iPhone では、音を出す準備は画面を押した瞬間にしかできないため、
  // 音声ファイルの読み込みを待つ前にこれを呼ぶ
  unlock() {
    preferPlayback();
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.onstatechange = () => {
        this.log(`音の状態: ${this.ctx.state}`);
        this.checkInterrupted();
      };
    }
    this.ctx.resume();
    return this.ctx;
  }

  start(buffer, { volume, lowpassHz, sourceGain = 1 }) {
    this.unlock();
    this.stop();

    const ctx = this.ctx;
    const t = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, t);
    envelope.gain.linearRampToValueAtTime(1, t + FADE_SECONDS);

    if (lowpassHz) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpassHz;
      envelope.connect(filter).connect(master);
    } else {
      envelope.connect(master);
    }

    this.session = { envelope, master, startTime: t, current: null, sources: [] };
    this.queue(buffer, 0, sourceGain);
  }

  // 再生開始から offset 秒の時点で、今の音から buffer の音へ切り替える。
  // crossfade 秒をかけて、前の音を小さく・次の音を大きくしていく
  queue(buffer, offset, sourceGain = 1, crossfade = 0) {
    const s = this.session;
    if (!s) return;
    const at = s.startTime + offset;
    const fade = s.current ? crossfade : 0;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(fade ? 0 : sourceGain, at);
    if (fade) gain.gain.linearRampToValueAtTime(sourceGain, at + fade);
    gain.connect(s.envelope);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start(at);

    if (s.current) {
      if (fade) {
        s.currentGain.gain.setValueAtTime(s.currentLevel, at);
        s.currentGain.gain.linearRampToValueAtTime(0, at + fade);
      }
      safeStop(s.current, at + fade);
    }
    s.current = source;
    s.currentGain = gain;
    s.currentLevel = sourceGain;
    s.sources.push(source);
  }

  // 再生開始から seconds 秒後に止まるよう、最後の fadeSeconds 秒で小さくしていく
  stopAfter(seconds, fadeSeconds) {
    const s = this.session;
    if (!s) return;
    const end = s.startTime + seconds;
    const from = Math.max(end - fadeSeconds, s.startTime + FADE_SECONDS);
    s.envelope.gain.setValueAtTime(1, from);
    s.envelope.gain.linearRampToValueAtTime(0, end);
    safeStop(s.current, end + 0.1);
  }

  // 集中 focusSeconds 秒 → 休憩 restSeconds 秒 を繰り返す。休憩中は音を消し、切り替わりで合図音
  schedulePomodoro(focusSeconds, restSeconds) {
    const s = this.session;
    if (!s) return;
    const g = s.envelope.gain;
    const period = focusSeconds + restSeconds;
    for (let k = 0; k < POMODORO_CYCLES; k++) {
      const focusEnd = s.startTime + k * period + focusSeconds;
      const restEnd = focusEnd + restSeconds;
      g.setValueAtTime(1, focusEnd - PHASE_FADE_SECONDS);
      g.linearRampToValueAtTime(0, focusEnd);
      g.setValueAtTime(0, restEnd);
      g.linearRampToValueAtTime(1, restEnd + PHASE_FADE_SECONDS);
      this.chime(focusEnd);
      this.chime(restEnd);
    }
  }

  // 小さな「ポーン」
  chime(at) {
    const ctx = this.ctx;
    for (const [freq, peak] of [[660, 0.22], [1320, 0.05]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
      osc.connect(g).connect(this.session.master);
      osc.start(at);
      osc.stop(at + 2);
    }
  }

  setVolume(volume) {
    if (!this.session) return;
    this.session.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
  }

  stop() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    const t = this.ctx.currentTime;
    s.master.gain.cancelScheduledValues(t);
    s.master.gain.setTargetAtTime(0, t, 0.08);
    for (const source of s.sources) safeStop(source, t + 0.5);
    // 予約済みの音や合図音も master ごと切り離して鳴らないようにする
    setTimeout(() => s.master.disconnect(), 600);
  }

  // 鳴らしているはずなのに iPhone 側で音が止められていたら知らせる。
  // 勝手に再開すると、ロック画面で止めたのにページを開いたとたん鳴り出してしまうため、再開はしない
  checkInterrupted() {
    if (this.ctx && this.session && this.ctx.state !== 'running') this.onInterrupted?.();
  }
}

// 予備の鳴らし方（方式2：WAV にして <audio> で鳴らす）
// iOS の更新で方式1が画面を消すと止まるようになったときのために残している。
// 繰り返しの切れ目で一瞬途切れる、音量を音データ側に焼き込む必要がある、という弱点がある。
export class MediaElementPlayer {
  constructor(log) {
    this.log = log;
    this.audio = new Audio();
    this.audio.loop = true;
    this.url = null;
    this.samples = null;
  }

  load(volume) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(encodeWav(this.samples, volume));
    this.audio.src = this.url;
  }

  play(samples, volume) {
    preferPlayback();
    this.samples = samples;
    this.load(volume);
    return this.audio.play();
  }

  stop() {
    this.audio.pause();
  }
}
