import type { ConversationState, Member, PaymentItem, PaymentRecord } from "../domain/types.js";

export interface NewPaymentItem extends Omit<PaymentItem, "id" | "isActive"> {}

export interface Store {
  claimEvent(eventId: string, now: Date): Promise<boolean>;
  ensureGroup(lineGroupId: string, displayName?: string): Promise<string>;
  findLineGroupId(groupId: string): Promise<string | null>;
  deactivateGroup(lineGroupId: string): Promise<void>;
  ensureMember(groupId: string, lineUserId: string, displayName: string): Promise<Member>;
  findMember(groupId: string, lineUserId: string): Promise<Member | null>;
  findMemberById(memberId: string): Promise<Member | null>;
  deactivateMember(groupId: string, lineUserId: string, now: Date): Promise<void>;
  listActiveItems(groupId: string): Promise<PaymentItem[]>;
  findItem(itemId: string): Promise<PaymentItem | null>;
  createItem(item: NewPaymentItem): Promise<PaymentItem>;
  updateItem(itemId: string, patch: Partial<NewPaymentItem>): Promise<void>;
  deactivateItem(itemId: string): Promise<void>;
  getConversation(groupId: string, memberId: string): Promise<ConversationState | null>;
  saveConversation(state: ConversationState): Promise<void>;
  clearConversation(groupId: string, memberId: string): Promise<void>;
  createDueRecords(date: string): Promise<PaymentRecord[]>;
  listRecords(groupId: string, targetMonth: string, payerMemberId?: string): Promise<PaymentRecord[]>;
  markPaid(recordIds: string[], completedByMemberId: string, now: Date): Promise<number>;
  markNotified(recordIds: string[], now: Date): Promise<number>;
}

export interface LineClient {
  reply(replyToken: string, messages: string[]): Promise<void>;
  push(groupLineId: string, messages: string[]): Promise<void>;
  getGroupMemberName(groupLineId: string, lineUserId: string): Promise<string | null>;
}

export interface Logger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export const consoleLogger: Logger = {
  info: (data, message) => console.info(message, data),
  error: (data, message) => console.error(message, data)
};
