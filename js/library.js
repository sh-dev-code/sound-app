// 音の一覧（sounds.json）を読み込み、音を鳴らせる形（AudioBuffer）にする

import { createNoise, SAMPLE_RATE, TARGET_RMS } from './noise.js';

// mp3 の前後には無音のすき間が入るため、少し切り落とす
const EDGE_TRIM_SECONDS = 0.05;
// 末尾と先頭をこの長さだけ重ねて、繰り返しのつなぎ目を目立たなくする
const LOOP_FADE_SECONDS = 1.5;
// 環境音はノイズより少し控えめの大きさにそろえる
const FILE_TARGET_RMS = TARGET_RMS * 0.8;
// 小さすぎる素材を大きくするのは 10 倍まで
const MAX_BOOST = 10;
const LIMIT = 0.95;

export async function loadLibrary() {
  const res = await fetch('sounds.json');
  if (!res.ok) throw new Error(`sounds.json を読み込めません（${res.status}）`);
  return res.json();
}

// 読み込んだ音はメモリを大きく使うため、最近使ったものだけ取っておく
const CACHE_SIZE = 3;
const cache = new Map();

export function loadBuffer(ctx, sound) {
  if (cache.has(sound.id)) {
    const promise = cache.get(sound.id);
    cache.delete(sound.id);
    cache.set(sound.id, promise);
    return promise;
  }
  const promise = sound.type === 'file' ? fileBuffer(ctx, sound) : noiseBuffer(ctx, sound);
  // 失敗したら次回やり直せるようにする
  promise.catch(() => cache.delete(sound.id));
  cache.set(sound.id, promise);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return promise;
}

async function noiseBuffer(ctx, sound) {
  const samples = createNoise(sound.generator);
  const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

async function fileBuffer(ctx, sound) {
  const res = await fetch(`sounds/${sound.file}`);
  if (!res.ok) throw new Error(`${sound.file} を読み込めません（${res.status}）`);
  const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
  return prepareLoop(ctx, decoded);
}

// 前後を切り落とし、つなぎ目をなめらかにし、音の大きさをノイズとそろえる
function prepareLoop(ctx, src) {
  const rate = src.sampleRate;
  const trim = Math.floor(EDGE_TRIM_SECONDS * rate);
  const usable = src.length - trim * 2;
  const fade = Math.min(Math.floor(LOOP_FADE_SECONDS * rate), Math.floor(usable / 4));
  const length = usable - fade;
  const out = ctx.createBuffer(src.numberOfChannels, length, rate);

  let sq = 0;
  for (let c = 0; c < src.numberOfChannels; c++) {
    const x = src.getChannelData(c).subarray(trim, trim + usable);
    const y = out.getChannelData(c);
    for (let i = 0; i < length; i++) {
      let s = x[i];
      if (i < fade) {
        const t = i / fade;
        s = x[i] * Math.sqrt(t) + x[length + i] * Math.sqrt(1 - t);
      }
      y[i] = s;
      sq += s * s;
    }
  }

  const rms = Math.sqrt(sq / (length * src.numberOfChannels));
  const scale = Math.min(FILE_TARGET_RMS / rms, MAX_BOOST);
  const channels = [];
  for (let c = 0; c < out.numberOfChannels; c++) channels.push(out.getChannelData(c));
  for (const y of channels) for (let i = 0; i < length; i++) y[i] *= scale;
  limit(channels, rate);
  return out;
}

// 焚き火の「パチッ」のような瞬間的に大きな音は、そのまま大きくすると音が割れる。
// 大きな音の前後だけ滑らかに音量を下げて、LIMIT を超えないようにする
function limit(channels, rate) {
  const length = channels[0].length;
  const gain = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let a = 0;
    for (const y of channels) a = Math.max(a, Math.abs(y[i]));
    gain[i] = a > LIMIT ? LIMIT / a : 1;
  }
  // 後ろから：大きな音の少し手前から下げ始める
  const attack = 1 - Math.exp(-1 / (0.002 * rate));
  for (let i = length - 2; i >= 0; i--) {
    gain[i] = Math.min(gain[i], gain[i + 1] + (1 - gain[i + 1]) * attack);
  }
  // 前から：大きな音のあとはゆっくり戻す
  const release = 1 - Math.exp(-1 / (0.08 * rate));
  for (let i = 1; i < length; i++) {
    gain[i] = Math.min(gain[i], gain[i - 1] + (1 - gain[i - 1]) * release);
  }
  for (const y of channels) for (let i = 0; i < length; i++) y[i] *= gain[i];
}
