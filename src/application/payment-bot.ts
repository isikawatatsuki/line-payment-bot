import type { Action, ConversationState, ParsedPaymentInput, PaymentRecord } from "../domain/types.js";
import type { Logger, Store } from "./ports.js";
import { addForm, completionConfirmation, completionDone, itemConfirmation, itemList, menu, recordSummary } from "./messages.js";
import { normalizeAction, parsePaymentInput, type Mention } from "../domain/parser.js";
import { targetMonthOf } from "../domain/date.js";

export interface IncomingText {
  eventId: string;
  groupLineId: string;
  userLineId: string;
  userDisplayName: string;
  text: string;
  mentions: Mention[];
  botMentioned: boolean;
  now: Date;
}

const CANCEL = /^(?:キャンセル|中止|やめる)$/;

export class PaymentBot {
  constructor(
    private readonly store: Store,
    private readonly logger: Logger,
    private readonly ttlMinutes = 30
  ) {}

  async handleText(event: IncomingText): Promise<string[]> {
    if (!await this.store.claimEvent(event.eventId, event.now)) return [];
    const groupId = await this.store.ensureGroup(event.groupLineId);
    const member = await this.store.ensureMember(groupId, event.userLineId, event.userDisplayName);
    const log = { lineEventId: event.eventId, groupId: event.groupLineId, userId: event.userLineId };
    try {
      let state = await this.store.getConversation(groupId, member.id);
      if (state && state.expiresAt <= event.now) {
        await this.store.clearConversation(groupId, member.id);
        return ["操作の有効期限が切れました。\nもう一度 @支払いBOT をメンションして操作してください。"];
      }
      const input = event.text.trim();
      if (CANCEL.test(input)) {
        await this.store.clearConversation(groupId, member.id);
        return ["操作をキャンセルしました。"];
      }
      if (event.botMentioned) {
        const action = normalizeAction(input);
        if (!input || !action) return [menu(member.displayName)];
        state = null;
        return this.start(action, groupId, member.id, member.displayName, event.now);
      }
      if (!state) return [];
      return this.continue(state, input, event.mentions, member.displayName, event.now);
    } catch (error) {
      this.logger.error({ ...log, operation: "handleText", errorType: error instanceof Error ? error.name : "Unknown" }, "LINE event failed");
      return ["処理中にエラーが発生しました。\n時間を置いて、もう一度操作してください。"];
    }
  }

  private expiry(now: Date): Date {
    return new Date(now.getTime() + this.ttlMinutes * 60_000);
  }

  private async setState(groupId: string, memberId: string, action: Action, step: string, data: Record<string, unknown>, now: Date) {
    await this.store.saveConversation({ groupId, memberId, currentAction: action, currentStep: step, temporaryData: data, expiresAt: this.expiry(now) });
  }

  private async start(action: Action, groupId: string, memberId: string, name: string, now: Date): Promise<string[]> {
    if (action === "add") {
      await this.setState(groupId, memberId, action, "input", {}, now);
      return [addForm(name)];
    }
    if (action === "status") return this.showStatus(groupId);
    if (action === "complete") return this.startComplete(groupId, memberId, now);
    const items = await this.store.listActiveItems(groupId);
    if (!items.length) return ["有効な支払い項目はありません。"];
    await this.setState(groupId, memberId, action, "select", { itemIds: items.map((item) => item.id) }, now);
    return [itemList(items, action === "edit" ? "修正" : "削除")];
  }

  private async continue(state: ConversationState, input: string, mentions: Mention[], name: string, now: Date): Promise<string[]> {
    if (state.currentAction === "add") return this.continueAdd(state, input, mentions, now);
    if (state.currentAction === "complete") return this.continueComplete(state, input, now);
    if (state.currentAction === "edit") return this.continueEdit(state, input, mentions, now);
    if (state.currentAction === "delete") return this.continueDelete(state, input, now);
    return [menu(name)];
  }

  private async continueAdd(state: ConversationState, input: string, mentions: Mention[], now: Date): Promise<string[]> {
    if (state.currentStep === "confirm") {
      if (input === "修正") {
        await this.setState(state.groupId, state.memberId, "add", "input", {}, now);
        return [addForm("ユーザー")];
      }
      if (input !== "登録") return ["問題なければ「登録」、修正する場合は「修正」、中止する場合は「キャンセル」と送信してください。"];
      const data = state.temporaryData as unknown as ParsedPaymentInput;
      const payer = await this.store.findMember(state.groupId, data.payerLineUserId);
      if (!payer?.isActive) return ["支払い者をグループメンバーとして特定できませんでした。"];
      const duplicate = (await this.store.listActiveItems(state.groupId)).some((item) =>
        item.name === data.name && item.payerMemberId === payer.id && item.startMonth === data.startMonth && item.amount === data.amount);
      if (duplicate) return ["同じ内容の支払い項目がすでに登録されています。"];
      await this.store.createItem({
        groupId: state.groupId, name: data.name, startMonth: data.startMonth, endMonth: data.endMonth,
        paymentType: data.paymentType, paymentDay: data.paymentDay, specificPaymentDate: data.specificPaymentDate,
        payerMemberId: payer.id, amount: data.amount, note: data.note, createdByMemberId: state.memberId
      });
      await this.store.clearConversation(state.groupId, state.memberId);
      return [`支払い項目を登録しました。\n\n${data.name}\n${data.paymentType === "monthly" ? `毎月${data.paymentDay}日` : data.specificPaymentDate}\n${data.amount.toLocaleString("ja-JP")}円\n支払い者: @${data.payerDisplayName}`];
    }
    const actor = await this.store.findMemberById(state.memberId);
    const self = actor ? { lineUserId: actor.lineUserId, displayName: actor.displayName } : undefined;
    const parsed = parsePaymentInput(input, mentions, self);
    if (!parsed.value) return [`以下の項目を確認してください。\n\n${parsed.errors.map((error) => `・${error}`).join("\n")}\n\n入力例に沿って、もう一度送信してください。`];
    await this.setState(state.groupId, state.memberId, "add", "confirm", parsed.value as unknown as Record<string, unknown>, now);
    return [itemConfirmation(parsed.value as unknown as Record<string, unknown>)];
  }

  private async showStatus(groupId: string): Promise<string[]> {
    const month = targetMonthOf(new Date());
    const records = await this.store.listRecords(groupId, month);
    if (!records.length) return ["対象月の支払い実績はありません。"];
    const grouped = new Map<string, PaymentRecord[]>();
    for (const value of records) grouped.set(value.payerMemberId, [...(grouped.get(value.payerMemberId) ?? []), value]);
    const messages: string[] = [];
    for (const [memberId, values] of grouped) {
      const member = await this.store.findMemberById(memberId);
      messages.push(recordSummary(values, member?.displayName ?? "不明なユーザー", month));
    }
    return messages;
  }

  private async startComplete(groupId: string, memberId: string, now: Date): Promise<string[]> {
    const records = (await this.store.listRecords(groupId, targetMonthOf(now), memberId)).filter((record) => record.status === "pending");
    if (!records.length) return ["未完了の支払いはありません。"];
    await this.setState(groupId, memberId, "complete", "confirm", { recordIds: records.map((record) => record.id) }, now);
    return [completionConfirmation(records)];
  }

  private async continueComplete(state: ConversationState, input: string, now: Date): Promise<string[]> {
    if (input !== "完了") return ["問題なければ「完了」と送信してください。"];
    const ids = state.temporaryData.recordIds as string[];
    const records = (await this.store.listRecords(state.groupId, targetMonthOf(now), state.memberId)).filter((record) => ids.includes(record.id));
    const updated = await this.store.markPaid(ids, state.memberId, now);
    await this.store.clearConversation(state.groupId, state.memberId);
    if (!updated) return ["この支払いはすでに完了しています。"];
    return [completionDone(records, now)];
  }

  private async continueEdit(state: ConversationState, input: string, mentions: Mention[], now: Date): Promise<string[]> {
    if (state.currentStep === "select") {
      const index = Number(input) - 1;
      const id = (state.temporaryData.itemIds as string[])[index];
      if (!id) return ["一覧の番号を送信してください。"];
      const item = await this.store.findItem(id);
      if (!item) return ["対象の支払い項目が見つかりません。"];
      await this.setState(state.groupId, state.memberId, "edit", "input", { itemId: id }, now);
      return [`現在値: ${item.name} ${item.amount.toLocaleString("ja-JP")}円\n\n変更後の全項目を、追加時と同じフォーマットで送信してください。`];
    }
    const actor = await this.store.findMemberById(state.memberId);
    const self = actor ? { lineUserId: actor.lineUserId, displayName: actor.displayName } : undefined;
    const parsed = parsePaymentInput(input, mentions, self);
    if (!parsed.value) return [`以下の項目を確認してください。\n${parsed.errors.map((e) => `・${e}`).join("\n")}`];
    const payer = await this.store.findMember(state.groupId, parsed.value.payerLineUserId);
    if (!payer) return ["支払い者を特定できません。"];
    await this.store.updateItem(String(state.temporaryData.itemId), { ...parsed.value, payerMemberId: payer.id, groupId: state.groupId, createdByMemberId: state.memberId } as never);
    await this.store.clearConversation(state.groupId, state.memberId);
    return ["支払い項目を修正しました。作成済みの支払い実績は変更していません。"];
  }

  private async continueDelete(state: ConversationState, input: string, now: Date): Promise<string[]> {
    if (state.currentStep === "select") {
      const id = (state.temporaryData.itemIds as string[])[Number(input) - 1];
      if (!id) return ["一覧の番号を送信してください。"];
      const item = await this.store.findItem(id);
      if (!item) return ["対象の支払い項目が見つかりません。"];
      await this.setState(state.groupId, state.memberId, "delete", "confirm", { itemId: id }, now);
      return [`以下の支払い項目を無効化します。\n\n項目名：${item.name}\n金額：${item.amount.toLocaleString("ja-JP")}円\n\n問題なければ「削除」と送信してください。`];
    }
    if (input !== "削除") return ["問題なければ「削除」と送信してください。"];
    await this.store.deactivateItem(String(state.temporaryData.itemId));
    await this.store.clearConversation(state.groupId, state.memberId);
    return ["支払い項目を無効化しました。過去の支払い実績は保持されます。"];
  }
}
