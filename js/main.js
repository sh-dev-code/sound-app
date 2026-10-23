import { loadLibrary, loadBuffer } from './library.js';
import { SoundEngine } from './player.js';
import { loadSettings, saveSettings, clearAllData, hasSeenBabyNotice, markBabyNoticeSeen } from './storage.js';
import {
  loadRatings, resetRatings, deleteActivityRatings, statsOf, average, recordTried, recordRating, moveTried,
  pickSound, topRated,
} from './ratings.js';
import {
  loadPlaylists, savePlaylists, addPlaylist, totalSeconds, itemAt, startOf, indexAt, formatMinutes, SILENCE,
} from './playlists.js';
import { createPlaylistEditor } from './playlist-editor.js';
import { createSettingsView, THEMES } from './settings-view.js';
import { listImages, addImage, deleteImage, clearImages, MAX_IMAGES_PER_MODE } from './images.js';
import { createSlideshow } from './slideshow.js';

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
  omakasePanel: $('omakase-panel'),
  activityPick: $('activity-pick'),
  ratingActivity: $('rating-activity'),
  libraryActivity: $('library-activity'),
  libraryMake: $('library-make'),
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
  reset: $('reset'),
  babyUsage: $('baby-usage'),
  showImages: $('show-images'),
  imageHint: $('image-hint'),
  showStage: $('show-stage'),
  stage: $('stage'),
  stagePhase: $('stage-phase'),
  stageTime: $('stage-time'),
  stagePlay: $('stage-play'),
  backdrop: $('backdrop'),
  nightVeil: $('night-veil'),
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
  // 一時停止中か。pausedElapsed は止めた時点の経過秒数
  paused: false,
  pausedElapsed: 0,
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
  // ライブラリで見ている作業（'' は全体）
  libraryActivity: '',
  // 評価を聞いている音と、その回を流したときの作業
  ratingFor: null,
  ratingActivity: null,
  // 追加した画像。モードごとに [{ id, url }]
  images: { baby: [], focus: [] },
  // 全画面の画像をタップして閉じたか（次に再生するまで閉じたまま）
  stageHidden: false,
  wakeLock: null,
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

// ロック画面の停止ボタンなどで iPhone 側に音を止められたら、アプリも一時停止にしてタイマーを止める
const engine = new SoundEngine(log, {
  onInterrupted: () => {
    if (state.playing) pause('ロック画面などから一時停止されました');
    else if (state.previewing) stopPreview();
  },
});

const mode = () => settings[settings.mode];
const soundsForMode = () => sounds.filter((s) => s.modes.includes(settings.mode));
const soundById = (id) => (id === SILENCE.id ? SILENCE : sounds.find((s) => s.id === id));
const selectedSound = () => soundsForMode().find((s) => s.id === mode().sound) || soundsForMode()[0];
const isOmakase = () => settings.mode === 'focus' && settings.focus.playMethod === 'omakase';
// 選んでいる作業（削除済みなら「指定なし」）
const currentActivity = () => {
  const id = settings.focus.activity;
  return settings.activities.some((a) => a.id === id) ? id : null;
};
const activityName = (id) => settings.activities.find((a) => a.id === id)?.name;
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
// 再生開始からの経過秒数（一時停止中は止めた時点のまま）
const elapsed = () => (state.paused ? state.pausedElapsed : (Date.now() - state.startedAt) / 1000);
// 再生中か一時停止中（タイマーが途中の状態）
const running = () => state.playing || state.paused;
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

// 最初から再生する
function start() {
  stopPreview();
  state.stageHidden = false;
  const playlist = isPlaylist() ? structuredClone(playablePlaylist()) : null;
  if (isPlaylist() && !playlist) return;
  if (isOmakase()) {
    const activity = currentActivity();
    const first = pickSound(soundsForMode(), ratings, 'focus', null, activity);
    state.omakase = { rounds: [first.id], countedRound: -1, preparing: false, activity };
  } else {
    state.omakase = null;
  }
  // 再生中に編集されても影響しないよう、写しを使う
  state.playlist = playlist ? { pl: playlist, queued: 0, preparing: false } : null;
  log(`再生: ${playlist ? `プレイリスト「${playlist.name}」` : state.omakase ? 'おまかせ' : selectedSound().name}`);
  playFrom(0);
}

// 一時停止したところから続きを流す
function resume() {
  log('再開');
  playFrom(state.pausedElapsed);
}

// 再生開始から offset 秒の時点の音を鳴らし、タイマー・音の切り替えをその続きから予約する
async function playFrom(offset) {
  let sound;
  let silent = false;
  if (state.omakase) {
    const o = state.omakase;
    const { k, resting } = roundAt(offset);
    while (o.rounds.length <= k) o.rounds.push(o.rounds[o.rounds.length - 1]);
    // 一時停止で、予約していた次の回の音は取り消されている
    o.rounds.length = k + 1;
    o.preparing = false;
    sound = soundOfRound(k);
    silent = resting;
  } else if (state.playlist) {
    const p = state.playlist;
    p.queued = indexAt(p.pl, offset);
    p.preparing = false;
    sound = soundById(itemAt(p.pl, p.queued).sound);
  } else {
    sound = selectedSound();
    if (settings.mode === 'focus') silent = roundAt(offset).resting;
  }
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
  state.paused = false;

  engine.start(buffer, { volume: volumeLevel(), lowpassHz: lowpassHz(), sourceGain: sound.gain, offset, silent });
  if (settings.mode === 'baby') {
    if (settings.baby.timer) engine.stopAfter(settings.baby.timer * 60, BABY_FADE_SECONDS);
  } else if (state.playlist) {
    const { pl, queued } = state.playlist;
    if (!pl.loop && queued === pl.items.length - 1) engine.stopAfter(totalSeconds(pl), endFade());
  } else {
    engine.schedulePomodoro(focusSeconds(), settings.focus.breakMin * 60);
  }
  state.playing = true;
  state.startedAt = Date.now() - offset * 1000;
  state.shownSoundId = null;
  state.ticker = setInterval(tick, 250);
  updateMediaSession(sound);
  setPlaybackState('playing');
  if (state.omakase) queueNextRound();
  if (state.playlist) queuePlaylistNext();
  render();
}

// プレイリストを最後まで流して止まるときの、小さくしていく時間
const endFade = () => Math.max(settings.crossfade, 3);

// 一時停止。経過時間を覚えておき、再開で続きから流す
function pause(reason = '一時停止') {
  if (!state.playing) return;
  state.pausedElapsed = elapsed();
  engine.stop();
  state.loadToken++;
  state.playing = false;
  state.paused = true;
  clearInterval(state.ticker);
  setPlaybackState('paused');
  log(reason);
  render();
}

// 停止してタイマーを最初に戻す（リセット）
function stop(reason = '停止') {
  if ((state.playing || state.paused) && state.omakase) finishOmakase();
  engine.stop();
  state.loadToken++;
  state.loading = false;
  state.playing = false;
  state.paused = false;
  state.omakase = null;
  state.playlist = null;
  clearInterval(state.ticker);
  setPlaybackState('none');
  log(reason);
  render();
}

// ロック画面の再生／停止ボタンの表示をアプリの状態と合わせる
function setPlaybackState(value) {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = value;
}

// 再生中に音やタイマーを変えたら、新しい設定で最初から鳴らし直す
// 一時停止中に変えたら、リセットして止まったままにする
function change(update) {
  const wasPlaying = state.playing || state.loading;
  if (wasPlaying || state.paused) stop(wasPlaying ? '設定を変更' : 'リセット（設定を変更）');
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
  renderDisplay();
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
  for (let r = o.countedRound + 1; r <= finished; r++) {
    recordTried(ratings, 'focus', soundOfRound(r).id, o.activity);
  }
  o.countedRound = finished;
  askRating(soundOfRound(finished), o.activity);
}

// 集中の途中で止めたとき、5 分以上流していれば評価を聞く
function finishOmakase() {
  countFinishedRounds();
  const o = state.omakase;
  const { k, inRound, resting } = roundAt(elapsed());
  if (!resting && inRound >= MIN_TRIED_SECONDS && k > o.countedRound) {
    recordTried(ratings, 'focus', soundOfRound(k).id, o.activity);
    o.countedRound = k;
    askRating(soundOfRound(k), o.activity);
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
  const sound = pickSound(soundsForMode(), ratings, 'focus', o.rounds[k], o.activity);
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

function activityOptions(select, emptyLabel) {
  select.replaceChildren(
    new Option(emptyLabel, ''),
    ...settings.activities.map((a) => new Option(a.name, a.id)),
  );
}

// activity はその回を流したときの作業。評価のときに選び直すこともできる
function askRating(sound, activity) {
  if (state.ratingFor) closeRating();
  state.ratingFor = sound.id;
  state.ratingActivity = activity;
  els.ratingTitle.textContent = `「${sound.name}」はどうでしたか？`;
  activityOptions(els.ratingActivity, '作業：指定なし');
  for (const o of els.ratingActivity.options) if (o.value) o.textContent = `作業：${o.textContent}`;
  els.ratingActivity.value = activity ?? '';
  els.rating.hidden = false;
}

// 評価を閉じる。stars があれば★を記録する
function closeRating(stars) {
  const chosen = els.ratingActivity.value || null;
  moveTried(ratings, 'focus', state.ratingFor, state.ratingActivity, chosen);
  if (stars) {
    recordRating(ratings, 'focus', state.ratingFor, stars, chosen);
    log(`評価: ${soundById(state.ratingFor).name} ★${stars}${chosen ? `（${activityName(chosen)}）` : ''}`);
  }
  state.ratingFor = null;
  els.rating.hidden = true;
  renderLibrary();
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
      time = formatTime(running() ? total - elapsed() : total);
    } else {
      phase = 'タイマーなし';
      time = running() ? formatTime(elapsed()) : '--:--';
    }
  } else if (isPlaylist()) {
    const pl = state.playlist?.pl ?? playablePlaylist();
    if (!pl) {
      phase = 'プレイリスト';
      time = '--:--';
    } else if (!running()) {
      phase = pl.loop ? `「${pl.name}」・ループ` : `「${pl.name}」`;
      time = formatTime(totalSeconds(pl));
    } else {
      const g = indexAt(pl, elapsed());
      phase = `「${pl.name}」${(g % pl.items.length) + 1}/${pl.items.length}曲目`;
      time = formatTime(startOf(pl, g + 1) - elapsed());
    }
  } else if (!running()) {
    phase = '集中';
    time = formatTime(focusSeconds());
  } else {
    const { k, inRound, resting } = roundAt(elapsed());
    phase = resting ? '休憩モード' : `集中モード（${k + 1}回目）`;
    time = formatTime((resting ? period() : focusSeconds()) - inRound);
  }
  els.phase.textContent = state.paused ? `一時停止中・${phase}` : phase;
  els.stagePhase.textContent = els.phase.textContent;
  els.stageTime.textContent = time;
  els.time.textContent = time;

  if (running()) els.nowPlaying.textContent = playingSound().name;
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
// 音のボタンは、並びが変わったとき（モード切替など）だけ作り直す。
// 選んだ音が変わっただけなら押した状態だけ変えて、色がなめらかに切り替わるようにする
function renderSoundChoices() {
  const selected = selectedSound();
  const available = soundsForMode();
  const key = available.map((s) => s.id).join(',');
  if (els.sounds.dataset.key === key) {
    for (const b of els.sounds.querySelectorAll('[data-sound]')) {
      b.setAttribute('aria-pressed', b.dataset.sound === selected?.id);
    }
    return;
  }
  els.sounds.dataset.key = key;
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

function applyTheme() {
  // なくなった配色が保存されていたら最初の配色（ぬくもり）にする
  if (!THEMES.some((t) => t.id === settings.theme)) settings.theme = THEMES[0].id;
  document.body.dataset.theme = settings.theme;
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]').content = bg;
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
  els.omakasePanel.hidden = !isOmakase();
  activityOptions(els.activityPick, '指定なし');
  els.activityPick.value = currentActivity() ?? '';
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

  els.play.textContent = state.loading ? '読み込み中' : state.playing ? '一時停止' : state.paused ? '再開' : '再生';
  els.stagePlay.textContent = els.play.textContent;
  els.play.classList.toggle('playing', state.playing || state.loading);
  els.reset.hidden = !state.paused;
  els.play.disabled = !sounds.length || (isPlaylist() && !running() && !state.loading && !playablePlaylist());

  els.volume.value = mode().volume;
  els.volumeValue.textContent = mode().volume;
  els.volumeNote.hidden = settings.mode !== 'baby';

  els.babyUsage.hidden = settings.mode !== 'baby';
  for (const b of els.babyUsage.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', b.dataset.usage === settings.baby.usage);
  }
  renderImageStyles();
  els.imageHint.hidden = !(mode().imageStyle !== 'none' && !state.images[settings.mode].length);

  renderTime();
  renderLibrary();
  renderDisplay();
}

// ---- 画像の表示 ----

const stageSlides = createSlideshow($('stage-slides'));
const backdropSlides = createSlideshow(els.backdrop);

// 画像の見せ方の選択肢。集中モードだけ「背景」がある
const IMAGE_STYLES = {
  baby: [['full', '画像あり'], ['none', '音だけ']],
  focus: [['backdrop', '背景'], ['full', '全画面'], ['none', '音だけ']],
};

// モードが変わったときだけボタンを作り直し、ふだんは押した状態だけ変える
function renderImageStyles() {
  const choices = IMAGE_STYLES[settings.mode];
  if (els.showImages.dataset.mode !== settings.mode) {
    els.showImages.dataset.mode = settings.mode;
    els.showImages.replaceChildren(...choices.map(([value, label]) => makeButton(label, { style: value })));
  }
  if (!choices.some(([value]) => value === mode().imageStyle)) mode().imageStyle = choices[0][0];
  for (const b of els.showImages.children) b.setAttribute('aria-pressed', b.dataset.style === mode().imageStyle);
}

const isSleeping = () => settings.mode === 'baby' && settings.baby.usage === 'sleep';
// 全画面で画像を見せるか（再生中・一時停止中）
const stageEligible = () =>
  mode().imageStyle === 'full' && state.images[settings.mode].length > 0 && running();
// 寝かしつけで、一定時間たって画像を消したか
const imagesFaded = () =>
  isSleeping() && settings.display.sleepAutoHide && running() && elapsed() >= settings.display.autoHideMin * 60;

function renderDisplay() {
  const d = settings.display;
  // 夜用表示：画面全体に黒い幕を薄くかける（ふわっと暗くなるよう、表示は class で切り替える）
  els.nightVeil.classList.toggle('on', (isSleeping() && d.sleepNight) || (settings.mode === 'focus' && d.focusNight));

  const stageOn = stageEligible() && !state.stageHidden;
  const faded = imagesFaded();
  els.stage.classList.toggle('open', stageOn);
  els.stage.classList.toggle('faded', faded);
  els.showStage.hidden = !(stageEligible() && state.stageHidden);
  if (stageOn) stageSlides.setImages(state.images[settings.mode].map((i) => i.url));
  if (stageOn && !faded && state.playing) stageSlides.play(d.slideSeconds);
  else stageSlides.pause();

  // 集中モードの「背景」：再生画面の後ろに画像をうっすら敷く
  const backdropOn = settings.mode === 'focus' && settings.focus.imageStyle === 'backdrop'
    && state.images.focus.length > 0;
  els.backdrop.classList.toggle('on', backdropOn);
  if (backdropOn) backdropSlides.setImages(state.images.focus.map((i) => i.url));
  if (backdropOn && state.playing) backdropSlides.play(d.slideSeconds);
  else backdropSlides.pause();

  // 全画面で見せている間は画面を暗くしない（寝かしつけは除く）
  updateWakeLock(stageOn && !faded && state.playing && !isSleeping());
}

// 全画面で画像を見せている間は、iPhone の画面が自動で暗くならないようにする
async function updateWakeLock(wanted) {
  if (!('wakeLock' in navigator)) return;
  state.wakeWanted = wanted;
  if (wanted && !state.wakeLock) {
    state.wakeLock = 'pending';
    try {
      const lock = await navigator.wakeLock.request('screen');
      state.wakeLock = lock;
      lock.addEventListener('release', () => {
        if (state.wakeLock === lock) state.wakeLock = null;
      });
      // 待っている間に不要になっていたら手放す
      if (!state.wakeWanted) updateWakeLock(false);
    } catch {
      state.wakeLock = null;
    }
  } else if (!wanted && state.wakeLock && state.wakeLock !== 'pending') {
    const lock = state.wakeLock;
    state.wakeLock = null;
    lock.release();
  }
}

// 端末内に保存した画像を読み込み直す
async function refreshImages() {
  for (const m of ['baby', 'focus']) {
    let list = [];
    try {
      list = await listImages(m);
    } catch (e) {
      log(`画像を読み込めませんでした: ${e.message}`);
    }
    for (const old of state.images[m]) URL.revokeObjectURL(old.url);
    state.images[m] = list.map((img) => ({ id: img.id, url: URL.createObjectURL(img.blob) }));
  }
  render();
  if (state.view === 'settings') settingsView.render();
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

  // 集中モードでは、作業ごとの評価に切り替えて見られる
  const focus = settings.mode === 'focus';
  if (!settings.activities.some((a) => a.id === state.libraryActivity)) state.libraryActivity = '';
  els.libraryActivity.hidden = !focus;
  els.libraryMake.hidden = !focus;
  activityOptions(els.libraryActivity, '作業：すべて');
  for (const o of els.libraryActivity.options) if (o.value) o.textContent = `作業：${o.textContent}`;
  els.libraryActivity.value = state.libraryActivity;
  const activity = focus ? state.libraryActivity || null : null;
  els.libraryMake.textContent = activity
    ? `「${activityName(activity)}」で評価の高い音でプレイリストを作る`
    : '評価の高い音でプレイリストを作る';

  const categoryIndex = (s) => categories.findIndex((c) => c.id === s.category);
  const rows = soundsForMode().map((s) => ({ s, stats: statsOf(ratings, settings.mode, s.id, activity) }));
  if (state.librarySort === 'rating') {
    rows.sort((a, b) => (average(b.stats) ?? -1) - (average(a.stats) ?? -1) || b.stats.tried - a.stats.tried);
  } else {
    rows.sort((a, b) => categoryIndex(a.s) - categoryIndex(b.s));
  }

  const busy = running() || state.loading;
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
    if (running() || state.loading) stop('モード切替');
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
  images: (m) => state.images[m],
  maxImages: MAX_IMAGES_PER_MODE,
  onAddImages: async (m, files) => {
    const room = MAX_IMAGES_PER_MODE - state.images[m].length;
    if (files.length > room) alert(`1つのモードに追加できるのは${MAX_IMAGES_PER_MODE}枚までです。最初の${room}枚を追加します。`);
    for (const file of files.slice(0, room)) {
      try {
        await addImage(m, file);
      } catch (e) {
        log(`画像を追加できませんでした: ${e.message}`);
      }
    }
    await refreshImages();
  },
  onDeleteImage: async (id) => {
    await deleteImage(id);
    await refreshImages();
  },
  onDisplay: (key, value) => {
    settings.display[key] = value;
    saveSettings(settings);
    render();
  },
  onTheme: (theme) => {
    settings.theme = theme;
    saveSettings(settings);
    applyTheme();
  },
  onAddActivity: (name) => {
    settings.activities.push({ id: `a${Date.now().toString(36)}`, name });
    saveSettings(settings);
    render();
  },
  onRemoveActivity: (id) => {
    settings.activities = settings.activities.filter((a) => a.id !== id);
    if (settings.focus.activity === id) settings.focus.activity = null;
    deleteActivityRatings(ratings, id);
    saveSettings(settings);
    render();
  },
  onCrossfade: (seconds) => {
    settings.crossfade = seconds;
    saveSettings(settings);
  },
  onReset: async (what) => {
    if (running() || state.loading) stop('データのリセット');
    if (what === 'ratings') {
      resetRatings(ratings);
    } else if (what === 'playlists') {
      playlists.length = 0;
      savePlaylists(playlists);
    } else if (what === 'images') {
      await clearImages();
      await refreshImages();
    } else {
      clearAllData();
      await clearImages().catch(() => {});
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

// 再生中は一時停止、一時停止中は再開。読み込み中に押したら取りやめる
function togglePlay() {
  if (state.loading) stop('取りやめ');
  else if (state.playing) pause();
  else if (state.paused) resume();
  else start();
}
els.play.addEventListener('click', togglePlay);
els.reset.addEventListener('click', () => stop('リセット'));

// 全画面の画像：一時停止ボタン以外をタップすると、普通の再生画面に戻る
els.stagePlay.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlay();
});
els.stage.addEventListener('click', () => {
  state.stageHidden = true;
  renderDisplay();
});
els.showStage.addEventListener('click', () => {
  state.stageHidden = false;
  renderDisplay();
});

els.babyUsage.addEventListener('click', (e) => {
  const b = e.target.closest('[data-usage]');
  if (!b) return;
  settings.baby.usage = b.dataset.usage;
  saveSettings(settings);
  log(`使い方: ${b.textContent}`);
  render();
});

els.showImages.addEventListener('click', (e) => {
  const b = e.target.closest('[data-style]');
  if (!b) return;
  mode().imageStyle = b.dataset.style;
  // 全画面に切り替えたら、閉じていても開き直す
  if (b.dataset.style === 'full') state.stageHidden = false;
  saveSettings(settings);
  render();
});

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
  closeRating(Number(b.dataset.stars));
});
// 押す前に、押そうとしている★までを光らせる
els.ratingStars.addEventListener('pointerover', (e) => {
  const n = Number(e.target.closest('[data-stars]')?.dataset.stars ?? 0);
  for (const b of els.ratingStars.children) b.classList.toggle('lit', Number(b.dataset.stars) <= n);
});
els.ratingStars.addEventListener('pointerleave', () => {
  for (const b of els.ratingStars.children) b.classList.remove('lit');
});
els.ratingSkip.addEventListener('click', () => closeRating());

els.activityPick.addEventListener('change', () => {
  settings.focus.activity = els.activityPick.value || null;
  saveSettings(settings);
  // 再生中なら、次に選ぶ音と評価の記録先も新しい作業にする
  if (state.omakase) state.omakase.activity = currentActivity();
});

els.libraryActivity.addEventListener('change', () => {
  state.libraryActivity = els.libraryActivity.value;
  renderLibrary();
});

// 評価の高い音を最大 4 つ、各 25 分・ループありで並べたプレイリストを作る
const AUTO_PLAYLIST_SIZE = 4;
const AUTO_PLAYLIST_MINUTES = 25;
els.libraryMake.addEventListener('click', () => {
  const activity = state.libraryActivity || null;
  const top = topRated(soundsForMode(), ratings, 'focus', activity, AUTO_PLAYLIST_SIZE);
  if (!top.length) {
    alert(activity
      ? `「${activityName(activity)}」で★評価した音がまだありません。おまかせで評価をためてください。`
      : '★評価した音がまだありません。おまかせで評価をためてください。');
    return;
  }
  const pl = addPlaylist(playlists);
  pl.name = activity ? `${activityName(activity)}向け` : '評価の高い音';
  pl.items = top.map((s) => ({ sound: s.id, minutes: AUTO_PLAYLIST_MINUTES }));
  savePlaylists(playlists);
  log(`プレイリストを作成: ${pl.name}`);
  state.view = 'playlists';
  playlistEditor.open(pl.id);
  render();
  window.scrollTo(0, 0);
});

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
  navigator.mediaSession.setActionHandler('play', () => {
    if (state.paused && !state.loading) resume();
    else if (!state.playing && !state.loading) start();
  });
  navigator.mediaSession.setActionHandler('pause', () => { if (state.playing) pause(); });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    log('画面が隠れました');
  } else {
    log('画面に戻りました');
    if (state.playing) {
      engine.checkInterrupted();
      if (state.playing) tick();
    }
    // 画面を離れると「画面を暗くしない」設定は解除されるので、かけ直す
    renderDisplay();
  }
});

// ---- 起動 ----

async function init() {
  applyTheme();
  try {
    ({ sounds, categories } = await loadLibrary());
  } catch (e) {
    log(`音の一覧を読み込めませんでした: ${e.message}`);
    return;
  }
  els.play.disabled = false;
  render();
  showBabyNoticeIfFirstTime();
  refreshImages();
  log(`準備完了（マナーモード対策: ${'audioSession' in navigator ? '対応' : '非対応'}）`);
}

init();
