export type PaymentType = "monthly" | "one_time";
export type PaymentStatus = "pending" | "paid" | "cancelled";

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
  totalAmount: number | null;
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
  requestNotifiedAt: Date | null;
  notifiedAt: Date | null;
  overdueNotifiedAt: Date | null;
  paidAt: Date | null;
  completedByMemberId: string | null;
}

export interface Member {
  id: string;
  groupId: string;
  lineUserId: string;
  displayName: string;
  isActive: boolean;
}
