// 設定を端末内（ブラウザ）に保存する

const SETTINGS_KEY = 'sound-app:settings';
const BABY_NOTICE_KEY = 'sound-app:baby-notice-seen';

const DEFAULTS = {
  mode: 'baby',
  theme: 'warm',
  crossfade: 3,
  // 集中モードの「今の作業」の候補。設定画面で追加・削除できる
  activities: [
    { id: 'memorize', name: '暗記' },
    { id: 'practice', name: '問題演習' },
    { id: 'reading', name: '読書' },
    { id: 'work', name: '仕事' },
    { id: 'chores', name: '家事' },
  ],
  // usage: 赤ちゃんモードの使い方。'soothe'（泣き止み：画像を見せ続ける）か 'sleep'（寝かしつけ：暗くして画像を消す）
  // showImages: 画像を見せるか（false なら「音だけ」）
  baby: { sound: 'white', volume: 50, timer: 30, usage: 'sleep', showImages: true },
  focus: {
    sound: 'white', volume: 50, focusMin: 25, breakMin: 5, playMethod: 'manual', playlistId: null, activity: null,
    showImages: true,
  },
  // 画像の見せ方
  display: {
    slideSeconds: 10, // スライドショーの切り替え間隔
    sleepNight: true, // 寝かしつけで夜用表示にする
    sleepAutoHide: true, // 寝かしつけで画像を自動で消す
    autoHideMin: 5, // 自動で消すまでの分数
    focusNight: false, // 集中モードでも夜用表示にする
  },
};

export function loadSettings() {
  const settings = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (saved) {
      settings.mode = saved.mode || settings.mode;
      settings.crossfade = saved.crossfade ?? settings.crossfade;
      settings.theme = saved.theme ?? settings.theme;
      settings.activities = saved.activities ?? settings.activities;
      Object.assign(settings.baby, saved.baby);
      Object.assign(settings.focus, saved.focus);
      Object.assign(settings.display, saved.display);
    }
  } catch {
    // 保存できない環境（プライベートブラウズなど）では初期値で動かす
  }
  return settings;
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくても動作は続ける
  }
}

// このアプリが端末内に保存したものをすべて消す
export function clearAllData() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sound-app:')) localStorage.removeItem(key);
    }
  } catch {
    // 保存領域が使えない環境では何もしない
  }
}

export function hasSeenBabyNotice() {
  try {
    return localStorage.getItem(BABY_NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markBabyNoticeSeen() {
  try {
    localStorage.setItem(BABY_NOTICE_KEY, '1');
  } catch {
    // 保存できなければ次回も表示される
  }
}
