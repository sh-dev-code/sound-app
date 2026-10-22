// 音ごとの★評価と試した回数を端末内に記録し、おまかせで流す音を選ぶ

const KEY = 'sound-app:ratings';

export function loadRatings() {
  const ratings = { baby: {}, focus: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved) Object.assign(ratings, saved);
  } catch {
    // 保存できない環境では空の状態で動かす
  }
  return ratings;
}

function save(ratings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ratings));
  } catch {
    // 保存できなくても動作は続ける
  }
}

export function resetRatings(ratings) {
  ratings.baby = {};
  ratings.focus = {};
  save(ratings);
}

export function statsOf(ratings, mode, id) {
  return ratings[mode][id] || { tried: 0, sum: 0, count: 0 };
}

export function average(stats) {
  return stats.count ? stats.sum / stats.count : null;
}

export function recordTried(ratings, mode, id) {
  const stats = statsOf(ratings, mode, id);
  ratings[mode][id] = { ...stats, tried: stats.tried + 1 };
  save(ratings);
}

export function recordRating(ratings, mode, id, stars) {
  const stats = statsOf(ratings, mode, id);
  ratings[mode][id] = { ...stats, sum: stats.sum + stars, count: stats.count + 1 };
  save(ratings);
}

// まだ試していない音を優先する。全部試したら★が高い音ほど選ばれやすくする。
// 直前と同じ音は続けない
export function pickSound(candidates, ratings, mode, lastId) {
  const pool = candidates.length > 1 ? candidates.filter((s) => s.id !== lastId) : candidates;
  const untried = pool.filter((s) => statsOf(ratings, mode, s.id).tried === 0);
  if (untried.length) return untried[Math.floor(Math.random() * untried.length)];

  // ★1 → 1、★3 → 9、★5 → 25 の重み。評価していない音は★3扱い
  const weights = pool.map((s) => (average(statsOf(ratings, mode, s.id)) ?? 3) ** 2);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}
