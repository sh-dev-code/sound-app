# SONE

sound と zone を合わせた名前。赤ちゃんモードと集中モードを切り替えて、状況に合った音を流すスマホ向けWebアプリ。要件は [CLAUDE.md](CLAUDE.md) を参照。

公開先：https://sh-dev-code.github.io/sound-app/

## iPhone のホーム画面に追加する

1. Safari で上のアドレスを開く
2. 画面下の共有ボタン（四角から上向き矢印）→「ホーム画面に追加」
3. ホーム画面の SONE アイコンから開くと、アプリのように全画面で使える

一度開くと、アプリ本体と音がスマホに保存され、電波がなくても使える。

## 技術

- 素のHTML＋JavaScript（ビルド不要。ファイルを置くだけで動く）
- 音の再生・生成：Web Audio API
- 保存：ブラウザ内（設定・評価・プレイリストは localStorage、画像は IndexedDB）
- ホーム画面に追加できる形（PWA）：`manifest.webmanifest` と `sw.js`

## フォルダ構成

```
index.html            アプリ本体の入口
manifest.webmanifest  ホーム画面に追加したときの名前・アイコン・色
sw.js                 電波がなくても使えるようにする仕組み（サービスワーカー）
sounds.json           音の一覧
sounds/               音声ファイル（.mp3 / .m4a）
icons/                アプリのアイコン
css/style.css         見た目
js/                   動き（main.js が中心）
```

`js/` にファイルを足したときは、`sw.js` の `APP_FILES` にも足すこと（電波がないときにも使えるように保存する一覧）。音声ファイルは `sounds.json` から自動で保存されるので、足さなくてよい。

## 音の追加方法

1. 音声ファイル（`.mp3` か `.m4a`）を `sounds/` フォルダに置く
   - 長さは **3分以内・3MB以内** が目安。iPhone は読み込んだ音をメモリに展開するため、長すぎると重くなる
   - 繰り返しのつなぎ目と音の大きさはアプリが自動で整えるので、加工は不要
2. `sounds.json` の `sounds` の中に1行足す（前の行の末尾に `,` を付けるのを忘れずに）

```json
{ "id": "rain", "name": "雨", "category": "nature", "type": "file", "file": "rain.mp3", "modes": ["focus"], "gain": 1.0, "credit": { "title": "素材名", "author": "作者名", "source": "https://入手元のURL", "license": "CC0" } }
```

| 項目 | 意味 |
| --- | --- |
| `id` | 音の識別名（英数字）。評価やプレイリストはこの名前で記録するので、後から変えない |
| `name` | 画面に出す名前 |
| `category` | 種類。再生画面ではこの種類ごとに見出しを付けて並べる。種類の一覧は `sounds.json` の `categories` にあり、増やすときはそこに1行足す |
| `type` | `generated`（プログラムで作る音）か `file`（音声ファイル） |
| `generator` | `generated` のときの音の種類：`white` / `pink` / `brown` / `womb`（胎内音風）/ `dryer`（ドライヤー風） |
| `file` | `file` のときの音声ファイル名（`sounds/` フォルダ内） |
| `modes` | 使えるモード：`baby`（赤ちゃん）、`focus`（集中） |
| `gain` | 音ごとの音量の微調整（1.0 が基準）。大きさは自動でそろえるが、それでも大きく・小さく聞こえる音だけ調整する |
| `credit` | 素材の作者・入手元・ライセンス。音声ファイルの場合は必須 |

## 素材のルール

- 商用利用できるフリー素材（CC0 など）だけを使い、`credit` に出典とライセンスを書く
- モスキート音のような不快な高周波の音は入れない
