// ユーザーが追加した画像を、この端末の中（IndexedDB）だけに保存する。外部には送らない
//
// 画像: { id, mode: 'baby' | 'focus', blob, createdAt }

const DB_NAME = 'sound-app';
const STORE = 'images';
// 保存前に、長い辺がこの大きさになるよう縮める
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;
export const MAX_IMAGES_PER_MODE = 30;

let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('mode', 'mode');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// store に対する操作を 1 つ行い、結果を返す
async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listImages(mode) {
  const all = await run('readonly', (store) => store.index('mode').getAll(mode));
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addImage(mode, file) {
  const blob = await shrink(file);
  return run('readwrite', (store) => store.add({ mode, blob, createdAt: Date.now() }));
}

export function deleteImage(id) {
  return run('readwrite', (store) => store.delete(id));
}

export function clearImages() {
  return run('readwrite', (store) => store.clear());
}

// 写真を、長い辺が MAX_SIDE 以下の JPEG に縮める（小さい画像はそのまま縮めずに JPEG にする）
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を変換できませんでした'))), 'image/jpeg', JPEG_QUALITY);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
