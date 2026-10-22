import { createNoise } from './noise.js';
import { SoundEngine } from './player.js';
import { loadSettings, saveSettings, hasSeenBabyNotice, markBabyNoticeSeen } from './storage.js';

// 赤ちゃんモードの音量上限は集中モードの 40%
const MAX_GAIN = { baby: 0.4, focus: 1 };
// 赤ちゃんモードでは高すぎる音を少し削る
const BABY_LOWPASS_HZ = 8000;
// 赤ちゃんモードのタイマーは最後の 1 分で小さくしていく
const BABY_FADE_SECONDS = 60;
const BABY_TIMERS = [15, 30, 60, 0];
const FOCUS_MINUTES = [15, 20, 25, 30, 45, 50, 60, 90];
const BREAK_MINUTES = [3, 5, 10, 15, 20];

const $ = (id) => document.getElementById(id);
const els = {
  modes: document.querySelectorAll('[data-mode]'),
  notice: $('notice'),
  sounds: $('sounds'),
  babyTimer: $('baby-timer'),
  focusTimer: $('focus-timer'),
  focusMin: $('focus-min'),
  breakMin: $('break-min'),
  phase: $('phase'),
  time: $('time'),
  play: $('play'),
  nowPlaying: $('now-playing'),
  volume: $('volume'),
  volumeValue: $('volume-value'),
  volumeNote: $('volume-note'),
  log: $('log'),
  babyDialog: $('baby-dialog'),
  babyDialogOk: $('baby-dialog-ok'),
};

const settings = loadSettings();
const state = { playing: false, startedAt: 0, ticker: null };
let sounds = [];

function log(message) {
  const time = new Date().toLocaleTimeString('ja-JP');
  const li = document.createElement('li');
  li.textContent = `${time} ${message}`;
  els.log.prepend(li);
  while (els.log.children.length > 50) els.log.lastChild.remove();
}

const engine = new SoundEngine(log);

const mode = () => settings[settings.mode];
const soundsForMode = () => sounds.filter((s) => s.modes.includes(settings.mode));
const currentSound = () => soundsForMode().find((s) => s.id === mode().sound) || soundsForMode()[0];
// スライダー 0〜100 を、耳の感じ方に近い音量に変換する
const gain = () => MAX_GAIN[settings.mode] * (mode().volume / 100) ** 2 * currentSound().gain;
const elapsed = () => (Date.now() - state.startedAt) / 1000;

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- 再生・停止 ----

function start() {
  const sound = currentSound();
  engine.start(createNoise(sound.generator), {
    volume: gain(),
    lowpassHz: settings.mode === 'baby' ? BABY_LOWPASS_HZ : null,
  });
  if (settings.mode === 'baby') {
    if (settings.baby.timer) engine.stopAfter(settings.baby.timer * 60, BABY_FADE_SECONDS);
  } else {
    engine.schedulePomodoro(settings.focus.focusMin * 60, settings.focus.breakMin * 60);
  }
  state.playing = true;
  state.startedAt = Date.now();
  state.ticker = setInterval(tick, 250);
  log(`再生: ${sound.name}`);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: sound.name, artist: '音で集中＆寝かしつけ' });
  }
  render();
}

function stop(reason = '停止') {
  engine.stop();
  state.playing = false;
  clearInterval(state.ticker);
  log(reason);
  render();
}

// 再生中に音やタイマーを変えたら、新しい設定で最初から鳴らし直す
function change(update) {
  const wasPlaying = state.playing;
  if (wasPlaying) stop('設定を変更');
  update();
  saveSettings(settings);
  if (wasPlaying) start();
  render();
}

function tick() {
  if (settings.mode === 'baby' && settings.baby.timer && elapsed() >= settings.baby.timer * 60) {
    stop('タイマーで停止');
    return;
  }
  renderTime();
}

// ---- 表示 ----

function renderTime() {
  let phase;
  let time;
  if (settings.mode === 'baby') {
    const total = settings.baby.timer * 60;
    if (total) {
      phase = '残り';
      time = formatTime(state.playing ? total - elapsed() : total);
    } else {
      phase = 'タイマーなし';
      time = state.playing ? formatTime(elapsed()) : '--:--';
    }
  } else {
    const focus = settings.focus.focusMin * 60;
    const rest = settings.focus.breakMin * 60;
    if (!state.playing) {
      phase = '集中';
      time = formatTime(focus);
    } else {
      const e = elapsed();
      const round = Math.floor(e / (focus + rest));
      const inRound = e - round * (focus + rest);
      if (inRound < focus) {
        phase = `集中中（${round + 1}回目）`;
        time = formatTime(focus - inRound);
      } else {
        phase = '休憩中';
        time = formatTime(focus + rest - inRound);
      }
    }
  }
  els.phase.textContent = phase;
  els.time.textContent = time;
}

function render() {
  document.body.dataset.mode = settings.mode;
  for (const b of els.modes) b.setAttribute('aria-pressed', b.dataset.mode === settings.mode);
  els.notice.hidden = settings.mode !== 'baby';

  const selected = currentSound();
  els.sounds.replaceChildren(
    ...soundsForMode().map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.sound = s.id;
      b.textContent = s.name;
      b.setAttribute('aria-pressed', s === selected);
      return b;
    }),
  );

  els.babyTimer.hidden = settings.mode !== 'baby';
  els.focusTimer.hidden = settings.mode !== 'focus';
  for (const b of els.babyTimer.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', Number(b.dataset.minutes) === settings.baby.timer);
  }
  els.focusMin.value = settings.focus.focusMin;
  els.breakMin.value = settings.focus.breakMin;

  els.play.textContent = state.playing ? '停止' : '再生';
  els.play.classList.toggle('playing', state.playing);
  els.nowPlaying.textContent = selected ? selected.name : '';

  els.volume.value = mode().volume;
  els.volumeValue.textContent = mode().volume;
  els.volumeNote.hidden = settings.mode !== 'baby';

  renderTime();
}

function showBabyNoticeIfFirstTime() {
  if (settings.mode === 'baby' && !hasSeenBabyNotice()) els.babyDialog.showModal();
}

// ---- 操作 ----

for (const b of els.modes) {
  b.addEventListener('click', () => {
    if (b.dataset.mode === settings.mode) return;
    if (state.playing) stop('モード切替');
    settings.mode = b.dataset.mode;
    saveSettings(settings);
    render();
    showBabyNoticeIfFirstTime();
  });
}

els.sounds.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sound]');
  if (b) change(() => { mode().sound = b.dataset.sound; });
});

for (const minutes of BABY_TIMERS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.minutes = minutes;
  b.textContent = minutes ? `${minutes}分` : 'なし';
  b.addEventListener('click', () => change(() => { settings.baby.timer = minutes; }));
  els.babyTimer.append(b);
}

for (const [select, choices] of [[els.focusMin, FOCUS_MINUTES], [els.breakMin, BREAK_MINUTES]]) {
  select.append(...choices.map((m) => new Option(`${m}分`, m)));
}
els.focusMin.addEventListener('change', () => change(() => { settings.focus.focusMin = Number(els.focusMin.value); }));
els.breakMin.addEventListener('change', () => change(() => { settings.focus.breakMin = Number(els.breakMin.value); }));

els.play.addEventListener('click', () => (state.playing ? stop() : start()));

els.volume.addEventListener('input', () => {
  mode().volume = Number(els.volume.value);
  els.volumeValue.textContent = els.volume.value;
  if (state.playing) engine.setVolume(gain());
});
els.volume.addEventListener('change', () => saveSettings(settings));

els.babyDialogOk.addEventListener('click', () => {
  markBabyNoticeSeen();
  els.babyDialog.close();
});

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => { if (!state.playing) start(); });
  navigator.mediaSession.setActionHandler('pause', () => { if (state.playing) stop(); });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    log('画面が隠れました');
  } else {
    log('画面に戻りました');
    if (state.playing) {
      engine.wake();
      tick();
    }
  }
});

// ---- 起動 ----

async function init() {
  try {
    const res = await fetch('sounds.json');
    const data = await res.json();
    // 音声ファイルの再生はステップ4で対応する
    sounds = data.sounds.filter((s) => s.type === 'generated');
  } catch (e) {
    log(`音の一覧を読み込めませんでした: ${e.message}`);
    return;
  }
  els.play.disabled = false;
  render();
  showBabyNoticeIfFirstTime();
  log(`準備完了（マナーモード対策: ${'audioSession' in navigator ? '対応' : '非対応'}）`);
}

init();
