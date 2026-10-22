// 設定画面

const CROSSFADES = [0, 1, 3, 5, 10];

// 見本の色は css/style.css の配色と合わせる（背景・面・集中の色・赤ちゃんの色）
const THEMES = [
  { id: 'night', name: 'よぞら', colors: ['#10131c', '#252b3d', '#8fb9c9', '#c9b2e0'] },
  { id: 'forest', name: 'もり', colors: ['#0f1714', '#22302a', '#9cc79a', '#e0b98f'] },
  { id: 'warm', name: 'ぬくもり', colors: ['#f5eee5', '#ebe0d2', '#b5714f', '#a9768f'] },
  { id: 'clean', name: 'しろ', colors: ['#f3f5f8', '#e6eaf0', '#2f7fb8', '#8a6cc7'] },
  { id: 'auto', name: '自動', colors: ['#f3f5f8', '#2f7fb8', '#10131c', '#8fb9c9'] },
];

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(node, rest);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
}

// onTheme(配色ID)、onCrossfade(秒)、onReset('ratings' | 'playlists' | 'all') は変更を実際に行う側の関数
export function createSettingsView({ root, settings, fileSounds, onTheme, onCrossfade, onReset }) {
  function render() {
    const themes = el('div', { className: 'themes' },
      ...THEMES.map((t) => {
        const b = el('button', { type: 'button', className: 'theme-option', dataset: { theme: t.id } },
          el('span', { className: 'swatch' }, ...t.colors.map((c) => {
            const s = el('span');
            s.style.background = c;
            return s;
          })),
          el('span', { textContent: t.name }),
        );
        b.setAttribute('aria-pressed', t.id === settings.theme);
        return b;
      }),
    );

    const crossfade = el('div', { className: 'segmented' },
      ...CROSSFADES.map((s) => {
        const b = el('button', { type: 'button', textContent: s ? `${s}秒` : 'なし', dataset: { crossfade: s } });
        b.setAttribute('aria-pressed', s === settings.crossfade);
        return b;
      }),
    );

    const credits = el('ul', { className: 'credits' },
      ...fileSounds().map((s) =>
        el('li', {},
          el('span', { textContent: `${s.name}：` }),
          el('a', { href: s.credit.source, target: '_blank', rel: 'noopener', textContent: `${s.credit.title}` }),
          el('span', { textContent: `（${s.credit.author}、${s.credit.license}）` }),
        ),
      ),
    );

    root.replaceChildren(
      el('h1', { className: 'view-title', textContent: '設定' }),
      el('section', {},
        el('h2', { textContent: '画面の色' }),
        themes,
        el('p', { className: 'note', textContent: '「自動」は iPhone のライト／ダーク設定に合わせて切り替わります。' }),
      ),
      el('section', {},
        el('h2', { textContent: 'クロスフェード' }),
        crossfade,
        el('p', { className: 'note', textContent: 'プレイリストで次の音に切り替わるとき、この時間をかけて前の音を小さく・次の音を大きくします。' }),
      ),
      el('section', {},
        el('h2', { textContent: '赤ちゃんモードについて' }),
        el('p', { className: 'notice', textContent: '音量は小さめにして、スマホは赤ちゃんの耳元から離して置いてください。寝かしつけ中は画面を暗くするか、消しておくのがおすすめです。' }),
      ),
      el('section', {},
        el('h2', { textContent: 'データのリセット' }),
        el('div', { className: 'stack' },
          el('button', { type: 'button', className: 'danger', textContent: '★評価と試した回数を消す', dataset: { reset: 'ratings' } }),
          el('button', { type: 'button', className: 'danger', textContent: 'プレイリストをすべて消す', dataset: { reset: 'playlists' } }),
          el('button', { type: 'button', className: 'danger', textContent: 'すべてのデータと設定を消す', dataset: { reset: 'all' } }),
        ),
        el('p', { className: 'note', textContent: 'データはこのスマホの中だけに保存されています。消すと元に戻せません。' }),
      ),
      el('section', {},
        el('h2', { textContent: 'このアプリについて' }),
        el('p', { className: 'note', textContent: '自分や赤ちゃんに合う音を探すためのアプリです。音の効果には個人差があります。' }),
        el('h2', { textContent: '音素材の出典' }),
        credits,
      ),
    );
  }

  const MESSAGES = {
    ratings: '★評価と試した回数をすべて消しますか？',
    playlists: 'プレイリストをすべて消しますか？',
    all: 'すべてのデータと設定を消して、最初の状態に戻しますか？',
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.theme) {
      onTheme(b.dataset.theme);
      render();
    } else if (b.dataset.crossfade !== undefined) {
      onCrossfade(Number(b.dataset.crossfade));
      render();
    } else if (b.dataset.reset && confirm(MESSAGES[b.dataset.reset])) {
      onReset(b.dataset.reset);
    }
  });

  return { render };
}
