// 音ごとの★評価と試した回数を端末内に記録し、おまかせで流す音を選ぶ
//
// ratings.baby / ratings.focus      : { 音ID: { tried, sum, count } }  モード全体の記録
// ratings.activities[作業ID]        : { 音ID: { tried, sum, count } }  集中モードの作業ごとの記録
// 作業を選んでいるときは、全体と作業ごとの両方に記録する

const KEY = 'sound-app:ratings';

export function loadRatings() {
  const ratings = { baby: {}, focus: {}, activities: {} };
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
  ratings.activities = {};
  save(ratings);
}

export function deleteActivityRatings(ratings, activity) {
  delete ratings.activities[activity];
  save(ratings);
}

// activity を渡すとその作業の記録、渡さないとモード全体の記録を扱う
function table(ratings, mode, activity) {
  if (!activity) return ratings[mode];
  ratings.activities[activity] ??= {};
  return ratings.activities[activity];
}

const EMPTY = { tried: 0, sum: 0, count: 0 };

export function statsOf(ratings, mode, id, activity) {
  const t = activity ? ratings.activities[activity] : ratings[mode];
  return t?.[id] || EMPTY;
}

export function average(stats) {
  return stats.count ? stats.sum / stats.count : null;
}

function update(ratings, mode, activity, id, change) {
  const t = table(ratings, mode, activity);
  t[id] = change(t[id] || EMPTY);
}

export function recordTried(ratings, mode, id, activity) {
  const add = (s) => ({ ...s, tried: s.tried + 1 });
  update(ratings, mode, null, id, add);
  if (activity) update(ratings, mode, activity, id, add);
  save(ratings);
}

export function recordRating(ratings, mode, id, stars, activity) {
  const add = (s) => ({ ...s, sum: s.sum + stars, count: s.count + 1 });
  update(ratings, mode, null, id, add);
  if (activity) update(ratings, mode, activity, id, add);
  save(ratings);
}

// 評価のときに作業を選び直したら、「試した回数」も選び直した作業へ移す
export function moveTried(ratings, mode, id, from, to) {
  if (from === to) return;
  if (from) update(ratings, mode, from, id, (s) => ({ ...s, tried: Math.max(0, s.tried - 1) }));
  if (to) update(ratings, mode, to, id, (s) => ({ ...s, tried: s.tried + 1 }));
  save(ratings);
}

// まだ試していない音を優先する。全部試したら★が高い音ほど選ばれやすくする。
// 直前と同じ音は続けない。activity を渡すと、その作業での記録をもとに選ぶ
export function pickSound(candidates, ratings, mode, lastId, activity) {
  const pool = candidates.length > 1 ? candidates.filter((s) => s.id !== lastId) : candidates;
  const stats = (s) => statsOf(ratings, mode, s.id, activity);
  const untried = pool.filter((s) => stats(s).tried === 0);
  if (untried.length) return untried[Math.floor(Math.random() * untried.length)];

  // ★1 → 1、★3 → 9、★5 → 25 の重み。評価していない音は★3扱い
  const weights = pool.map((s) => (average(stats(s)) ?? 3) ** 2);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// 評価が付いている音を★平均の高い順に最大 n 個
export function topRated(candidates, ratings, mode, activity, n) {
  return candidates
    .map((s) => ({ s, avg: average(statsOf(ratings, mode, s.id, activity)) }))
    .filter(({ avg }) => avg !== null)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, n)
    .map(({ s }) => s);
}
