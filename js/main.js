import { loadLibrary, loadBuffer } from './library.js';
import { SoundEngine } from './player.js';
import { loadSettings, saveSettings, clearAllData, hasSeenBabyNotice, markBabyNoticeSeen } from './storage.js';
import { loadRatings, resetRatings, statsOf, average, recordTried, recordRating, pickSound } from './ratings.js';
import {
  loadPlaylists, savePlaylists, totalSeconds, itemAt, startOf, indexAt, formatMinutes, SILENCE,
} from './playlists.js';
import { createPlaylistEditor } from './playlist-editor.js';
import { createSettingsView } from './settings-view.js';

// 赤ちゃんモードの音量上限は集中モードの 40%
const MAX_GAIN = { baby: 0.4, focus: 1 };
// 赤ちゃんモードでは高すぎる音を少し削る
const BABY_LOWPASS_HZ = 8000;
// 赤ちゃんモードのタイマーは最後の 1 分で小さくしていく
const BABY_FADE_SECONDS = 60;
const BABY_TIMERS = [15, 30, 60, 0];
const FOCUS_MINUTES = [15, 20, 25, 30, 45, 50, 60, 90];
const BREAK_MINUTES = [3, 5, 10, 15, 20];
// これ以上流したら「試した」と数えて評価を聞く
const MIN_TRIED_SECONDS = 5 * 60;
const PREVIEW_SECONDS = 15;
// 次の音の切り替え予約は、切り替えの何秒前までに済ませるか
const QUEUE_MARGIN_SECONDS = 2;

const $ = (id) => document.getElementById(id);
const els = {
  modes: document.querySelectorAll('[data-mode]'),
  tabs: document.querySelectorAll('[data-view]'),
  views: {
    play: $('view-play'),
    library: $('view-library'),
    playlists: $('view-playlists'),
    settings: $('view-settings'),
  },
  notice: $('notice'),
  playMethod: $('play-method'),
  soundsSection: $('sounds-section'),
  sounds: $('sounds'),
  omakaseNote: $('omakase-note'),
  playlistPanel: $('playlist-panel'),
  playlistPick: $('playlist-pick'),
  playlistSummary: $('playlist-summary'),
  timerSection: $('timer-section'),
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
  rating: $('rating'),
  ratingTitle: $('rating-title'),
  ratingStars: $('rating-stars'),
  ratingSkip: $('rating-skip'),
  libraryTitle: $('library-title'),
  librarySort: $('library-sort'),
  libraryNote: $('library-note'),
  libraryList: $('library-list'),
  babyDialog: $('baby-dialog'),
  babyDialogOk: $('baby-dialog-ok'),
};

const settings = loadSettings();
const ratings = loadRatings();
const playlists = loadPlaylists();
const state = {
  view: 'play',
  playing: false,
  loading: false,
  // 読み込み中に停止や設定変更をしたら、読み込み後の再生を取りやめるための番号
  loadToken: 0,
  startedAt: 0,
  ticker: null,
  // おまかせ再生中の記録。rounds[k] は k 回目（0 始まり）の集中で流す音の ID
  omakase: null,
  // プレイリスト再生中の記録。queued は切り替えを予約済みの最後の通し番号
  playlist: null,
  shownSoundId: null,
  previewing: null,
  previewTimer: null,
  librarySort: 'rating',
  ratingFor: null,
};
let sounds = [];
let categories = [];

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
const soundById = (id) => (id === SILENCE.id ? SILENCE : sounds.find((s) => s.id === id));
const selectedSound = () => soundsForMode().find((s) => s.id === mode().sound) || soundsForMode()[0];
const isOmakase = () => settings.mode === 'focus' && settings.focus.playMethod === 'omakase';
const isPlaylist = () => settings.mode === 'focus' && settings.focus.playMethod === 'playlist';
const currentPlaylist = () => playlists.find((p) => p.id === settings.focus.playlistId) || playlists[0];
// 再生できるプレイリスト（音が 1 つ以上ある）
const playablePlaylist = () => {
  const pl = currentPlaylist();
  return pl && pl.items.length ? pl : null;
};
// スライダー 0〜100 を、耳の感じ方に近い音量に変換する
const volumeLevel = () => MAX_GAIN[settings.mode] * (mode().volume / 100) ** 2;
const lowpassHz = () => (settings.mode === 'baby' ? BABY_LOWPASS_HZ : null);
const elapsed = () => (Date.now() - state.startedAt) / 1000;
const focusSeconds = () => settings.focus.focusMin * 60;
const period = () => (settings.focus.focusMin + settings.focus.breakMin) * 60;

// 経過時間から、何回目の集中か・休憩中かを求める
function roundAt(e) {
  const k = Math.floor(e / period());
  const inRound = e - k * period();
  return { k, inRound, resting: inRound >= focusSeconds() };
}

function soundOfRound(k) {
  const { rounds } = state.omakase;
  return soundById(rounds[Math.min(k, rounds.length - 1)]);
}

// 今流れている（または次に流れる）音
function playingSound() {
  if (state.omakase) return soundOfRound(roundAt(elapsed()).k);
  if (state.playlist) {
    const { pl } = state.playlist;
    return soundById(itemAt(pl, Math.min(indexAt(pl, elapsed()), state.playlist.queued)).sound);
  }
  return selectedSound();
}

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateMediaSession(sound) {
  if (!('mediaSession' in navigator) || state.shownSoundId === sound.id) return;
  state.shownSoundId = sound.id;
  navigator.mediaSession.metadata = new MediaMetadata({ title: sound.name, artist: '音で集中＆寝かしつけ' });
}

// ---- 再生・停止 ----

async function start() {
  stopPreview();
  const omakase = isOmakase();
  // 再生中に編集されても影響しないよう、写しを使う
  const playlist = isPlaylist() ? structuredClone(playablePlaylist()) : null;
  if (isPlaylist() && !playlist) return;
  const sound = omakase ? pickSound(soundsForMode(), ratings, 'focus', null)
    : playlist ? soundById(playlist.items[0].sound)
      : selectedSound();
  if (!sound) {
    log('プレイリストに見つからない音があります');
    return;
  }
  const ctx = engine.unlock();
  const token = ++state.loadToken;
  state.loading = true;
  render();

  let buffer;
  try {
    buffer = await loadBuffer(ctx, sound);
  } catch (e) {
    if (token === state.loadToken) {
      state.loading = false;
      log(`読み込めませんでした: ${e.message}`);
      render();
    }
    return;
  }
  if (token !== state.loadToken) return;
  state.loading = false;

  engine.start(buffer, { volume: volumeLevel(), lowpassHz: lowpassHz(), sourceGain: sound.gain });
  if (settings.mode === 'baby') {
    if (settings.baby.timer) engine.stopAfter(settings.baby.timer * 60, BABY_FADE_SECONDS);
  } else if (playlist) {
    if (!playlist.loop && playlist.items.length === 1) engine.stopAfter(totalSeconds(playlist), endFade());
  } else {
    engine.schedulePomodoro(focusSeconds(), settings.focus.breakMin * 60);
  }
  state.playing = true;
  state.startedAt = Date.now();
  state.omakase = omakase ? { rounds: [sound.id], countedRound: -1, preparing: false } : null;
  state.playlist = playlist ? { pl: playlist, queued: 0, preparing: false } : null;
  state.shownSoundId = null;
  state.ticker = setInterval(tick, 250);
  log(`再生: ${playlist ? `プレイリスト「${playlist.name}」` : sound.name}${omakase ? '（おまかせ）' : ''}`);
  updateMediaSession(sound);
  if (omakase) queueNextRound();
  if (playlist) queuePlaylistNext();
  render();
}

// プレイリストを最後まで流して止まるときの、小さくしていく時間
const endFade = () => Math.max(settings.crossfade, 3);

function stop(reason = '停止') {
  if (state.playing && state.omakase) finishOmakase();
  engine.stop();
  state.loadToken++;
  state.loading = false;
  state.playing = false;
  state.omakase = null;
  state.playlist = null;
  clearInterval(state.ticker);
  log(reason);
  render();
}

// 再生中に音やタイマーを変えたら、新しい設定で最初から鳴らし直す
function change(update) {
  const wasPlaying = state.playing || state.loading;
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
  if (state.playlist) {
    const { pl } = state.playlist;
    if (!pl.loop && elapsed() >= totalSeconds(pl)) {
      stop('プレイリストが終わりました');
      return;
    }
    queuePlaylistNext();
  }
  if (state.omakase) {
    countFinishedRounds();
    queueNextRound();
  }
  if (state.playing) updateMediaSession(playingSound());
  renderTime();
}

// ---- プレイリスト ----

// 次の音を読み込み、切り替えを予約しておく（おまかせと同じく、画面を消していても切り替わる）
async function queuePlaylistNext() {
  const p = state.playlist;
  if (!p || p.preparing) return;
  const { pl } = p;
  const now = indexAt(pl, elapsed());
  // 予約が間に合わなかったときは、本来流れているはずの音にすぐ切り替える
  const late = now > p.queued;
  const next = late ? now : p.queued + 1;
  if (!late && now < p.queued) return;
  if (!pl.loop && next >= pl.items.length) return;

  p.preparing = true;
  const token = state.loadToken;
  const sound = soundById(itemAt(pl, next).sound) || SILENCE;
  let buffer;
  try {
    buffer = await loadBuffer(engine.ctx, sound);
  } catch (e) {
    log(`読み込めませんでした: ${e.message}`);
    p.preparing = false;
    return;
  }
  if (token !== state.loadToken || state.playlist !== p) return;
  p.preparing = false;

  const offset = late ? elapsed() + 0.3 : startOf(pl, next);
  if (!late && elapsed() > offset - QUEUE_MARGIN_SECONDS) return;
  engine.queue(buffer, offset, sound.gain, settings.crossfade);
  p.queued = next;
  if (!pl.loop && next === pl.items.length - 1) engine.stopAfter(totalSeconds(pl), endFade());
  log(`次の音を予約: ${sound.name}`);
}

// ---- おまかせ ----

// 集中が終わった回を「試した」に数え、最後に終わった回の評価を聞く
function countFinishedRounds() {
  const o = state.omakase;
  const { k, resting } = roundAt(elapsed());
  const finished = resting ? k : k - 1;
  if (finished <= o.countedRound) return;
  for (let r = o.countedRound + 1; r <= finished; r++) recordTried(ratings, 'focus', soundOfRound(r).id);
  o.countedRound = finished;
  askRating(soundOfRound(finished));
}

// 集中の途中で止めたとき、5 分以上流していれば評価を聞く
function finishOmakase() {
  countFinishedRounds();
  const o = state.omakase;
  const { k, inRound, resting } = roundAt(elapsed());
  if (!resting && inRound >= MIN_TRIED_SECONDS && k > o.countedRound) {
    recordTried(ratings, 'focus', soundOfRound(k).id);
    o.countedRound = k;
    askRating(soundOfRound(k));
  }
}

// 次の集中で流す音を選んで読み込み、切り替えを予約しておく。
// 画面を消していてプログラムが止まっていても、予約した切り替えは音の側で行われる
async function queueNextRound() {
  const o = state.omakase;
  if (!o || o.preparing) return;
  const { k } = roundAt(elapsed());
  // 予約が間に合わなかった回は、前の音がそのまま流れている
  while (o.rounds.length <= k) o.rounds.push(o.rounds[o.rounds.length - 1]);
  if (o.rounds.length > k + 1) return;

  o.preparing = true;
  const token = state.loadToken;
  const sound = pickSound(soundsForMode(), ratings, 'focus', o.rounds[k]);
  let buffer;
  try {
    buffer = await loadBuffer(engine.ctx, sound);
  } catch (e) {
    log(`読み込めませんでした: ${e.message}`);
    o.preparing = false;
    return;
  }
  if (token !== state.loadToken || state.omakase !== o) return;
  o.preparing = false;

  const offset = (k + 1) * period();
  if (elapsed() > offset - QUEUE_MARGIN_SECONDS) return;
  engine.queue(buffer, offset, sound.gain);
  o.rounds.push(sound.id);
  log(`次の音を予約: ${sound.name}`);
}

// ---- ★評価 ----

function askRating(sound) {
  state.ratingFor = sound.id;
  els.ratingTitle.textContent = `「${sound.name}」はどうでしたか？`;
  els.rating.hidden = false;
}

function closeRating() {
  state.ratingFor = null;
  els.rating.hidden = true;
}

// ---- 試聴 ----

async function togglePreview(id) {
  if (state.previewing === id) {
    stopPreview();
    return;
  }
  const sound = soundById(id);
  const ctx = engine.unlock();
  const token = ++state.loadToken;
  state.previewing = id;
  renderLibrary();

  let buffer;
  try {
    buffer = await loadBuffer(ctx, sound);
  } catch (e) {
    log(`読み込めませんでした: ${e.message}`);
    if (state.previewing === id) state.previewing = null;
    renderLibrary();
    return;
  }
  if (token !== state.loadToken || state.previewing !== id) return;

  engine.start(buffer, { volume: volumeLevel(), lowpassHz: lowpassHz(), sourceGain: sound.gain });
  engine.stopAfter(PREVIEW_SECONDS, 2);
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(() => {
    if (state.previewing !== id) return;
    state.previewing = null;
    renderLibrary();
  }, PREVIEW_SECONDS * 1000);
}

function stopPreview() {
  if (!state.previewing) return;
  engine.stop();
  state.loadToken++;
  state.previewing = null;
  clearTimeout(state.previewTimer);
  renderLibrary();
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
  } else if (isPlaylist()) {
    const pl = state.playlist?.pl ?? playablePlaylist();
    if (!pl) {
      phase = 'プレイリスト';
      time = '--:--';
    } else if (!state.playing) {
      phase = pl.loop ? `「${pl.name}」・ループ` : `「${pl.name}」`;
      time = formatTime(totalSeconds(pl));
    } else {
      const g = indexAt(pl, elapsed());
      phase = `「${pl.name}」${(g % pl.items.length) + 1}/${pl.items.length}曲目`;
      time = formatTime(startOf(pl, g + 1) - elapsed());
    }
  } else if (!state.playing) {
    phase = '集中';
    time = formatTime(focusSeconds());
  } else {
    const { k, inRound, resting } = roundAt(elapsed());
    phase = resting ? '休憩モード' : `集中モード（${k + 1}回目）`;
    time = formatTime((resting ? period() : focusSeconds()) - inRound);
  }
  els.phase.textContent = phase;
  els.time.textContent = time;

  if (state.playing) els.nowPlaying.textContent = playingSound().name;
  else if (isOmakase()) els.nowPlaying.textContent = 'おまかせ（音は自動で選びます）';
  else if (isPlaylist()) els.nowPlaying.textContent = '';
  else els.nowPlaying.textContent = selectedSound()?.name ?? '';
}

function makeButton(text, data) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  Object.assign(b.dataset, data);
  return b;
}

// 音を種類ごとに見出しを付けて並べる
function renderSoundChoices() {
  const selected = selectedSound();
  const available = soundsForMode();
  els.sounds.replaceChildren(
    ...categories
      .map((cat) => [cat, available.filter((s) => s.category === cat.id)])
      .filter(([, list]) => list.length)
      .map(([cat, list]) => {
        const group = document.createElement('div');
        group.className = 'sound-group';
        const heading = document.createElement('h3');
        heading.textContent = cat.name;
        const chips = document.createElement('div');
        chips.className = 'chips';
        for (const s of list) {
          const b = makeButton(s.name, { sound: s.id });
          b.setAttribute('aria-pressed', s === selected);
          chips.append(b);
        }
        group.append(heading, chips);
        return group;
      }),
  );
}

function render() {
  document.body.dataset.mode = settings.mode;
  for (const b of els.modes) b.setAttribute('aria-pressed', b.dataset.mode === settings.mode);
  for (const b of els.tabs) b.setAttribute('aria-pressed', b.dataset.view === state.view);
  for (const [name, view] of Object.entries(els.views)) view.hidden = name !== state.view;
  els.notice.hidden = settings.mode !== 'baby';

  els.playMethod.hidden = settings.mode !== 'focus';
  for (const b of els.playMethod.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', b.dataset.method === settings.focus.playMethod);
  }
  els.soundsSection.hidden = isOmakase() || isPlaylist();
  els.omakaseNote.hidden = !isOmakase();
  renderSoundChoices();
  renderPlaylistPanel();

  els.timerSection.hidden = isPlaylist();
  els.babyTimer.hidden = settings.mode !== 'baby';
  els.focusTimer.hidden = settings.mode !== 'focus';
  for (const b of els.babyTimer.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', Number(b.dataset.minutes) === settings.baby.timer);
  }
  els.focusMin.value = settings.focus.focusMin;
  els.breakMin.value = settings.focus.breakMin;

  els.play.textContent = state.loading ? '読み込み中' : state.playing ? '停止' : '再生';
  els.play.classList.toggle('playing', state.playing || state.loading);
  els.play.disabled = !sounds.length || (isPlaylist() && !state.playing && !state.loading && !playablePlaylist());

  els.volume.value = mode().volume;
  els.volumeValue.textContent = mode().volume;
  els.volumeNote.hidden = settings.mode !== 'baby';

  renderTime();
  renderLibrary();
}

function renderPlaylistPanel() {
  els.playlistPanel.hidden = !isPlaylist();
  if (!isPlaylist()) return;
  els.playlistPick.replaceChildren(...playlists.map((p) => new Option(p.name, p.id)));
  els.playlistPick.hidden = !playlists.length;
  const pl = currentPlaylist();
  if (pl) els.playlistPick.value = pl.id;
  if (!pl) {
    els.playlistSummary.textContent = 'プレイリストがありません。下の「プレイリスト」タブで作ってください。';
  } else if (!pl.items.length) {
    els.playlistSummary.textContent = 'このプレイリストには音がありません。「プレイリスト」タブで追加してください。';
  } else {
    const names = pl.items.map((i) => `${soundById(i.sound)?.name ?? '？'} ${i.minutes}分`).join(' → ');
    els.playlistSummary.textContent = `${names}（合計 ${formatMinutes(totalSeconds(pl))}${pl.loop ? '・ループ' : ''}）`;
  }
}

function renderLibrary() {
  els.libraryTitle.textContent = `音ライブラリ（${settings.mode === 'baby' ? '赤ちゃん' : '集中'}モード）`;
  for (const b of els.librarySort.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', b.dataset.sort === state.librarySort);
  }
  els.libraryNote.hidden = settings.mode !== 'baby';

  const categoryIndex = (s) => categories.findIndex((c) => c.id === s.category);
  const rows = soundsForMode().map((s) => ({ s, stats: statsOf(ratings, settings.mode, s.id) }));
  if (state.librarySort === 'rating') {
    rows.sort((a, b) => (average(b.stats) ?? -1) - (average(a.stats) ?? -1) || b.stats.tried - a.stats.tried);
  } else {
    rows.sort((a, b) => categoryIndex(a.s) - categoryIndex(b.s));
  }

  const busy = state.playing || state.loading;
  els.libraryList.replaceChildren(
    ...rows.map(({ s, stats }) => {
      const li = document.createElement('li');
      li.className = 'lib-row';
      const info = document.createElement('div');
      info.className = 'lib-info';
      const name = document.createElement('span');
      name.className = 'lib-name';
      name.textContent = s.name;
      const meta = document.createElement('span');
      meta.className = 'lib-meta';
      const category = categories.find((c) => c.id === s.category)?.name ?? '';
      meta.textContent = `${category}・試した回数 ${stats.tried}回`;
      info.append(name, meta);

      const stars = document.createElement('span');
      stars.className = 'lib-stars';
      const avg = average(stats);
      stars.textContent = avg === null ? '未評価' : `★${avg.toFixed(1)}（${stats.count}件）`;
      stars.classList.toggle('unrated', avg === null);

      const preview = makeButton(state.previewing === s.id ? '停止' : '試聴', { preview: s.id });
      preview.className = 'lib-preview';
      preview.disabled = busy;
      li.append(info, stars, preview);
      return li;
    }),
  );
}

function showBabyNoticeIfFirstTime() {
  if (settings.mode === 'baby' && !hasSeenBabyNotice()) els.babyDialog.showModal();
}

// ---- 操作 ----

for (const b of els.modes) {
  b.addEventListener('click', () => {
    if (b.dataset.mode === settings.mode) return;
    if (state.playing || state.loading) stop('モード切替');
    stopPreview();
    settings.mode = b.dataset.mode;
    saveSettings(settings);
    render();
    showBabyNoticeIfFirstTime();
  });
}

for (const b of els.tabs) {
  b.addEventListener('click', () => {
    if (state.view === b.dataset.view) return;
    stopPreview();
    state.view = b.dataset.view;
    if (state.view === 'playlists') playlistEditor.render();
    if (state.view === 'settings') settingsView.render();
    render();
    window.scrollTo(0, 0);
  });
}

// 編集画面の中は編集画面自身が描き直すので、ここでは再生画面側だけ更新する
const playlistEditor = createPlaylistEditor({
  root: els.views.playlists,
  playlists,
  availableSounds: () => sounds.filter((s) => s.modes.includes('focus')),
  onChange: render,
});

const settingsView = createSettingsView({
  root: els.views.settings,
  settings,
  fileSounds: () => sounds.filter((s) => s.type === 'file'),
  onCrossfade: (seconds) => {
    settings.crossfade = seconds;
    saveSettings(settings);
  },
  onReset: (what) => {
    if (state.playing || state.loading) stop('データのリセット');
    if (what === 'ratings') {
      resetRatings(ratings);
    } else if (what === 'playlists') {
      playlists.length = 0;
      savePlaylists(playlists);
    } else {
      clearAllData();
      location.reload();
      return;
    }
    log('データを消しました');
    render();
  },
});

els.playlistPick.addEventListener('change', () => change(() => { settings.focus.playlistId = els.playlistPick.value; }));

for (const b of els.playMethod.querySelectorAll('button')) {
  b.addEventListener('click', () => change(() => { settings.focus.playMethod = b.dataset.method; }));
}

els.sounds.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sound]');
  if (b) change(() => { mode().sound = b.dataset.sound; });
});

for (const minutes of BABY_TIMERS) {
  const b = makeButton(minutes ? `${minutes}分` : 'なし', { minutes });
  b.addEventListener('click', () => change(() => { settings.baby.timer = minutes; }));
  els.babyTimer.append(b);
}

for (const [select, choices] of [[els.focusMin, FOCUS_MINUTES], [els.breakMin, BREAK_MINUTES]]) {
  select.append(...choices.map((m) => new Option(`${m}分`, m)));
}
els.focusMin.addEventListener('change', () => change(() => { settings.focus.focusMin = Number(els.focusMin.value); }));
els.breakMin.addEventListener('change', () => change(() => { settings.focus.breakMin = Number(els.breakMin.value); }));

els.play.addEventListener('click', () => (state.playing || state.loading ? stop() : start()));

els.volume.addEventListener('input', () => {
  mode().volume = Number(els.volume.value);
  els.volumeValue.textContent = els.volume.value;
  if (state.playing) engine.setVolume(volumeLevel());
});
els.volume.addEventListener('change', () => saveSettings(settings));

for (let n = 1; n <= 5; n++) {
  const b = makeButton('★', { stars: n });
  b.setAttribute('aria-label', `★${n}`);
  els.ratingStars.append(b);
}
els.ratingStars.addEventListener('click', (e) => {
  const b = e.target.closest('[data-stars]');
  if (!b || !state.ratingFor) return;
  recordRating(ratings, 'focus', state.ratingFor, Number(b.dataset.stars));
  log(`評価: ${soundById(state.ratingFor).name} ★${b.dataset.stars}`);
  closeRating();
  renderLibrary();
});
// 押す前に、押そうとしている★までを光らせる
els.ratingStars.addEventListener('pointerover', (e) => {
  const n = Number(e.target.closest('[data-stars]')?.dataset.stars ?? 0);
  for (const b of els.ratingStars.children) b.classList.toggle('lit', Number(b.dataset.stars) <= n);
});
els.ratingStars.addEventListener('pointerleave', () => {
  for (const b of els.ratingStars.children) b.classList.remove('lit');
});
els.ratingSkip.addEventListener('click', closeRating);

els.librarySort.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]');
  if (!b) return;
  state.librarySort = b.dataset.sort;
  renderLibrary();
});

els.libraryList.addEventListener('click', (e) => {
  const b = e.target.closest('[data-preview]');
  if (b) togglePreview(b.dataset.preview);
});

els.babyDialogOk.addEventListener('click', () => {
  markBabyNoticeSeen();
  els.babyDialog.close();
});

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => { if (!state.playing && !state.loading) start(); });
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
    ({ sounds, categories } = await loadLibrary());
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
