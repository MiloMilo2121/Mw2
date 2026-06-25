// Verified lead master data imported from the MillionVerifier Drive reports
// (GERIKO_CON_NOME / GERIKO_SENZA_NOME). Indexed by lowercased email so we can
// enrich Instantly engagement (who opened/clicked) with clean contact details
// — most importantly the phone number to follow up by call.

import data from "@/data/geriko_verified.json";

export type VerifiedLead = {
  email: string;
  quality: string;
  result: string;
  free: string;
  role: string;
  firstName: string;
  companyName: string;
  city: string;
  jobTitle: string;
  phone: string;
  website: string;
  list: string;
};

const MAP = data as Record<string, VerifiedLead>;

export function getVerified(email: string): VerifiedLead | undefined {
  if (!email) return undefined;
  return MAP[email.trim().toLowerCase()];
}

export function verifiedCount(): number {
  return Object.keys(MAP).length;
}
