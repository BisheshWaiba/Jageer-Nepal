// types/database.types.ts
// Hand-written types matching the Supabase schema. Once your project is
// running, regenerate these with:
//   npx supabase gen types typescript --project-id <your-project-id> > types/database.types.ts

export type UserRole = 'client' | 'technician' | 'reseller' | 'wholesaler' | 'admin';
export type RequestStatus = 'pending' | 'quoted' | 'approved' | 'assigned' | 'in_progress' | 'resolved' | 'cancelled';
export type RequestOrigin = 'app' | 'reseller';
export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  city: string | null;
  is_active: boolean;
  is_available: boolean;
  skill_ids: string[];
  latitude: number | null;
  longitude: number | null;
  verification_status: VerificationStatus;
  verification_notes: string | null;
  reward_points: number;
  // A reseller's own business letterhead, used on generated quotations
  // (see QuotationScreen) - all null until they fill in "Business details"
  // once. business_logo_path is a public storage path in the
  // business-assets bucket, not a full URL.
  business_name: string | null;
  business_reg_no: string | null;
  business_vat_no: string | null;
  business_address: string | null;
  business_phone: string | null;
  business_logo_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotationItem {
  photo_url: string | null;
  subject: string;
  description: string;
  mrp: number | null;
  discount: number | null;
  rate: number | null;
  qty: number;
  amount: number;
}

export interface Quotation {
  id: string;
  owner_id: string;
  quote_seq: number;
  quote_no: string;
  quote_date: string;
  subject: string | null;
  client_name: string;
  client_address: string | null;
  salesperson_name: string | null;
  salesperson_phone: string | null;
  items: QuotationItem[];
  terms: string | null;
  total: number;
  pdf_path: string | null;
  created_at: string;
  updated_at: string;
}

// A client's bookmarked reseller/technician contact ("Saved Contacts"), so
// they can find and call/message them again later without hunting through
// old requests. contact_id points at a profiles row (role 'reseller' or
// 'technician') - the actual name/phone/role is read from that profile.
export interface SavedContact {
  id: string;
  client_id: string;
  contact_id: string;
  note: string | null;
  created_at: string;
}

export interface RewardPointEvent {
  id: string;
  user_id: string;
  points: number;
  reason: string;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
}

export type TechnicianEmploymentStatus = 'pending' | 'accepted' | 'rejected' | 'ended';

export interface TechnicianEmployment {
  id: string;
  technician_id: string;
  reseller_id: string;
  status: TechnicianEmploymentStatus;
  /** Who started it - decides who may accept (see migration 0070). */
  initiated_by: 'technician' | 'reseller';
  work_start_time: string | null;
  work_end_time: string | null;
  requested_at: string;
  responded_at: string | null;
  ended_at: string | null;
  /** The employer's own label and private note for this employee. */
  job_title: string | null;
  employer_note: string | null;
  /** 'supervisor' can hand this reseller's work to the rest of the team;
   * 'technician' just carries their own jobs (migration 0077). */
  staff_role: 'technician' | 'supervisor';
  /** Set when the technician has asked to leave - the employment only ends
   * once the employer approves (migration 0081). */
  leave_requested_at: string | null;
  leave_reason: string | null;
  /** Stamped when the employer turned the last request down; cleared by the
   * next one. */
  leave_rejected_at: string | null;
}

/** A technician's live position - readable only by them, their employer and admins (migration 0080). */
export interface TechnicianLocation {
  technician_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  updated_at: string;
}

export interface RequestLocation {
  latitude?: number;
  longitude?: number;
  address: string;
}

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type PaymentMethod = 'cash' | 'online';
export type HoldStatus = 'none' | 'requested' | 'on_hold';

export interface ServiceRequest {
  id: string;
  client_id: string;
  technician_id: string | null;
  reseller_id: string | null;
  customer_id: string | null;
  issue_type: string;
  description: string | null;
  status: RequestStatus;
  location_data: RequestLocation | null;
  quoted_price: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  photo_urls: string[];
  // A photographed paper chalan (delivery/completion slip) the assigned
  // technician attaches once work is done - never the reseller or client,
  // see ChalanPhotos. Stored the same way as photo_urls (private paths in
  // the request-photos bucket).
  chalan_urls: string[];
  payment_status: PaymentStatus;
  payment_method: PaymentMethod | null;
  fonepay_prn: string | null;
  /** Every Fonepay PRN ever issued for this job (migration 0079). */
  fonepay_prns: string[];
  paid_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  contact_person_name: string | null;
  contact_person_phone: string | null;
  company_name: string | null;
  origin: RequestOrigin;
  remark: string | null;
  hold_status: HoldStatus;
  hold_note: string | null;
  hold_requested_at: string | null;
  hold_resolved_at: string | null;
  /** When the job was last offered to its technician (migration 0080). */
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
  /** Offered to the whole team: any of this reseller's employees can take
   * it, first come (see migration 0076). */
  open_to_team: boolean;
  /** How much of the job has actually been received (migration 0078).
   * Only meaningful while payment_status is 'partial'. */
  amount_paid: number;
}

export interface Product {
  id: string;
  seller_id: string;
  name: string;
  description: string | null;
  price: number;
  wholesale_price: number | null;
  stock_level: number;
  min_order_qty: number;
  category: string | null;
  image_url: string | null;
  last_sold_at: string | null;
  is_dead_stock: boolean;
  catalog_id: string | null;
  seller_role: UserRole;
  purchased_stock: number;
  purchase_price: number | null;
  is_listed: boolean;
  created_at: string;
  updated_at: string;
}

// A name (and its last-used rate) typed into Sale/Purchase's item picker
// that isn't a real product in the reseller's marketplace catalog - kept so
// the picker can offer it again next time, without needing (or being
// allowed - see 0063_finance_items.sql) to create a real `products` row.
export interface FinanceItem {
  id: string;
  owner_id: string;
  name: string;
  rate: number | null;
  created_at: string;
  updated_at: string;
}

// Moving money between the business's own accounts (Cash and/or a
// bank_accounts row) - null on either side means Cash, same convention as
// bank_account_id everywhere else. Doesn't represent income or expense, so
// it's kept out of Sales/Purchase/Expense/Total Received/Total Paid.
export interface AccountTransfer {
  id: string;
  owner_id: string;
  from_account_id: string | null;
  to_account_id: string | null;
  amount: number;
  note: string | null;
  transfer_date: string;
  created_at: string;
}

export interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  submitted_by: string | null;
  pending_price: number | null;
  pending_stock: number | null;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  owner_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  contact_person_name: string | null;
  contact_person_phone: string | null;
  latitude: number | null;
  longitude: number | null;
  phone_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Someone on a reseller's team who has no Jageer account - a record they
 * keep by hand (see manual_employees). Jobs are still only sent in-app to
 * technicians with an account. */
export interface ManualEmployee {
  id: string;
  owner_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  job_title: string | null;
  work_start_time: string | null;
  work_end_time: string | null;
  note: string | null;
  is_active: boolean;
  /** Set once this person signs up as a technician with a matching phone,
   * email or (when neither was stored) name - see migration 0074. */
  linked_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export type LedgerEntryType = 'debit' | 'credit';

export interface CustomerLedgerEntry {
  id: string;
  customer_id: string;
  owner_id: string;
  entry_type: LedgerEntryType;
  amount: number;
  note: string | null;
  source: 'manual' | 'booking';
  source_type: string | null;
  source_id: string | null;
  bank_account_id: string | null;
  entry_date: string | null;
  receipt_no: string | null;
  created_at: string;
}

export type BusinessTransactionType = 'sale' | 'purchase' | 'expense';
export type PaymentMode = 'cash' | 'bank' | 'credit';

// Same shape as CustomerLedgerEntry, but opposite polarity: 'debit' = the
// business owes this vendor more (bought on credit), 'credit' = a payment
// the business made to the vendor. vendor_id points at the same `customers`
// directory Purchase's "Vendor" field picks from - vendors and customers
// share one contacts list.
export interface VendorLedgerEntry {
  id: string;
  vendor_id: string;
  owner_id: string;
  entry_type: LedgerEntryType;
  amount: number;
  note: string | null;
  source: 'manual' | 'booking';
  source_type: string | null;
  source_id: string | null;
  entry_date: string | null;
  receipt_no: string | null;
  bank_account_id: string | null;
  created_at: string;
}

export interface BillItem {
  description: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface ExpenseCategory {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface BankAccount {
  id: string;
  owner_id: string;
  name: string;
  bank_name: string | null;
  account_number: string | null;
  account_holder_name: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessTransaction {
  id: string;
  owner_id: string;
  type: BusinessTransactionType;
  amount: number;
  note: string | null;
  party_name: string | null;
  customer_id: string | null;
  source_type: string | null;
  source_id: string | null;
  bill_no: string | null;
  bill_date: string | null;
  party_address: string | null;
  vat_pan_no: string | null;
  items: BillItem[];
  discount_amount: number;
  vat_amount: number;
  expense_category_id: string | null;
  payment_mode: PaymentMode;
  bank_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  buyer_id: string;
  seller_id: string;
  total_amount: number;
  platform_fee: number;
  seller_payout: number | null;
  status: OrderStatus;
  payment_method: string | null;
  payment_reference: string | null;
  shipping_address: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
}

export interface JobCard {
  id: string;
  service_request_id: string;
  technician_id: string;
  notes: string | null;
  parts_used: Array<{ name: string; quantity: number; cost: number }> | null;
  labor_cost: number;
  parts_cost: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: string;
  service_request_id: string;
  client_id: string;
  technician_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export type MessageSubjectType = 'service_request' | 'order';

export interface Message {
  id: string;
  subject_type: MessageSubjectType;
  subject_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export type TicketStatus = 'open' | 'resolved';

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  status: TicketStatus;
  created_at: string;
}

// One row per statement line (by its Reference Code) that's already been
// turned into a real Finance entry - lets re-importing the same statement,
// or one with an overlapping date range, skip rows already recorded here.
export interface StatementImport {
  id: string;
  owner_id: string;
  reference_code: string;
  created_at: string;
}

export interface ServiceCategory {
  id: string;
  label: string;
  description: string | null;
  icon: string | null;
  visual_key: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

// Minimal shape expected by Supabase's generated Database type.
// Expand this if/when you swap in the CLI-generated version.
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile>; Relationships: [] };
      service_requests: {
        Row: ServiceRequest;
        Insert: Partial<ServiceRequest>;
        Update: Partial<ServiceRequest>;
        Relationships: [];
      };
      products: { Row: Product; Insert: Partial<Product>; Update: Partial<Product>; Relationships: [] };
      quotations: { Row: Quotation; Insert: Partial<Quotation>; Update: Partial<Quotation>; Relationships: [] };
      orders: { Row: Order; Insert: Partial<Order>; Update: Partial<Order>; Relationships: [] };
      order_items: { Row: OrderItem; Insert: Partial<OrderItem>; Update: Partial<OrderItem>; Relationships: [] };
      job_cards: { Row: JobCard; Insert: Partial<JobCard>; Update: Partial<JobCard>; Relationships: [] };
      reviews: { Row: Review; Insert: Partial<Review>; Update: Partial<Review>; Relationships: [] };
      messages: { Row: Message; Insert: Partial<Message>; Update: Partial<Message>; Relationships: [] };
      support_tickets: {
        Row: SupportTicket;
        Insert: Partial<SupportTicket>;
        Update: Partial<SupportTicket>;
        Relationships: [];
      };
      service_categories: {
        Row: ServiceCategory;
        Insert: Partial<ServiceCategory>;
        Update: Partial<ServiceCategory>;
        Relationships: [];
      };
      catalog_products: {
        Row: CatalogProduct;
        Insert: Partial<CatalogProduct>;
        Update: Partial<CatalogProduct>;
        Relationships: [];
      };
      customers: { Row: Customer; Insert: Partial<Customer>; Update: Partial<Customer>; Relationships: [] };
      manual_employees: {
        Row: ManualEmployee;
        Insert: Partial<ManualEmployee>;
        Update: Partial<ManualEmployee>;
        Relationships: [];
      };
      saved_contacts: {
        Row: SavedContact;
        Insert: Partial<SavedContact>;
        Update: Partial<SavedContact>;
        Relationships: [];
      };
      finance_items: { Row: FinanceItem; Insert: Partial<FinanceItem>; Update: Partial<FinanceItem>; Relationships: [] };
      account_transfers: {
        Row: AccountTransfer;
        Insert: Partial<AccountTransfer>;
        Update: Partial<AccountTransfer>;
        Relationships: [];
      };
      customer_ledger_entries: {
        Row: CustomerLedgerEntry;
        Insert: Partial<CustomerLedgerEntry>;
        Update: Partial<CustomerLedgerEntry>;
        Relationships: [];
      };
      vendor_ledger_entries: {
        Row: VendorLedgerEntry;
        Insert: Partial<VendorLedgerEntry>;
        Update: Partial<VendorLedgerEntry>;
        Relationships: [];
      };
      business_transactions: {
        Row: BusinessTransaction;
        Insert: Partial<BusinessTransaction>;
        Update: Partial<BusinessTransaction>;
        Relationships: [];
      };
      expense_categories: {
        Row: ExpenseCategory;
        Insert: Partial<ExpenseCategory>;
        Update: Partial<ExpenseCategory>;
        Relationships: [];
      };
      bank_accounts: {
        Row: BankAccount;
        Insert: Partial<BankAccount>;
        Update: Partial<BankAccount>;
        Relationships: [];
      };
      reward_point_events: {
        Row: RewardPointEvent;
        Insert: Partial<RewardPointEvent>;
        Update: Partial<RewardPointEvent>;
        Relationships: [];
      };
      technician_employment: {
        Row: TechnicianEmployment;
        Insert: Partial<TechnicianEmployment>;
        Update: Partial<TechnicianEmployment>;
        Relationships: [];
      };
      technician_locations: {
        Row: TechnicianLocation;
        Insert: Partial<TechnicianLocation>;
        Update: Partial<TechnicianLocation>;
        Relationships: [];
      };
      statement_imports: {
        Row: StatementImport;
        Insert: Partial<StatementImport>;
        Update: Partial<StatementImport>;
        Relationships: [];
      };
    };
  };
}
