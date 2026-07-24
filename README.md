# LINE 支払いBOT

LINEグループ内の月次・単発支払いを登録し、支払日に支払い者別の合計と内訳を通知するBOTです。支払い実績は項目マスタから分離し、作成時点の名称・金額をスナップショットとして保存します。

## 技術構成

- TypeScript / Hono
- Cloudflare Workers / D1（本番・無料枠）
- Cloudflare Cron Triggers
- Kysely / MariaDB（ローカル・AWS向け互換実装）
- LINE Messaging API
- Vitest

HTTP/Lambda層、アプリケーションサービス、外部I/Oポート、Kysely実装を分離しています。LINE APIは `LineClient`、永続化は `Store` インターフェース越しに利用するためテストでは実通信しません。

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
| `LINE_BOT_USER_ID` | Yes | BOT自身のLINEユーザーID |
| `DATABASE_URL` | Yes | `mysql://user:pass@host:3306/db` |
| `APP_TIMEZONE` | No | 既定値 `Asia/Tokyo` |
| `CONVERSATION_TTL_MINUTES` | No | 会話状態の有効時間。既定値30分 |
| `PORT` | No | ローカルHTTPポート。既定値3000 |

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

Webhookは `x-line-signature` をHMAC-SHA256で検証します。テキスト、参加、メンバー参加・退出、BOT退出を処理し、メッセージイベントIDの一意制約で再送を無視します。BOT自身のイベントは処理しません。

## 操作方法

BOTをメンションするとメニューが表示されます。メンションと同時に操作名を指定することもできます。

```text
@支払いBOT
@支払いBOT 支払い状況
@支払いBOT 支払い完了
```

番号、正式名、短縮表現（`追加`、`状況確認`、`修正`、`削除`）を受け付けます。操作中は `キャンセル`、`中止`、`やめる` のいずれかで中断できます。会話状態はLINEグループIDとユーザーIDの組み合わせで分離されます。

### 支払い項目追加

```text
項目名: 家賃
開始月: 2026年7月
終了月: 未定
支払日: 毎月27日
支払い者: @石川
金額: 120000円
希望支払い方法: 銀行振込
備考: 共有家賃
```

`希望支払い方法`（または `支払い方法`）は任意です。指定がない場合は行ごと省略できます。

確認内容に `登録` と返信した時点で保存します。`支払日: 2026年8月20日` という単発形式にも対応します。毎月31日指定で31日がない月は月末日が期限です。金額は1円以上の安全な整数に限定します。

操作している本人を支払い者にする場合は、LINEで自分自身をメンションできないため、支払い者欄に `自分`、`本人`、`投稿者`、`私` のいずれかを入力してください。

### 支払い状況・完了

`支払い状況` は当月の実績を支払い者ごとに表示します。`支払い完了` は操作ユーザー自身が支払い者になっている未完了実績のみを対象とし、確認後に `完了` で更新します。条件付き更新により二重完了を防ぎます。

### 修正・削除

有効な項目を番号で選択します。修正は将来作成される実績へ反映され、すでに作成したスナップショットは変更しません。削除は論理削除で、過去実績を保持します。

## 定期通知

`scheduled` Lambdaを毎日JST 06:00（UTC 21:00）に起動します。

1. 期限3日前に支払い依頼を通知
2. 支払当日の朝に期限当日通知
3. 未払いの場合、期限翌日から3日おきに期限超過通知
4. 支払い完了操作時に完了通知
5. グループ・支払い者・期限単位でまとめてLINE Push Messageを送信

支払い依頼・当日・期限超過の送信日時を実績ごとに保存し、同日の再実行による重複通知を防ぎます。送信失敗時は未通知のまま残り、次回の対象日に再試行されます。

## テストとビルド

```bash
npm run build
npm test
npm run check
```

テストは金額・年月・月末補正、入力フォーマット、メニュー表記揺れ、メンション、署名、会話分離・期限切れ、登録確認、Webhook相当の冪等処理、実績スナップショット、通知の二重送信防止を含みます。LINE APIはモックです。

## Cloudflareへデプロイ（推奨）

Cloudflare Workers FreeとD1 Freeを利用します。Wranglerへログインし、D1を作成した後、`wrangler.jsonc`の`database_id`を作成結果に置き換えます。

```bash
npx wrangler login
npx wrangler d1 create line-payment-bot
npm run cf:migrate:remote
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_BOT_USER_ID
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

`.dev.vars`にLINEの3つの秘密情報を設定すると、ローカルWorkerでも確認できます。`.dev.vars`と`.wrangler/`はGit管理外です。

## Webダッシュボード

同じCloudflare Workerの `/dashboard` で、BOTがD1へ保存した支払いデータを可視化します。

- 月別の対象金額・支払い済み金額・完了率
- 月別推移グラフ
- 支払い状況のドーナツグラフ
- 項目別・支払い者別の内訳
- LINEグループと対象月の切り替え

LINEグループでBOTをメンションして `ダッシュボード`（または `グラフ`、`6`）と送ると、BOTが本人用URLを返信します。LINE Loginで本人確認し、通常ユーザーには自分が支払い者になっている項目だけを表示します。管理者パスワードではグループ全体を確認できます。ログインセッションは7日間有効です。

LINE Developersで、Messaging APIチャネルと同じプロバイダーに「LINEログイン」チャネル（ウェブアプリ）を作成し、コールバックURLへ次を登録します。

```text
https://line-payment-bot.tatumagichannel.workers.dev/dashboard/line/callback
```

LINEログインチャネルの認証情報はCloudflare Secretへ登録します。

```bash
npx wrangler secret put LINE_LOGIN_CHANNEL_ID
npx wrangler secret put LINE_LOGIN_CHANNEL_SECRET
```

閲覧にはパスワードが必要です。Cloudflareへ次の2つをSecretとして登録してください。

```bash
npx wrangler secret put DASHBOARD_PASSWORD
npx wrangler secret put DASHBOARD_SESSION_SECRET
```

`DASHBOARD_PASSWORD` は16文字以上、`DASHBOARD_SESSION_SECRET` は32文字以上のランダム文字列を設定します。未設定または短すぎる場合、ダッシュボードはFail Closedで起動を拒否します。認証CookieはHttpOnly・Secure・SameSite=Laxで、7日後に失効します。

## AWSへデプロイ（代替構成）

`serverless.yml` はServerless Framework向けの設定例です。

```bash
npm run build
npx serverless deploy
```

LambdaからMariaDBへ到達できるVPC・Security Group・接続情報を設定してください。RDS Proxy等による接続数制御を推奨します。デプロイ後のAPI Gateway URLをLINE DevelopersのWebhook URLへ設定します。

## DB設計

- `line_groups`: LINEグループ
- `line_members`: グループ単位のLINEメンバー
- `payment_items`: 支払い項目マスタ
- `payment_records`: 月次実績と名称・金額スナップショット
- `conversation_states`: グループ・ユーザー単位の会話状態
- `processed_line_events`: Webhookイベントの処理済み記録
- `dashboard_login_attempts`: 管理者ログイン失敗回数と一時ブロック（IPアドレスはHMACで匿名化）

DB日時はUTC、ユーザー表示はAsia/Tokyoです。金額は `BIGINT UNSIGNED`、アプリ内では安全な整数として扱います。

## 手動確認

1. BOTをテストグループへ追加し、メンションでメニューが返ることを確認
2. 2ユーザーで同時に追加操作を始め、入力が混ざらないことを確認
3. 支払い項目を追加し、確認前にはDBへ保存されず `登録` 後に保存されることを確認
4. Scheduler Lambdaをテスト日付で起動し、集計通知と `payment_records.notified_at` を確認
5. Schedulerを再実行し、再通知されないことを確認
6. 支払い者本人で完了し、再度完了して二重更新されないことを確認
7. 項目を修正・無効化し、過去実績のスナップショットが保持されることを確認

## 制約・トラブルシューティング

- LINEから表示名を取得できない場合は `LINEユーザー` として継続します。本人特定には表示名ではなくユーザーIDを使用します。
- 既存実績の明示的な再計算、管理者権限、手動再通知は将来拡張です。
- `Invalid signature` はチャネルシークレットとリクエスト本文の改変有無を確認してください。
- 通知されない場合は支払日、項目の有効期間、LambdaのJST換算、DB接続、`notified_at` を確認してください。
- 本番ではSecrets Manager、RDS Proxy、構造化ログ、アラームを併用してください。

## セキュリティ

- LINE Webhookは生のリクエスト本文をHMAC-SHA256で検証します。
- ダッシュボードCookieはHttpOnly・Secure・SameSite=Laxで、HMAC署名と有効期限を検証します。
- 管理者ログインはIPアドレスのHMAC値単位で15分間に5回までとし、上限到達後は30分間ブロックします。
- ダッシュボードにはCSP、クリックジャッキング防止、MIMEスニッフィング防止などのHTTPヘッダーを付与します。
- 脆弱性の報告方法は [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

[MIT License](LICENSE)
