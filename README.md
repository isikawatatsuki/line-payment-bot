[![License](https://img.shields.io/github/license/isikawatatsuki/line-payment-bot)](https://github.com/isikawatatsuki/line-payment-bot/blob/main/LICENSE)
# LINE 支払いBOT

LINEグループ内の月次・単発支払いを管理し、支払日に支払い者別の合計と内訳をLINEへ通知するBOTです。支払い項目の登録・編集・削除と支払い完了操作はWebダッシュボードで行い、LINEはグループ・メンバーの同期と通知の送信のみを担当します。支払い実績は項目マスタから分離し、作成時点の名称・金額をスナップショットとして保存します。

## 技術構成

- TypeScript / Hono
- Cloudflare Workers / D1（本番・無料枠）
- Cloudflare Cron Triggers
- Kysely / MariaDB（ローカル・AWS向け互換実装）
- LINE Messaging API / LINE Login
- Vitest

HTTP/Lambda層、アプリケーションサービス、外部I/Oポート、Kysely実装を分離しています。LINE APIは `LineClient`、永続化は `Store` インターフェース越しに利用するためテストでは実通信しません。Webダッシュボード（`src/dashboard.ts`）はCloudflare D1に直接アクセスするため、現状Cloudflare環境専用の機能です。

## インフラ構成

![LINE支払いBOTのインフラ構成図](docs/architecture.svg)

本番はCloudflare WorkersとD1で完結します。Cron TriggerはUTC 21:00に実行され、日本時間では毎朝06:00です。ローカル開発時のみ、D1の代わりにKysely経由でMariaDBを利用できます。

## セットアップ

```bash
npm install
copy .env.example .env
npm run migrate
npm run dev
```

環境変数:

| 名前 | 必須 | 内容 |
|---|---:|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes | Messaging APIチャネルアクセストークン |
| `LINE_CHANNEL_SECRET` | Yes | Webhook署名検証用シークレット |
| `DATABASE_URL` | Yes | `mysql://user:pass@host:3306/db` |
| `APP_TIMEZONE` | No | 既定値 `Asia/Tokyo` |
| `PORT` | No | ローカルHTTPポート。既定値3000 |
| `INTERNAL_ADMIN_TOKEN` | Yes（`/internal/*`利用時） | リリース時の一斉案内エンドポイントを叩くための認証トークン |
| `WORKER_URL` | No | `npm run cf:announce` が叩く対象URL、および通知メッセージに載せるダッシュボードリンクの基点URL。既定値は本番Worker URL |

MariaDBに空のデータベースを作成してから `npm run migrate` を実行してください。初回マイグレーションは6テーブル、外部キー、一意制約、検索インデックスを作成します。マイグレーションは初回専用で、同じDBへ再実行しないでください。

## LINE公式アカウント・LINE Developers設定

Messaging APIチャネルはLINE Developersコンソールから直接作成できません。次の順序で準備します。

1. LINE Business IDを用意し、LINE公式アカウントを作成します。
2. LINE Official Account Managerで対象アカウントの「設定」→「Messaging API」を開き、Messaging APIを有効化します。
3. 連携するプロバイダーを慎重に選択します。一度選ぶと、後から別プロバイダーへ変更したり連携を解除したりできません。
4. LINE Developersコンソールへ同じアカウントでログインし、選択したプロバイダー配下に作成されたMessaging APIチャネルを確認します。
5. チャネルのMessaging API設定でWebhookを有効化し、Webhook URLを `https://<API Gateway host>/webhook` に設定します。
6. BOTのグループ・複数人トーク参加を許可します。
7. 応答メッセージは無効化し、必要なら参加時メッセージも無効化します。
8. Webhook検証を実行します。

公式手順: https://developers.line.biz/ja/docs/messaging-api/getting-started/

Webhookは `x-line-signature` をHMAC-SHA256で検証します。処理するのはグループ参加・退出とメンバー参加・退出のみで、テキストメッセージへの応答は行いません（支払い項目の登録・編集・削除、支払い完了はすべてWebダッシュボードで行うため）。BOTは引き続きLINEグループに参加させておく必要があります。通知の送信（push）とLINE Loginでの本人紐付けにグループ・メンバー情報が必要なためです。

## Webでの操作（貸与ページ・返済ページ）

支払い項目の管理と支払い完了操作は、同じCloudflare Workerが提供する `/dashboard` で行います。認証はLINE Loginのみで、管理者パスワードのような特別なモードはありません。グループのLINEメンバーであれば、誰でも次の2つのページを利用できます。

- **貸与ページ**（`/dashboard/items`）: 支払い項目の一覧・新規登録・編集・無効化を行います。金額・総額（任意）・支払いサイクル（毎月／単発）・支払い者（グループメンバーから選択）を設定します。対象グループの実際のメンバーであることをサーバー側で確認してから操作を許可します。
- **返済ページ**（`/dashboard`）: 自分が支払い者になっている項目の状況を確認し、当月分に未完了の支払いがあれば「今月の支払いを完了にする」ボタンで完了操作を行います。

どちらのページからも、もう一方のページへのリンクがあります。ダッシュボードのURLは次の通りです。ブックマークしておくか、支払い依頼・期限通知のLINEメッセージに含まれるリンクから開いてください。

```text
https://line-payment-bot.tatumagichannel.workers.dev/dashboard
```

## 定期通知

Cloudflare Cron Trigger（またはAWS Lambdaの`scheduled`）を毎日JST 06:00（UTC 21:00）に起動します。

1. 期限3日前に支払い依頼を通知
2. 支払当日の朝に期限当日通知
3. 未払いの場合、期限翌日から3日おきに期限超過通知
4. グループ・支払い者・期限単位でまとめてLINE Push Messageを送信

各通知には `WORKER_URL` から組み立てたダッシュボードへのリンクを添付し、そのままWebで状況確認・支払い完了ができるようにします（`WORKER_URL` 未設定時はリンクなしで送信されます）。支払い依頼・当日・期限超過の送信日時を実績ごとに保存し、同日の再実行による重複通知を防ぎます。送信失敗時は未通知のまま残り、次回の対象日に再試行されます。

## テストとビルド

```bash
npm run build
npm test
npm run check
```

テストは金額・年月・月末補正、Webhookのグループ・メンバー同期、署名検証、支払い項目登録フォームのバリデーション、実績スナップショット、通知の二重送信防止、リリース告知の冪等性を含みます。LINE APIとD1はモックです。

## Cloudflareへデプロイ（推奨）

Cloudflare Workers FreeとD1 Freeを利用します。Wranglerへログインし、D1を作成した後、`wrangler.jsonc`の`database_id`を作成結果に置き換えます。

```bash
npx wrangler login
npx wrangler d1 create line-payment-bot
npm run cf:migrate:remote
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npm run cf:deploy
```

CronはUTC `5 15 * * *`、つまりJSTの毎日00:05に実行されます。現在の本番Webhook URLは次の通りです。

```text
https://line-payment-bot.tatumagichannel.workers.dev/webhook
```

ローカルD1検証:

```bash
npm run cf:migrate:local
npm run cf:dev
```

`.dev.vars`にLINEの2つの秘密情報を設定すると、ローカルWorkerでも確認できます。`.dev.vars`と`.wrangler/`はGit管理外です。

## Webダッシュボード

同じCloudflare Workerの `/dashboard` で、支払いデータの可視化と操作（登録・編集・削除・支払い完了）を行います。

- 月別の対象金額・支払い済み金額・完了率（自分の分）
- 月別推移グラフ
- 支払い状況のドーナツグラフ
- 項目別・支払い者別の内訳
- 総額を設定した項目の残金一覧
- 支払い項目の登録・編集・無効化フォーム（貸与ページ）
- 支払い完了ボタン（返済ページ）
- LINEグループと対象月の切り替え（複数グループに参加している場合はグループも切り替え可能）

ログインはLINE Loginのみです。本人確認後、自分が所属するグループのみアクセスでき、貸与ページ・返済ページのどちらもそのグループのメンバーであれば操作できます。ログインセッションは7日間有効です。

LINE Developersで、Messaging APIチャネルと同じプロバイダーに「LINEログイン」チャネル（ウェブアプリ）を作成し、コールバックURLへ次を登録します。

```text
https://line-payment-bot.tatumagichannel.workers.dev/dashboard/line/callback
```

LINEログインチャネルの認証情報とセッション署名用シークレットはCloudflare Secretへ登録します（いずれも必須。LINE Loginがダッシュボードの唯一の認証手段のため）。

```bash
npx wrangler secret put LINE_LOGIN_CHANNEL_ID
npx wrangler secret put LINE_LOGIN_CHANNEL_SECRET
npx wrangler secret put DASHBOARD_SESSION_SECRET
```

`DASHBOARD_SESSION_SECRET` は32文字以上のランダム文字列を設定します。未設定または短すぎる場合、あるいはLINE Loginの認証情報が未設定の場合、ダッシュボードはFail Closedで起動を拒否します。認証CookieはHttpOnly・Secure・SameSite=Laxで、7日後に失効します。

## AWSへデプロイ（代替構成）

`serverless.yml` はServerless Framework向けの設定例です。

```bash
npm run build
npx serverless deploy
```

LambdaからMariaDBへ到達できるVPC・Security Group・接続情報を設定してください。RDS Proxy等による接続数制御を推奨します。デプロイ後のAPI Gateway URLをLINE DevelopersのWebhook URLへ設定します。

**制約**: Webダッシュボード（`src/dashboard.ts`）はCloudflare D1専用の実装のため、AWS/MariaDB構成では支払い項目の登録・編集・支払い完了を行うWeb UIがありません。この構成を運用する場合は、別途MariaDB対応の管理画面を用意する必要があります。

## DB設計

- `line_groups`: LINEグループ
- `line_members`: グループ単位のLINEメンバー
- `payment_items`: 支払い項目マスタ（`total_amount` で分割払いの総額を任意設定）
- `payment_records`: 月次実績と名称・金額スナップショット
- `processed_line_events`: Webhookイベントの処理済み記録
- `group_announcements`: リリース告知（`ReleaseAnnouncer`）のグループ単位送信済み記録

`conversation_states` テーブル、`line_groups.friend_add_announced_at` カラム、`dashboard_login_attempts` テーブルは、LINEチャットでの会話操作・友だち追加案内機能・管理者パスワードログインをそれぞれ廃止したことに伴いアプリからは使用しなくなりました。データ削除を伴うためマイグレーションでの削除は行わず、DB上に残していますが実害はありません。

DB日時はUTC、ユーザー表示はAsia/Tokyoです。金額は `BIGINT UNSIGNED`、アプリ内では安全な整数として扱います。

## 手動確認

1. BOTをテストグループへ追加し、`line_groups`/`line_members` が作成されることを確認
2. グループのメンバーとしてLINEでダッシュボードにログインし、`/dashboard/items` から支払い項目を新規登録できることを確認
3. グループに所属していないLINEアカウントでは、`?group=` を書き換えてもそのグループの項目管理・支払い完了ができないことを確認
4. 登録した項目を編集・無効化し、過去実績のスナップショットが変更されないことを確認
5. `/dashboard` で自分が支払い者になっている項目だけが表示されることを確認
6. Scheduler（Cron Trigger／Lambda）をテスト日付で起動し、通知とダッシュボードリンクが届くことを確認
7. Schedulerを再実行し、再通知されないことを確認
8. 「今月の支払いを完了にする」を実行し、`payment_records.status` が更新され、再実行しても二重更新されないことを確認

## 制約・トラブルシューティング

- LINEから表示名を取得できない場合は `LINEユーザー` として継続します。本人特定には表示名ではなくユーザーIDを使用します。
- **LINEグループ名が「LINEグループ」のまま表示される場合**: `line_groups.display_name` が未取得です。BOTがグループに参加した時・メンバーが参加/退出した時にLINEの「グループ概要取得」APIで自動取得・保存されますが、それより前から存在するグループは次のメンバー変動イベントまで反映されません。すぐに反映したい場合は `npm run cf:sync-group-names`（Cloudflare、内部的に `POST /internal/sync-group-names` を叩く）または `serverless invoke -f syncGroupNames`（AWS Lambda）を実行し、既存グループの名前をまとめて取得・保存してください。
- **新機能のリリース告知**: 新機能をリリースした際にグループへ一度だけお知らせを送りたい場合は `ReleaseAnnouncer`（`src/application/release-announcer.ts`）を使います。告知内容は `src/application/release-announcements.ts` の `RELEASE_ANNOUNCEMENTS` にキーごとに登録し、`group_announcements` テーブル（`group_id` + `announcement_key`）でグループ単位の送信済み記録を管理するため、キーが同じであれば何度呼び出しても再送信されません。
  - 発火タイミングはマージ後の実際のリリース（デプロイ）操作に紐付けています。コードがマージされただけでは何も送信されず、本番にデプロイした直後に明示的に呼び出したときだけ送信されます。
  - Cloudflare: デプロイ後に `npm run cf:announce -- <key>`（例: `npm run cf:announce -- total-amount`）を実行してください。内部的に `POST /internal/announce/:key` を叩きます。
  - AWS Lambda: デプロイ後に `serverless invoke -f announceRelease --data '{"key":"<key>"}'` を実行してください。
  - 新機能を追加するたびに、`release-announcements.ts` にキーと告知文を追加するだけで、このリリース告知フローに乗せられます。
- 既存実績の明示的な再計算、支払い者ごとの詳細な権限分離は将来拡張です。
- `Invalid signature` はチャネルシークレットとリクエスト本文の改変有無を確認してください。
- 通知されない場合は支払日、項目の有効期間、SchedulerのJST換算、DB接続、`notified_at` を確認してください。
- 本番ではSecrets Manager、RDS Proxy、構造化ログ、アラームを併用してください。

## セキュリティ

- LINE Webhookは生のリクエスト本文をHMAC-SHA256で検証します。
- ダッシュボードCookieはHttpOnly・Secure・SameSite=Laxで、HMAC署名と有効期限を検証します。
- ダッシュボードの認証はLINE Loginのみで、支払い項目の管理・支払い完了は対象グループの実メンバーであることをサーバー側で確認してから許可します。
- ダッシュボードにはCSP、クリックジャッキング防止、MIMEスニッフィング防止などのHTTPヘッダーを付与します。
- 脆弱性の報告方法は [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

[MIT License](LICENSE)
