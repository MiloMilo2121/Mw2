// Client (tenant) resolution.
//
// Access model: a shared secret URL per client — the slug *is* the credential,
// so there is no login. We resolve a slug to its config + Instantly API key
// from, in priority order:
//   1. Supabase `clients` table (recommended for production)
//   2. DASHBOARD_CLIENTS env var ("slug|Name|apiKey, ...")
//   3. Built-in clients ("geriko" = live, "demo" = mock).
//
// The API key is only ever read server-side.

import { getSupabase } from "./supabase";
import type { ClientConfig } from "./types";

// Accept the Instantly key under any of these env var names (case-insensitive),
// so it works whether it's set as INSTANTLY_API_KEY or Instantly_AXEND etc.
const KEY_NAMES = new Set([
  "instantly_api_key",
  "instantly_axend",
  "instantly_key",
  "instantly",
]);

function resolveApiKey(): string | undefined {
  for (const [k, v] of Object.entries(process.env)) {
    if (v && KEY_NAMES.has(k.toLowerCase())) return v;
  }
  return undefined;
}

// Built-in clients available without Supabase. `geriko` is the live client
// (uses the configured Instantly key); `demo` always runs on mock data.
type Builtin = {
  name: string;
  live: boolean;
  accentColor: string;
  campaignMatch?: string[];
  campaignAccountMatch?: string[];
  accountMatch?: string[];
};

const BUILTINS: Record<string, Builtin> = {
  geriko: {
    name: "Geriko",
    live: true,
    accentColor: "#aad8d8",
    // Geriko's campaigns are the ones that SEND from rosa/emanuele @metodogeriko.it
    // (robust regardless of campaign name), and its accounts are @metodogeriko.
    campaignAccountMatch: ["metodogeriko"],
    accountMatch: ["metodogeriko"],
  },
  demo: { name: "Acme Outbound (Demo)", live: false, accentColor: "#aad8d8" },
};

function parseEnvClients(): ClientConfig[] {
  const raw = process.env.DASHBOARD_CLIENTS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [slug, name, apiKey] = entry.split("|").map((s) => s?.trim());
      return {
        slug,
        name: name || slug,
        instantlyApiKey: apiKey || resolveApiKey() || undefined,
      } as ClientConfig;
    })
    .filter((c) => c.slug);
}

export async function getClient(slug: string): Promise<ClientConfig | null> {
  const normalized = slug.toLowerCase().trim();

  // 1. Supabase
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("clients")
      .select("slug,name,instantly_api_key,accent_color")
      .eq("slug", normalized)
      .maybeSingle();
    if (!error && data) {
      return {
        slug: data.slug,
        name: data.name,
        instantlyApiKey: data.instantly_api_key ?? resolveApiKey(),
        accentColor: data.accent_color ?? undefined,
      };
    }
  }

  // 2. Env-configured clients
  const envClient = parseEnvClients().find((c) => c.slug === normalized);
  if (envClient) return envClient;

  // 3. Built-in clients
  const builtin = BUILTINS[normalized];
  if (builtin) {
    return {
      slug: normalized,
      name: builtin.name,
      accentColor: builtin.accentColor,
      instantlyApiKey: builtin.live ? resolveApiKey() : undefined,
      campaignMatch: builtin.campaignMatch,
      campaignAccountMatch: builtin.campaignAccountMatch,
      accountMatch: builtin.accountMatch,
    };
  }

  return null;
}

export async function listClients(): Promise<ClientConfig[]> {
  const sb = getSupabase();
  if (sb) {
    const { data } = await sb.from("clients").select("slug,name,accent_color");
    if (data && data.length) {
      return data.map((d) => ({
        slug: d.slug,
        name: d.name,
        accentColor: d.accent_color ?? undefined,
      }));
    }
  }
  const env = parseEnvClients().map((c) => ({
    slug: c.slug,
    name: c.name,
    accentColor: c.accentColor,
  }));
  if (env.length) return env;
  return Object.entries(BUILTINS).map(([slug, b]) => ({
    slug,
    name: b.name,
    accentColor: b.accentColor,
  }));
}
