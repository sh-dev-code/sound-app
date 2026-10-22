import { createNoise } from './noise.js';
import { WebAudioPlayer, MediaElementPlayer } from './player.js';

const NOISES = { white: 'ホワイトノイズ', pink: 'ピンクノイズ', brown: 'ブラウンノイズ' };

const els = {
  noise: document.querySelectorAll('[data-noise]'),
  method: document.querySelectorAll('[data-method]'),
  play: document.getElementById('play'),
  volume: document.getElementById('volume'),
  volumeValue: document.getElementById('volume-value'),
  status: document.getElementById('status'),
  log: document.getElementById('log'),
};

// 本番は方式1。方式2は iOS の更新で方式1が止まるようになったときの予備
// （方式2は繰り返しの切れ目で一瞬途切れる）
const state = { noise: 'white', method: 'webaudio', playing: false };

function log(message) {
  const time = new Date().toLocaleTimeString('ja-JP');
  const li = document.createElement('li');
  li.textContent = `${time} ${message}`;
  els.log.prepend(li);
  while (els.log.children.length > 50) els.log.lastChild.remove();
}

const players = { webaudio: new WebAudioPlayer(log), element: new MediaElementPlayer(log) };
const player = () => players[state.method];

// スライダー 0〜100 を、耳の感じ方に近い音量に変換する
const volume = () => (els.volume.value / 100) ** 2;

function render() {
  for (const b of els.noise) b.setAttribute('aria-pressed', b.dataset.noise === state.noise);
  for (const b of els.method) b.setAttribute('aria-pressed', b.dataset.method === state.method);
  els.play.textContent = state.playing ? '停止' : '再生';
  els.play.classList.toggle('playing', state.playing);
  els.volumeValue.textContent = els.volume.value;
  els.status.textContent = state.playing
    ? `${NOISES[state.noise]}を再生中（${state.method === 'webaudio' ? '方式1' : '方式2'}）`
    : '停止中';
}

function start() {
  const p = player();
  const result = p.play(createNoise(state.noise), volume());
  state.playing = true;
  log(`再生: ${NOISES[state.noise]}（${state.method === 'webaudio' ? '方式1' : '方式2'}）`);
  if (result && result.catch) {
    result.catch((e) => {
      log(`再生できませんでした: ${e.message}`);
      state.playing = false;
      render();
    });
  }
  updateMediaSession();
  render();
}

function stop() {
  player().stop();
  state.playing = false;
  log('停止');
  render();
}

// 再生中に音や方式を変えたら、新しい設定で鳴らし直す
function restartIfPlaying(change) {
  const wasPlaying = state.playing;
  if (wasPlaying) {
    player().stop();
    state.playing = false;
  }
  change();
  if (wasPlaying) start();
  render();
}

// ロック画面に曲名と再生／停止ボタンを出す
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: NOISES[state.noise],
    artist: '音で集中＆寝かしつけ',
  });
  navigator.mediaSession.setActionHandler('play', () => { if (!state.playing) start(); });
  navigator.mediaSession.setActionHandler('pause', () => { if (state.playing) stop(); });
}

els.play.addEventListener('click', () => (state.playing ? stop() : start()));

for (const b of els.noise) {
  b.addEventListener('click', () => restartIfPlaying(() => { state.noise = b.dataset.noise; }));
}
for (const b of els.method) {
  b.addEventListener('click', () => restartIfPlaying(() => { state.method = b.dataset.method; }));
}

els.volume.addEventListener('input', () => {
  if (state.method === 'webaudio') players.webaudio.setVolume(volume());
  render();
});
els.volume.addEventListener('change', () => {
  if (state.method === 'element') players.element.setVolume(volume());
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    log('画面が隠れました');
  } else {
    log('画面に戻りました');
    if (state.playing) player().wake();
  }
});

log(`準備完了（マナーモード対策: ${'audioSession' in navigator ? '対応' : '非対応'}）`);
render();
