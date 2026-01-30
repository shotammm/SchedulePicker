# Schedule Picker

Schedule Picker は、週次の空き時間をクリック/ドラッグで選択し、JST と任意のタイムゾーンで共有できるテキストを出力するシンプルなブラウザアプリです。

## ファイル構成

```
.
├── index.html         # 画面のマークアップ
├── css/
│   └── style.css      # スタイル
├── js/
│   └── app.js         # アプリのロジック
└── timezone_list.csv  # 追加タイムゾーン一覧
```

## 使い方

1. ブラウザで `index.html` を開きます。
2. 週移動やドラッグで時間帯を選択します。
3. 出力欄をクリックするとクリップボードにコピーされます。

`timezone_list.csv` を読み込ませるにはローカルサーバーでの起動を推奨します。

```bash
python -m http.server
```

起動後に `http://localhost:8000` を開いてください。

## 開発メモ

- CSS と JavaScript を分離して保守しやすい構成に整理しています。
- ファイル直開き (`file://`) の場合は埋め込みタイムゾーン一覧を使用します。
