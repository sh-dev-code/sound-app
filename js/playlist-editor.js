// プレイリスト画面：一覧と編集

import { savePlaylists, addPlaylist, totalSeconds, formatMinutes, SILENCE } from './playlists.js';

const MINUTES = [1, 3, 5, 10, 15, 20, 25, 30, 45, 60, 90];
const DEFAULT_MINUTES = 25;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(node, rest);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
}

function minutesSelect(value, dataset) {
  const select = el('select', { dataset, ariaLabel: '再生時間' });
  select.append(...MINUTES.map((m) => new Option(`${m}分`, m)));
  select.value = value;
  return select;
}

// root: 画面の入れ物、playlists: 保存されているプレイリストの配列（直接書き換える）
// availableSounds: 並べられる音の一覧を返す関数、onChange: 変更があったときに呼ぶ
export function createPlaylistEditor({ root, playlists, availableSounds, onChange }) {
  let editingId = null;
  const editing = () => playlists.find((p) => p.id === editingId);
  const choices = () => [...availableSounds(), SILENCE];
  const soundName = (id) => choices().find((s) => s.id === id)?.name ?? '（見つからない音）';

  function commit() {
    savePlaylists(playlists);
    onChange();
    render();
  }

  function renderList() {
    const items = playlists.map((pl) =>
      el('li', {},
        el('button', { type: 'button', className: 'pl-card', dataset: { open: pl.id } },
          el('span', { className: 'pl-card-name', textContent: pl.name }),
          el('span', {
            className: 'pl-card-meta',
            textContent: `${pl.items.length}曲・${formatMinutes(totalSeconds(pl))}・ループ${pl.loop ? 'あり' : 'なし'}`,
          }),
        ),
      ),
    );
    root.replaceChildren(
      el('h1', { className: 'view-title', textContent: 'プレイリスト' }),
      el('p', { className: 'note', textContent: '集中モードの「プレイリスト」で、並べた順に音を流します。' }),
      playlists.length
        ? el('ul', { className: 'pl-cards' }, ...items)
        : el('p', { className: 'notice', textContent: 'まだプレイリストがありません。' }),
      el('button', { type: 'button', className: 'primary', textContent: '＋ 新しいプレイリスト', dataset: { action: 'new' } }),
    );
  }

  function renderEditor(pl) {
    const rows = pl.items.map((item, i) =>
      el('li', { className: 'pl-item', dataset: { index: i } },
        el('span', { className: 'drag-handle', textContent: '≡', ariaLabel: 'ドラッグで並べ替え' }),
        el('span', { className: 'pl-item-name', textContent: soundName(item.sound) }),
        minutesSelect(item.minutes, { minutesIndex: i }),
        el('button', { type: 'button', className: 'icon', textContent: '↑', ariaLabel: '上へ', disabled: i === 0, dataset: { up: i } }),
        el('button', { type: 'button', className: 'icon', textContent: '↓', ariaLabel: '下へ', disabled: i === pl.items.length - 1, dataset: { down: i } }),
        el('button', { type: 'button', className: 'icon', textContent: '✕', ariaLabel: '削除', dataset: { remove: i } }),
      ),
    );

    const addSound = el('select', { id: 'pl-add-sound', ariaLabel: '追加する音' });
    addSound.append(...choices().map((s) => new Option(s.name, s.id)));

    root.replaceChildren(
      el('button', { type: 'button', className: 'back', textContent: '← プレイリスト一覧', dataset: { action: 'back' } }),
      el('label', { className: 'field' },
        el('span', { textContent: '名前' }),
        el('input', { type: 'text', id: 'pl-name', value: pl.name, maxLength: 30 }),
      ),
      el('section', {},
        el('h2', { textContent: '音の並び' }),
        pl.items.length
          ? el('ol', { className: 'pl-items' }, ...rows)
          : el('p', { className: 'note', textContent: '下から音を追加してください。' }),
        el('div', { className: 'pl-add' },
          addSound,
          minutesSelect(DEFAULT_MINUTES, { addMinutes: '' }),
          el('button', { type: 'button', className: 'primary', textContent: '追加', dataset: { action: 'add' } }),
        ),
        el('p', { className: 'note', textContent: '休憩をはさみたいときは「無音」を並べてください。' }),
      ),
      el('label', { className: 'toggle' },
        el('input', { type: 'checkbox', id: 'pl-loop', checked: pl.loop }),
        el('span', { textContent: '最後まで行ったら最初に戻る（ループ）' }),
      ),
      el('p', { className: 'note', textContent: `合計 ${formatMinutes(totalSeconds(pl))}。変更は次に再生したときから反映されます。` }),
      el('button', { type: 'button', className: 'danger', textContent: 'このプレイリストを削除', dataset: { action: 'delete' } }),
    );
  }

  function render() {
    const pl = editing();
    if (pl) renderEditor(pl);
    else {
      editingId = null;
      renderList();
    }
  }

  function move(from, to) {
    const { items } = editing();
    if (to < 0 || to >= items.length) return;
    items.splice(to, 0, ...items.splice(from, 1));
    commit();
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const pl = editing();
    const { action, open, up, down, remove } = t.dataset;
    if (action === 'new') {
      editingId = addPlaylist(playlists).id;
      commit();
    } else if (open) {
      editingId = open;
      render();
    } else if (action === 'back') {
      editingId = null;
      render();
    } else if (action === 'add') {
      const minutes = Number(root.querySelector('[data-add-minutes]').value);
      pl.items.push({ sound: root.querySelector('#pl-add-sound').value, minutes });
      commit();
    } else if (action === 'delete') {
      if (!confirm(`「${pl.name}」を削除しますか？`)) return;
      playlists.splice(playlists.indexOf(pl), 1);
      editingId = null;
      commit();
    } else if (up !== undefined) {
      move(Number(up), Number(up) - 1);
    } else if (down !== undefined) {
      move(Number(down), Number(down) + 1);
    } else if (remove !== undefined) {
      pl.items.splice(Number(remove), 1);
      commit();
    }
  });

  root.addEventListener('change', (e) => {
    const pl = editing();
    if (!pl) return;
    if (e.target.dataset.minutesIndex !== undefined) {
      pl.items[Number(e.target.dataset.minutesIndex)].minutes = Number(e.target.value);
      commit();
    } else if (e.target.id === 'pl-loop') {
      pl.loop = e.target.checked;
      commit();
    }
  });

  // 名前は入力中に画面を作り直すと文字が打ちにくいので、保存だけする
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'pl-name') return;
    editing().name = e.target.value.trim() || '名前なし';
    savePlaylists(playlists);
    onChange();
  });

  // 「≡」をつかんで上下に動かすと並べ替えられる。
  // つかんだ行は指にそのままついてきて、ほかの行は行き先をあけるようにスッとずれる。
  // 行そのものは離すまで動かさず、見た目だけずらす（iPhone がつかんでいる要素を見失わないように）
  root.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    e.preventDefault();
    const row = handle.closest('.pl-item');
    const rows = [...row.parentElement.children];
    const from = rows.indexOf(row);
    const boxes = rows.map((r) => r.getBoundingClientRect());
    // 1 行分ずらす距離（行の高さ＋すき間）
    const step = rows.length > 1 ? boxes[1].top - boxes[0].top : boxes[0].height;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let to = from;
    row.classList.add('dragging');
    rows.forEach((r) => r !== row && r.classList.add('shifting'));

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      // 先頭より上・最後より下には行かないようにする
      const dy = Math.min(
        Math.max(ev.clientY - startY, boxes[0].top - boxes[from].top),
        boxes[rows.length - 1].top - boxes[from].top,
      );
      row.style.transform = `translateY(${dy}px) scale(1.03)`;
      const center = boxes[from].top + boxes[from].height / 2 + dy;
      to = boxes.filter((b, i) => i !== from && b.top + b.height / 2 < center).length;
      rows.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -step;
        if (to < from && i >= to && i < from) shift = step;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    // ドラッグ中に画面がスクロールしないようにする
    const blockScroll = (ev) => ev.preventDefault();
    const onUp = (ev) => {
      if (ev.pointerId !== pointerId) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.removeEventListener('touchmove', blockScroll);
      if (to === from) {
        // 動かさなかったときは、元の位置へスッと戻す
        row.classList.remove('dragging');
        rows.forEach((r) => { r.style.transform = ''; });
        setTimeout(() => rows.forEach((r) => r.classList.remove('shifting')), 200);
        return;
      }
      // 行き先の位置へスッと収めてから、並び順を確定する
      row.classList.add('dropping');
      row.style.transform = `translateY(${(to - from) * step}px)`;
      setTimeout(() => {
        const { items } = editing();
        items.splice(to, 0, ...items.splice(from, 1));
        commit();
      }, 160);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('touchmove', blockScroll, { passive: false });
  });

  // 指定したプレイリストの編集画面を開く
  function open(id) {
    editingId = id;
    render();
  }

  return { render, open };
}
