// 音の一覧（sounds.json）を読み込み、音を鳴らせる形（AudioBuffer）にする

import { createNoise, SAMPLE_RATE, TARGET_RMS } from './noise.js';

// mp3 の前後には無音のすき間が入るため、少し切り落とす
const EDGE_TRIM_SECONDS = 0.05;
// 末尾と先頭をこの長さだけ重ねて、繰り返しのつなぎ目を目立たなくする
const LOOP_FADE_SECONDS = 1.5;

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
  let peak = 0;
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
      peak = Math.max(peak, Math.abs(s));
    }
  }

  const rms = Math.sqrt(sq / (length * src.numberOfChannels));
  const scale = Math.min(TARGET_RMS / rms, 0.99 / peak);
  for (let c = 0; c < out.numberOfChannels; c++) {
    const y = out.getChannelData(c);
    for (let i = 0; i < length; i++) y[i] *= scale;
  }
  return out;
}
