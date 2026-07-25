// One entry per feature release that needs a one-time push to every existing group. Add a new
// key here when shipping a feature that warrants an announcement, then trigger it at release
// time with `npm run cf:announce -- <key>` (Cloudflare) or `serverless invoke -f announceRelease
// --data '{"key":"<key>"}'` (Lambda). Each key is sent to a given group at most once.
export const totalAmountFeatureAnnouncement = () =>
  `📢 新機能のお知らせ\n\n支払い項目に「総額」を設定できるようになりました。分割払いなどで支払いが完了するたびに、残金（総額 − 支払い済み累計）が自動計算されます。\n\n【表示場所】\n・支払い状況の確認結果\n・ダッシュボードの「総額・残金」欄`;

export const webDashboardAnnouncement = (dashboardUrl: string) =>
  `📢 お知らせ：支払い操作をWebに統合しました\n\nこれまでBOTを「@」でメンションして行っていた支払い項目の追加・修正・削除・支払い完了は、Webダッシュボードで行う形に変わりました。\n\n・グループ管理者: ダッシュボードから支払い項目の登録・編集・削除ができます\n・支払い者本人: LINEでログインすると、自分の支払い状況の確認と支払い完了ができます\n\nダッシュボードはこちら:\n${dashboardUrl}\n\n支払い依頼・期限のお知らせは、これまで通りLINEに届きます。`;

export const RELEASE_ANNOUNCEMENTS: Record<string, () => string> = {
  "total-amount": totalAmountFeatureAnnouncement,
  "web-dashboard": () => webDashboardAnnouncement("https://line-payment-bot.tatumagichannel.workers.dev/dashboard")
};
