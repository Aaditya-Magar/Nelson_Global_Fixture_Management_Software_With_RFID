// Shared helpers for fixture rows with full location path.
// Schema: fixtures.current_slot_id -> slots.id ; slots.row_id -> rows.id ; rows.rack_id -> racks.id ; racks.zone_id -> zones.id

import { supabase } from "./supabase";

// Embed string for joining the full location path through current_slot_id.
// Two FKs (home_slot_id, current_slot_id) both point to slots, so we disambiguate by constraint name.
export const FIXTURE_LOCATION_SELECT =
  "id,fixture_id,name,customer,customer_no,ngp_no,status,weight_kg,description,nfc_tag_id,current_slot_id,home_slot_id,created_at," +
  "current_slot:slots!fixtures_current_slot_id_fkey(id,name,is_occupied,row:rows(id,name,rack:racks(id,name,zone:zones(id,name))))," +
  "home_slot:slots!fixtures_home_slot_id_fkey(id,name,is_occupied,row:rows(id,name,rack:racks(id,name,zone:zones(id,name))))";

export type LocationJoin = {
  id: string;
  name: string;
  is_occupied: boolean;
  row: { id: string; name: string; rack: { id: string; name: string; zone: { id: string; name: string } } } | null;
} | null;

export type FixtureWithLocation = {
  id: string;
  fixture_id: string;
  name: string;
  customer: string | null;
  customer_no: string | null;
  ngp_no: string | null;
  status: "available" | "checked_out" | "maintenance";
  weight_kg: number | null;
  description: string | null;
  current_slot_id: string | null;
  home_slot_id: string | null;
  nfc_tag_id?: string | null;
  created_at: string;
  current_slot: LocationJoin;
  home_slot?: LocationJoin;
};

export type LocationParts = { zone: string; rack: string; row: string; slot: string } | null;

export function locationParts(fx: { current_slot?: LocationJoin } | null | undefined): LocationParts {
  const s = fx?.current_slot;
  if (!s || !s.row || !s.row.rack || !s.row.rack.zone) return null;
  return { zone: s.row.rack.zone.name, rack: s.row.rack.name, row: s.row.name, slot: s.name };
}

export function locationPathText(fx: { current_slot?: LocationJoin } | null | undefined): string | null {
  const p = locationParts(fx);
  return p ? `${p.zone} -> ${p.rack} -> ${p.row} -> ${p.slot}` : null;
}

export function homeLocationParts(fx: { home_slot?: LocationJoin } | null | undefined): LocationParts {
  const s = fx?.home_slot;
  if (!s || !s.row || !s.row.rack || !s.row.rack.zone) return null;
  return { zone: s.row.rack.zone.name, rack: s.row.rack.name, row: s.row.name, slot: s.name };
}

export function homeLocationPathText(fx: { home_slot?: LocationJoin } | null | undefined): string | null {
  const p = homeLocationParts(fx);
  return p ? `${p.zone} -> ${p.rack} -> ${p.row} -> ${p.slot}` : null;
}

export async function fetchFixturesWithLocation(): Promise<FixtureWithLocation[]> {
  const { data } = await supabase.from("fixtures").select(FIXTURE_LOCATION_SELECT).order("fixture_id");
  return (data as unknown as FixtureWithLocation[]) ?? [];
}
