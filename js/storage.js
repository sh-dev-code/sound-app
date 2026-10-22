// 設定を端末内（ブラウザ）に保存する

const SETTINGS_KEY = 'sound-app:settings';
const BABY_NOTICE_KEY = 'sound-app:baby-notice-seen';

const DEFAULTS = {
  mode: 'baby',
  theme: 'night',
  crossfade: 3,
  baby: { sound: 'white', volume: 50, timer: 30 },
  focus: { sound: 'white', volume: 50, focusMin: 25, breakMin: 5, playMethod: 'manual', playlistId: null },
};

export function loadSettings() {
  const settings = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (saved) {
      settings.mode = saved.mode || settings.mode;
      settings.crossfade = saved.crossfade ?? settings.crossfade;
      settings.theme = saved.theme ?? settings.theme;
      Object.assign(settings.baby, saved.baby);
      Object.assign(settings.focus, saved.focus);
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
