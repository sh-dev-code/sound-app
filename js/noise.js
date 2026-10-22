// ノイズをプログラムで作る

export const SAMPLE_RATE = 44100;
const LOOP_SECONDS = 15;
const LOOP_FADE_SECONDS = 0.5;
const TARGET_RMS = 0.15;

const white = () => Math.random() * 2 - 1;

// Paul Kellet の近似式
function pinkSource() {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = white();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return out;
  };
}

function brownSource() {
  let last = 0;
  return () => {
    last = (last + 0.02 * white()) / 1.02;
    return last;
  };
}

// 指定した周波数より高い音を弱める
function lowpass(source, hz) {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / SAMPLE_RATE);
  let y = 0;
  return () => (y += a * (source() - y));
}

// ゆっくり大きく・小さくなる揺らぎ（ループの長さで割り切れる周波数にすること）
const pulse = (hz, depth) => (out) => {
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    out[i] *= 1 - depth * (0.5 + 0.5 * Math.cos(2 * Math.PI * hz * t));
  }
};

// モーターのような低い「ブーン」音を重ねる（ループの長さで割り切れる周波数にすること）
const hum = (hz, amount) => (out) => {
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    out[i] += amount * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(4 * Math.PI * hz * t));
  }
};

const generators = {
  white: () => ({ next: white }),
  pink: () => ({ next: pinkSource() }),
  brown: () => ({ next: brownSource() }),
  womb: () => ({ next: lowpass(brownSource(), 350), post: pulse(1.2, 0.35) }),
  dryer: () => ({ next: lowpass(pinkSource(), 2500), post: hum(120, 0.04) }),
};

const cache = new Map();

// 繰り返し再生してもつなぎ目が分からない長さ LOOP_SECONDS の音データを返す
export function createNoise(type) {
  if (cache.has(type)) return cache.get(type);
  const make = generators[type];
  if (!make) throw new Error(`未対応のノイズ: ${type}`);

  const { next, post } = make();
  for (let i = 0; i < SAMPLE_RATE; i++) next(); // 立ち上がりの揺れを捨てる

  const length = LOOP_SECONDS * SAMPLE_RATE;
  const fade = LOOP_FADE_SECONDS * SAMPLE_RATE;
  const raw = new Float32Array(length + fade);
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    raw[i] = next();
    sum += raw[i];
  }

  // 直流成分を取り除き、種類が違っても同じくらいの大きさにそろえる
  const mean = sum / raw.length;
  let sq = 0;
  for (let i = 0; i < raw.length; i++) {
    raw[i] -= mean;
    sq += raw[i] * raw[i];
  }
  const scale = TARGET_RMS / Math.sqrt(sq / raw.length);

  // 末尾の続きを先頭に重ねて、最後→最初へ自然につながるようにする
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let s = raw[i];
    if (i < fade) {
      const t = i / fade;
      s = raw[i] * Math.sqrt(t) + raw[length + i] * Math.sqrt(1 - t);
    }
    out[i] = s * scale;
  }
  if (post) post(out);
  for (let i = 0; i < length; i++) out[i] = Math.max(-0.99, Math.min(0.99, out[i]));

  cache.set(type, out);
  return out;
}

// 音データを WAV 形式（音声ファイルと同じ形）に変換する
export function encodeWav(samples, gain) {
  const bytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const text = (offset, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, bytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] * gain));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
