# カレンダー

**予定と実績を分けて残す、自分用の時間記録カレンダー。** スマホ主体のPWA。

- 公開URL：https://kirokubox.github.io/calendar-app/
- 要件の正本：`05_開発・Webアプリ/16_カレンダー/166_カレンダー_要件と経緯.md`
- 現在は Phase 1a（日表示・予定／実績の作成編集削除・日跨ぎ／重なり表示・終日・色とカテゴリ名・JSONバックアップ／復元）

## 画面

- 日表示：0:00〜24:00の時間軸。空きをタップ、または右下の＋で新規作成。イベントをタップで編集
- 実績は色で塗りつぶし、予定は白地＋色の枠線
- 入力シート：タイトル（過去タイトルの候補・同名なら前回の色を引き継ぎ）、終日、開始／終了、色（カテゴリ名つき）、詳細（予定／実績）
- 設定：色ごとのカテゴリ名、JSONの書き出し／復元、バージョン

## 開発

```
npm install
npm run dev        # http://127.0.0.1:5173/calendar-app/
npm run build      # 型チェック＋本番ビルド（変更後は必ず通す）
npm test           # 純粋ロジックのテスト（node --test）
```

スマホ実機確認（PCと同一Wi-Fi）：`npm.cmd run dev -- --host 0.0.0.0`

## データ保存とバックアップ

- 保存先はブラウザの IndexedDB（DB名 `calendar-app`、ストア `events` / `settings`）。**この端末のブラウザ内だけ**で、サーバー・クラウド・ログイン・自動同期はない
- 起動時に `navigator.storage.persist()` を要求する（ブラウザが自動削除しにくくなる。拒否されても動く）
- ブラウザのデータ消去・端末故障で失われうるため、設定画面の「JSONで書き出す」で定期的にバックアップする（`calendar-backup-YYYY-MM-DD.json`）
- 復元は「JSONから復元」：形式を検証し、件数・期間のプレビューを確認してから読み込む（同じidは上書き、それ以外は追加、色とカテゴリ名の設定は上書き）
- バックアップJSONは個人データ。リポジトリ・`public/` に置かない（`.gitignore` で `calendar-backup-*.json` を除外）

## 公開（GitHub Pages＋PWA）

- `main` に push すると GitHub Actions（`.github/workflows/deploy.yml`）が Pages へ自動デプロイ
- Vite の `base` は `/calendar-app/`（リポジトリ名に一致させる）
- Service Worker はビルドごとに版番号を刻印（`vite.config.ts` のプラグイン）。新しい版を検知したら自動で切り替えてリロードする
- 検索エンジンのインデックスは許可（`robots.txt` は `Allow: /`）
