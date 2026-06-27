// Minimal hand-written types for the tables and columns used by the app.
export type UUID = string;

export interface Profile {
  id: UUID;
  full_name: string;
  employee_id: string;
  role: "admin" | "gatekeeper" | "worker";
  department: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Zone { id: UUID; name: string; description: string | null; created_at: string; }
export interface Rack { id: UUID; zone_id: UUID; name: string; nfc_tag_id: string | null; created_at: string; }
export interface Row  { id: UUID; rack_id: UUID; name: string; nfc_tag_id: string | null; created_at: string; }
export interface Slot { id: UUID; row_id: UUID; name: string; is_occupied: boolean; created_at: string; }

export interface Fixture {
  id: UUID;
  fixture_id: string;
  name: string;
  customer: string | null;
  customer_no: string | null;
  ngp_no: string | null;
  home_slot_id: UUID | null;
  current_slot_id: UUID | null;
  status: "available" | "checked_out" | "maintenance";
  weight_kg: number | null;
  description: string | null;
  nfc_tag_id: string | null;
  created_at: string;
}

export interface Request {
  id: UUID;
  worker_id: UUID;
  status: "pending" | "preparing" | "ready" | "collected" | "cancelled";
  notes: string | null;
  created_at: string;
  ready_at: string | null;
  collected_at: string | null;
  returned_at: string | null;
  return_status: "not_returned" | "returned" | null;
  gate_status: string | null;
  verified_fixture_id: UUID | null;
  scan1_rack_verified: boolean;
  scan1_rack_at: string | null;
  scan1_row_verified: boolean;
  scan1_row_at: string | null;
  scan1_fixture_verified: boolean;
  scan1_fixture_at: string | null;
}

export interface RequestItem { id: UUID; request_id: UUID; fixture_id: UUID; created_at: string; }

export interface Transaction {
  id: UUID;
  fixture_id: UUID | null;
  worker_id: UUID | null;
  gatekeeper_id: UUID | null;
  request_id: UUID | null;
  checked_out_at: string;
  returned_at: string | null;
  return_scanned_at: string | null;
  return_processed_by: UUID | null;
  status: "active" | "returned";
}

export interface ReturnLog {
  id: UUID;
  fixture_id: UUID | null;
  worker_id: UUID | null;
  gatekeeper_id: UUID | null;
  transaction_id: UUID | null;
  scanned_fixture_id: string;
  return_verified: boolean;
  failure_reason: string | null;
  returned_at: string;
}

export type Database = {
  public: {
    Tables: {
      profiles:           { Row: Profile;      Insert: Partial<Profile> & { id: UUID; full_name: string; employee_id: string; role: Profile["role"] }; Update: Partial<Profile> };
      zones:              { Row: Zone;         Insert: Partial<Zone> & { name: string };          Update: Partial<Zone> };
      racks:              { Row: Rack;         Insert: Partial<Rack> & { name: string; zone_id: UUID };          Update: Partial<Rack> };
      rows:               { Row: Row;          Insert: Partial<Row> & { name: string; rack_id: UUID };           Update: Partial<Row> };
      slots:              { Row: Slot;         Insert: Partial<Slot> & { name: string; row_id: UUID };           Update: Partial<Slot> };
      fixtures:           { Row: Fixture;      Insert: Partial<Fixture> & { fixture_id: string; name: string };  Update: Partial<Fixture> };
      requests:           { Row: Request;      Insert: Partial<Request> & { worker_id: UUID };                   Update: Partial<Request> };
      request_items:      { Row: RequestItem;  Insert: Partial<RequestItem> & { request_id: UUID; fixture_id: UUID }; Update: Partial<RequestItem> };
      transactions:       { Row: Transaction;  Insert: Partial<Transaction>;                                    Update: Partial<Transaction> };
      return_log:         { Row: ReturnLog;    Insert: Partial<ReturnLog> & { scanned_fixture_id: string };     Update: Partial<ReturnLog> };
      fixture_id_counters:{ Row: { fixture_type_code: string; last_number: number }; Insert: { fixture_type_code: string; last_number?: number }; Update: Partial<{ fixture_type_code: string; last_number: number }> };
    };
  };
};
