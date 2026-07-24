export type PaymentType = "monthly" | "one_time";
export type PaymentStatus = "pending" | "paid" | "cancelled";
export type Action = "add" | "status" | "complete" | "edit" | "delete";

export interface PaymentItem {
  id: string;
  groupId: string;
  name: string;
  startMonth: string;
  endMonth: string | null;
  paymentType: PaymentType;
  paymentDay: number | null;
  specificPaymentDate: string | null;
  payerMemberId: string;
  amount: number;
  paymentMethod: string | null;
  note: string | null;
  isActive: boolean;
  createdByMemberId: string;
}

export interface PaymentRecord {
  id: string;
  paymentItemId: string;
  groupId: string;
  payerMemberId: string;
  targetMonth: string;
  itemNameSnapshot: string;
  amountSnapshot: number;
  paymentMethodSnapshot: string | null;
  dueDate: string;
  status: PaymentStatus;
  notifiedAt: Date | null;
  paidAt: Date | null;
  completedByMemberId: string | null;
}

export interface ParsedPaymentInput {
  name: string;
  startMonth: string;
  endMonth: string | null;
  paymentType: PaymentType;
  paymentDay: number | null;
  specificPaymentDate: string | null;
  payerLineUserId: string;
  payerDisplayName: string;
  amount: number;
  paymentMethod: string | null;
  note: string | null;
}

export interface ConversationState {
  groupId: string;
  memberId: string;
  currentAction: Action;
  currentStep: string;
  temporaryData: Record<string, unknown>;
  expiresAt: Date;
}

export interface Member {
  id: string;
  groupId: string;
  lineUserId: string;
  displayName: string;
  isActive: boolean;
}
