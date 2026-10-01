// Kiểu dữ liệu trả về từ các hàm api.* (xem supabase/migrations).

export type Role = "MEMBER" | "ADMIN";
export type UserStatus = "ACTIVE" | "DISABLED";
export type EventKind = "DEPOSIT" | "GIFT" | "PURCHASE_FUND" | "PURCHASE_MEMBER" | "REIMBURSEMENT" | "REVERSAL";
export type EntryType = "DEPOSIT_CREDIT" | "GIFT_SHARE" | "PURCHASE_SHARE" | "PURCHASE_CREDIT" | "REIMBURSEMENT_DEBIT";
export type LineType = "ITEM" | "FEE" | "DISCOUNT";
export type PaidBy = "FUND" | "MEMBER";
export type VoteState = "DRAFT" | "UPCOMING" | "OPEN" | "CLOSED" | "CANCELLED";
export type CoffeeType = "MACHINE" | "PHIN" | "UNDECIDED";
export type ImportKind = "MEMBERS" | "DEPOSITS" | "GIFTS" | "PURCHASES" | "REIMBURSEMENTS";
export type ImportStatus = "UPLOADED" | "HAS_ERRORS" | "READY" | "STALE" | "COMMITTED" | "DISCARDED";

export interface Me {
  id: string;
  employee_code: string;
  username: string;
  display_name: string;
  role: Role;
  status: UserStatus;
  must_change_password: boolean;
  is_member_today: boolean;
  /** data URL ảnh đại diện (null = chưa có, hiện chữ cái đầu) */
  avatar: string | null;
  /** quyền RBAC (mã trong src/lib/permissions.ts); rỗng = thành viên thường */
  permissions: string[];
}

export interface RbacRole {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: boolean;
  users: { id: string; display_name: string; username: string }[];
}

export interface AuditRow {
  id: number;
  occurred_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  actor: { id: string; display_name: string; username: string } | null;
  target: { display_name: string; username: string } | null;
  /** người liên quan trong giao dịch quỹ */
  subject: string | null;
}

export type Breakdown = Record<EntryType, number>;

export interface MyBalance {
  balance_vnd: number;
  breakdown: Breakdown;
  is_member_today: boolean;
  memberships: { start_date: string; end_date: string | null }[];
  as_of: string;
}

export interface LedgerRow {
  id: string;
  event_id: string;
  entry_type: EntryType;
  amount_vnd: number;
  occurred_on: string;
  event_kind: EventKind;
  event_status: "POSTED" | "REVERSED";
  is_reversal: boolean;
  reason: string | null;
  note: string | null;
  share_count: number | null;
  purchase_id: string | null;
  shop: string | null;
}

export interface Paged<T> {
  total: number;
  rows: T[];
  opening_balance_vnd?: number;
}

export interface PurchaseSummary {
  id: string;
  fund_event_id: string;
  external_ref: string | null;
  purchased_on: string;
  paid_by: PaidBy;
  payer_user_id: string | null;
  payer: string | null;
  shop: string | null;
  total_vnd: number;
  notes: string | null;
  share_count: number;
  status: "POSTED" | "REVERSED";
  item_summary: string | null;
  my_share_vnd: number;
  my_credit_vnd: number;
}

export interface PurchaseLine {
  line_no: number;
  line_type: LineType;
  item_name: string;
  quantity: number | null;
  unit: string | null;
  line_amount_vnd: number;
}

export interface SplitInfo {
  n: number;
  base_share_vnd: number;
  remainder: number;
}

export interface PurchaseDetail extends PurchaseSummary {
  lines: PurchaseLine[];
  split: SplitInfo;
  reversal: { event_id: string; occurred_on: string; reason: string } | null;
  allocations?: { user_id: string; employee_code: string; display_name: string; entry_type: EntryType; amount_vnd: number }[];
}

export interface AllocationMember {
  user_id: string;
  ord: number;
  employee_code: string;
  display_name: string;
  share_vnd: number;
  gets_extra_one: boolean;
  credit_vnd: number;
  balance_before_vnd: number;
  balance_after_vnd: number;
}

export interface PurchasePreview {
  occurred_on: string;
  paid_by: PaidBy;
  payer_user_id: string | null;
  lines: PurchaseLine[];
  total_vnd: number;
  split: SplitInfo;
  members: AllocationMember[];
  fund_cash_change_vnd: number;
  preview_hash: string;
}

export interface GiftPreview {
  total_vnd: number;
  occurred_on: string;
  split: SplitInfo;
  members: AllocationMember[];
  preview_hash: string;
}

export interface EventResult {
  event_id: string;
  kind: EventKind;
  amount_vnd: number;
  occurred_on: string;
  status: string;
  replayed: boolean;
  purchase_id: string | null;
}

export interface FundEvent {
  id: string;
  kind: EventKind;
  amount_vnd: number;
  occurred_on: string;
  status: "POSTED" | "REVERSED";
  external_ref: string | null;
  note: string | null;
  reason: string | null;
  share_count: number | null;
  created_at: string;
  actor: string | null;
  subject_user_id: string | null;
  subject: string | null;
  reverses_event_id: string | null;
  reverses_kind: EventKind | null;
  reversed_by_event_id: string | null;
  purchase_id: string | null;
  cash_delta_vnd: number;
  import_job_id: string | null;
}

export interface FundEventDetail extends FundEvent {
  cash_entries: { id: string; entry_type: string; amount_vnd: number; occurred_on: string; reverses_entry_id: string | null }[];
  member_entries: { id: string; user_id: string; employee_code: string; display_name: string; entry_type: EntryType; amount_vnd: number; reverses_entry_id: string | null }[];
}

export interface AdminUser {
  id: string;
  employee_code: string;
  username: string;
  display_name: string;
  role: Role;
  status: UserStatus;
  must_change_password: boolean;
  created_at: string;
  balance_vnd: number;
  avatar?: string | null;
  current_membership: { id: string; start_date: string; end_date: string | null } | null;
}

export interface Membership {
  id: string;
  user_id: string;
  employee_code: string;
  username: string;
  display_name: string;
  start_date: string;
  end_date: string | null;
  reason: string;
  updated_at: string;
  is_active_today: boolean;
}

export interface VoteOption {
  id: string;
  label: string;
  hidden: boolean;
}

export interface VoteOptions {
  styles: VoteOption[];
  addons: VoteOption[];
}

export interface MyVote {
  choice: "YES" | "NO";
  coffee_type: CoffeeType | null;
  cups: number | null;
  note: string | null;
  updated_at: string;
  style_option_id: string | null;
  style_label: string | null;
  addon_ids: string[];
  addon_labels: string[];
}

export interface VoteSession {
  id: string;
  name: string;
  service_date: string;
  opens_at: string;
  cutoff_at: string;
  planned_brew_at: string | null;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
  state: VoteState;
  closed_early_at: string | null;
  cancel_reason: string | null;
  closed_at: string;
  allow_cups: boolean;
  options: VoteOptions;
  yes_count: number;
  no_count: number;
  cups_total: number;
  my_vote: MyVote | null;
  /** người đã đặt hộ mình (nếu phiếu của mình do người khác đặt) */
  my_vote_by: string | null;
  /** các phiếu mình đặt hộ người khác */
  my_proxies: ProxyVote[];
}

export interface ProxyVote extends MyVote {
  user_id: string;
  display_name: string;
  employee_code: string;
}

/** Người có thể đặt hộ: SELF = đã tự vote, MINE = mình đã đặt hộ, OTHER = người khác đặt hộ */
export interface VotePerson {
  id: string;
  display_name: string;
  employee_code: string;
  status: "SELF" | "MINE" | "OTHER" | null;
}

export interface VotePrefill {
  choice: "YES" | "NO";
  cups: number;
  style_option_id: string | null;
  addon_ids: string[];
}

export interface HomeData {
  sessions: (VoteSession & { prefill: VotePrefill | null })[];
  next: { id: string; name: string; opens_at: string; cutoff_at: string } | null;
  last_closed: VoteSession | null;
}

export interface VoteSessionDetail extends VoteSession {
  options_all: VoteOptions | null;
  by_style: { label: string; people: number; cups: number }[];
  by_addon: { label: string; people: number }[];
  votes: { display_name: string; employee_code: string; choice: "YES" | "NO"; style_label: string | null; addon_labels: string[]; cups: number | null; note: string | null; updated_at: string; is_me: boolean; voted_by_name: string | null }[];
  not_voted: { display_name: string; employee_code: string }[] | null;
}

export interface VoteTemplate {
  id: string;
  name: string;
  service_date: string;
  opens_at: string;
  cutoff_at: string;
  planned_brew_at: string | null;
  allow_cups: boolean;
  options: VoteOptions;
}

export interface Overview {
  period: { from: string; to: string };
  cash_balance_vnd: number;
  cash_opening_vnd: number;
  cash_closing_vnd: number;
  costs_incurred_vnd: number;
  fund_spent_vnd: number;
  deposits_vnd: number;
  gifts_vnd: number;
  owing: { people: number; total_vnd: number };
  left_unsettled: { user_id: string; display_name: string; employee_code: string; balance_vnd: number }[];
  active_members: number;
  invariant: { cash_vnd: number; member_vnd: number; diff_vnd: number };
  last_reconciliation: ReconciliationRun | null;
}

export interface ReconciliationRun {
  id: number;
  ran_at: string;
  source: string;
  cash_total: number;
  member_total: number;
  diff: number;
  bad_events: { event_id: string; member_vnd: number; cash_vnd: number }[];
}

export interface MemberBalanceRow {
  user_id: string;
  employee_code: string;
  display_name: string;
  status: UserStatus;
  opening_vnd: number;
  movement: Breakdown;
  closing_vnd: number;
  balance_now_vnd: number;
  is_member_today: boolean;
  left_unsettled: boolean;
}

export interface Health {
  cash_vnd: number;
  member_vnd: number;
  diff_vnd: number;
  cash_negative: boolean;
  bad_events: { event_id: string; member_vnd: number; cash_vnd: number }[];
  event_count: number;
  last_runs: ReconciliationRun[];
  recent_audit: { occurred_at: string; action: string; entity_type: string; entity_id: string | null; reason: string | null; actor: string | null }[];
}

export interface ImportRow {
  row_no: number;
  data: Record<string, unknown>;
  normalized: Record<string, any> | null;
  errors: string[];
}

export interface ImportJob {
  id: string;
  kind: ImportKind;
  file_name: string;
  file_checksum: string;
  status: ImportStatus;
  row_count: number;
  error_count: number;
  preview_hash: string | null;
  summary: { rows?: number; error_rows?: number; total_vnd?: number; documents?: number; new_accounts?: number };
  created_at: string;
  committed_at: string | null;
  created_by_name?: string;
  rows?: ImportRow[];
}

/** Tổng quan quỹ (mọi người xem): đã đóng, đã chi, còn lại, tiền đóng từng người */
export interface FundSummary {
  cash_balance_vnd: number;
  as_of: string;
  deposits_vnd: number;
  gifts_vnd: number;
  spent_vnd: number;
  people: { user_id: string; display_name: string; employee_code: string; deposited_vnd: number; is_me: boolean }[];
}
