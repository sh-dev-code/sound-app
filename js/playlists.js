// プレイリストを端末内に保存し、再生位置の計算をする
//
// プレイリスト: { id, name, mode, loop, items: [{ sound: 音のID, minutes }] }
// 「g 番目」は、ループで何周しても数え続ける通し番号（0 始まり）

const KEY = 'sound-app:playlists';

// 休憩などに使う、何も鳴らない音
export const SILENCE = { id: 'silence', name: '無音', type: 'silence', gain: 1, modes: [] };

export function loadPlaylists() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

export function savePlaylists(playlists) {
  try {
    localStorage.setItem(KEY, JSON.stringify(playlists));
  } catch {
    // 保存できなくても動作は続ける
  }
}

export function addPlaylist(playlists) {
  let n = 1;
  while (playlists.some((p) => p.name === `プレイリスト${n}`)) n++;
  const playlist = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: `プレイリスト${n}`,
    mode: 'focus',
    loop: true,
    items: [],
  };
  playlists.push(playlist);
  return playlist;
}

export const totalSeconds = (pl) => pl.items.reduce((sum, item) => sum + item.minutes * 60, 0);

export const itemAt = (pl, g) => pl.items[g % pl.items.length];

// g 番目の音が始まる時刻（再生開始からの秒数）
export function startOf(pl, g) {
  const n = pl.items.length;
  let t = Math.floor(g / n) * totalSeconds(pl);
  for (let i = 0; i < g % n; i++) t += pl.items[i].minutes * 60;
  return t;
}

// 再生開始から e 秒の時点で流れているのは何番目か
export function indexAt(pl, e) {
  const n = pl.items.length;
  const cycle = Math.floor(e / totalSeconds(pl));
  let t = e - cycle * totalSeconds(pl);
  for (let i = 0; i < n; i++) {
    const d = pl.items[i].minutes * 60;
    if (t < d) return cycle * n + i;
    t -= d;
  }
  return cycle * n + n - 1;
}

export function formatMinutes(seconds) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}
