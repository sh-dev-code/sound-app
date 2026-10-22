// 音を鳴らす仕組み。iPhone で比べるため 2 通り用意する

import { SAMPLE_RATE, encodeWav } from './noise.js';

const FADE_SECONDS = 0.3;

// iPhone のマナーモードでも鳴るようにする（対応している iOS のみ）
function preferPlayback() {
  if ('audioSession' in navigator) navigator.audioSession.type = 'playback';
}

// 方式1：Web Audio API でその場で鳴らす
export class WebAudioPlayer {
  constructor(log) {
    this.log = log;
    this.ctx = null;
    this.source = null;
  }

  ensureContext() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
    this.ctx.onstatechange = () => this.log(`方式1の状態: ${this.ctx.state}`);
  }

  play(samples, volume) {
    preferPlayback();
    this.ensureContext();
    this.ctx.resume();
    this.stopSource(0);

    const buffer = this.ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    this.source = this.ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.source.connect(this.gain);

    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(volume, now + FADE_SECONDS);
    this.source.start();
  }

  stop() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
    this.stopSource(FADE_SECONDS);
  }

  stopSource(delay) {
    if (!this.source) return;
    this.source.stop(this.ctx.currentTime + delay);
    this.source = null;
  }

  setVolume(volume) {
    if (!this.ctx || !this.source) return;
    this.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
  }

  // 画面に戻ったとき、止まっていたら再開を試みる
  wake() {
    if (this.ctx && this.source && this.ctx.state !== 'running') {
      this.ctx.resume().then(() => this.log('方式1を再開しました'));
    }
  }
}

// 方式2：音を WAV にして <audio> で鳴らす（音楽アプリと同じ扱いになる）
// iPhone では <audio> の音量をプログラムから変えられないため、音量を音データ側に焼き込む
export class MediaElementPlayer {
  constructor(log) {
    this.log = log;
    this.audio = new Audio();
    this.audio.loop = true;
    this.url = null;
    this.samples = null;
    this.swapping = false;
    for (const type of ['play', 'pause', 'stalled', 'waiting', 'ended']) {
      this.audio.addEventListener(type, () => {
        if (!this.swapping) this.log(`方式2: ${type}`);
      });
    }
    this.audio.addEventListener('playing', () => { this.swapping = false; });
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

  setVolume(volume) {
    if (!this.samples || this.audio.paused) return;
    const position = this.audio.currentTime;
    this.swapping = true;
    this.load(volume);
    this.audio.addEventListener('loadedmetadata', () => {
      this.audio.currentTime = position % this.audio.duration;
    }, { once: true });
    this.audio.play();
  }

  wake() {}
}
