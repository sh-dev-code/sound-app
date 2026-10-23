// 画像を一定時間ごとにふわっと切り替えて見せる
//
// 2 枚の <img> を重ねておき、表に出す方を入れ替えることでフェードさせる

export function createSlideshow(container) {
  const layers = [document.createElement('img'), document.createElement('img')];
  for (const img of layers) {
    img.className = 'slide';
    img.alt = '';
    container.append(img);
  }
  let urls = [];
  let index = 0;
  let front = 0;
  let timer = null;
  let interval = 0;

  function show(url) {
    const next = layers[1 - front];
    next.src = url;
    next.classList.add('shown');
    layers[front].classList.remove('shown');
    front = 1 - front;
  }

  function advance() {
    index = (index + 1) % urls.length;
    show(urls[index]);
  }

  function restartTimer() {
    clearInterval(timer);
    timer = null;
    if (interval && urls.length > 1) timer = setInterval(advance, interval * 1000);
  }

  return {
    // 見せる画像を入れ替える。同じ画像の並びなら何もしない
    setImages(next) {
      if (next.length === urls.length && next.every((u, i) => u === urls[i])) return;
      urls = next;
      index = 0;
      if (urls.length) show(urls[0]);
      else layers.forEach((img) => img.classList.remove('shown'));
      restartTimer();
    },
    // seconds 秒ごとに切り替える。0 なら止める
    play(seconds) {
      if (seconds === interval && (timer || urls.length < 2)) return;
      interval = seconds;
      restartTimer();
    },
    pause() {
      interval = 0;
      restartTimer();
    },
  };
}
