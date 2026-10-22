# 音で集中＆寝かしつけアプリ

赤ちゃんモードと集中モードを切り替えて使う、音を流すスマホ向けWebアプリ。要件は [CLAUDE.md](CLAUDE.md) を参照。

## 技術

- 素のHTML＋JavaScript（ビルド不要。ファイルを置くだけで動く）
- 音の再生・生成：Web Audio API
- 保存：ブラウザ内（画像は IndexedDB）

## フォルダ構成

```
index.html     アプリ本体の入口
sounds.json    音の一覧
sounds/        音声ファイル（.mp3 / .m4a）
```

## 音の追加方法

1. 音声ファイル（`.mp3` か `.m4a`）を `sounds/` フォルダに置く
2. `sounds.json` の `sounds` の中に1行足す（前の行の末尾に `,` を付けるのを忘れずに）

```json
{ "id": "rain", "name": "雨", "type": "file", "file": "rain.mp3", "modes": ["focus"], "gain": 1.0, "credit": { "author": "作者名", "source": "https://入手元のURL", "license": "CC0" } }
```

| 項目 | 意味 |
| --- | --- |
| `id` | 音の識別名（英数字）。評価やプレイリストはこの名前で記録するので、後から変えない |
| `name` | 画面に出す名前 |
| `type` | `generated`（プログラムで作る音）か `file`（音声ファイル） |
| `generator` | `generated` のときの音の種類：`white` / `pink` / `brown` / `womb`（胎内音風）/ `dryer`（ドライヤー風） |
| `file` | `file` のときの音声ファイル名（`sounds/` フォルダ内） |
| `modes` | 使えるモード：`baby`（赤ちゃん）、`focus`（集中） |
| `gain` | 音ごとの音量補正（1.0 が基準）。音によって聞こえる大きさがバラバラにならないよう揃える |
| `credit` | 素材の作者・入手元・ライセンス。音声ファイルの場合は必須 |

## 素材のルール

- 商用利用できるフリー素材（CC0 など）だけを使い、`credit` に出典とライセンスを書く
- モスキート音のような不快な高周波の音は入れない
