# Claude Code 便利カタログ（PoC）

公式の プラグイン / スキル / MCP / 機能 をまとめた日本語カタログ（単一HTML）。

## ファイル
| ファイル | 役割 |
|---|---|
| `template.html` | 画面の枠（CSS/JS＋手書き解説データ）。`__PLUGINS_JSON__` / `__SKILLS_JSON__` / `__MCPS_JSON__` の差し込み口を持つ |
| `data/skills_meta.json` | スキルの日本語メタ（name/description/category） |
| `data/mcp_meta.json` | MCPの日本語メタ（name/folder/description） |
| `data/desc_ja.json` | プラグイン説明の日本語訳キャッシュ（名前→日本語、222件） |
| `data/docs_watch.json` | 監視する公式ドキュメント一覧（key/label/page/gsec） |
| `build.js` | 公式ソース取得＋メタ合成 → `index.html` を生成 |
| `index.html` | 生成物（配信対象） |
| `snapshots/` | 差分検出の状態（前回スナップショット `catalog.json` / 履歴 `changelog.json` / バッジ `badges.json`） |
| `setup_template.js` | 一回限り: 旧 index.html から template とメタを切り出した初期化スクリプト（通常使わない） |
| `.github/workflows/update.yml` | 無人運用: 日次cronで取得→生成→差分コミット→GitHub Pages公開 |

## ビルド
```
node build.js
```
- **プラグイン**: 公式 `marketplace.json` から毎回取得（最新の222件など）。説明は `data/desc_ja.json`（日本語訳キャッシュ）で上書き表示。未翻訳の新規は原文表示＋ビルドログに件数を通知 → `desc_ja.json` に追記。
- **スキル**: `anthropics/skills` の `/skills` をGitHub APIで取得し、`data/skills_meta.json` の日本語メタを合成。
- **MCP**: `modelcontextprotocol/servers` の `/src` を取得し、`data/mcp_meta.json` を合成。
- 公式に**新規追加**された項目はメタ未整備でも自動でカード化（説明は名前で仮表示）し、ビルドログに `NEW ...` と通知 → `data/*meta.json` に日本語説明を追記すればOK。
- 取得失敗時（オフライン等）は data メタの固定一覧にフォールバック。
- `GITHUB_TOKEN` 環境変数があればGitHub APIのレート制限を緩和（Actions向け）。
- 出力 `index.html` をブラウザで開く（`file://` 可。確実に見るなら簡易サーバ: `python -m http.server` など）。

## 公式ドキュメントの更新検知（F3）
- `data/docs_watch.json` の各公式ドキュメント（skills/plugins/mcp/settings/hooks/github-actions/routines/slack）の `.md` を取得し、**本文ハッシュのみ**を `snapshots/docs.json` に保存（本文は保存しない）。
- 前回ハッシュと違えば「更新あり」と判定し、`最終更新日` を記録。使い方ガイドの該当セクション上部に「📄 公式: 最終更新YYYY-MM-DD ⚠更新あり（要確認）」を表示し、「更新履歴」タブにも記載。
- 内容の自動書き換えはしない（かみくだき自作文を保持）。人が公式リンクを見て手で更新する運用。

## 差分検出・更新履歴・バッジ
- ビルドのたびに `snapshots/catalog.json`（前回の各アイテムの署名）と比較し、**追加/更新/削除**を検出。
- 変更があれば `snapshots/changelog.json` に日付つきで記録し、画面の **「更新履歴」タブ**に表示。
- 直近の変更は `snapshots/badges.json` に記録し、カードに **NEW / UPDATED** バッジを表示（変更が無い回は前回のバッジを維持）。
- 初回は「初期登録（ベースライン）」を記録。
- リセットしたい場合は `snapshots/` を削除して再ビルド。

## データと解説の分離（自動更新の前提）
- **定義（自動取得対象）**: プラグイン一覧（marketplace.json）／スキル一覧（anthropics/skills）／MCP一覧（mcp servers）。公式から自動追従。
- **手書きの解説（維持対象）**: 利用シーン/解決する課題/使用イメージ/QA/公式機能/設定/日本語説明 などは `template.html` 内の JS データ、スキル/MCPの日本語メタは `data/*.json` に保持。

## 無人運用（GitHub Actions + Pages）
`.github/workflows/update.yml` が日次で「公式取得 → `index.html` 再生成 → 差分をコミット → GitHub Pages 公開」を自動実行します。

### 初回セットアップ（このフォルダをリポジトリ root にする想定）
1. GitHub で **public リポジトリ**を作成。
2. この `poc/` の中身を**リポジトリ直下**に push（`build.js` / `template.html` / `data/` / `snapshots/` / `.github/` が root に来るように）。
3. リポジトリの **Settings → Pages → Build and deployment → Source = GitHub Actions** を選択。
4. **Actions** タブで `Update catalog` を一度 **Run workflow**（手動実行）。以後は毎日自動。

### 動作
- 毎日 **00:00 UTC（= 09:00 JST）** に実行（`cron: "0 0 * * *"`）。`workflow_dispatch` で手動実行も可。
- 変更があった時だけ `index.html` と `snapshots/`（前回比較・更新履歴・バッジ）をコミット。
- 生成HTMLは GitHub Pages のURLで公開。通知はせず「更新履歴」タブで差分を確認。
- `GITHUB_TOKEN`（Actions標準）でGitHub APIのレート制限を緩和。追加のシークレットは不要。

> 翻訳API等は不要（プラグイン説明は原文、スキル/MCP/機能/設定の日本語は data/template に保持）。
