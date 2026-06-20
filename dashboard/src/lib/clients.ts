// Client (tenant) resolution.
//
// Access model: a shared secret URL per client — the slug *is* the credential,
// so there is no login. We resolve a slug to its config + Instantly API key
// from, in priority order:
//   1. Supabase `clients` table (recommended for production)
//   2. DASHBOARD_CLIENTS env var ("slug|Name|apiKey, ...")
//   3. A built-in "demo" client that runs entirely on mock data.
//
// The API key is only ever read server-side.

import { getSupabase } from "./supabase";
import type { ClientConfig } from "./types";

const DEMO: ClientConfig = {
  slug: "demo",
  name: "Acme Outbound (Demo)",
  accentColor: "#6366f1",
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
        instantlyApiKey: apiKey || process.env.INSTANTLY_API_KEY || undefined,
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
        instantlyApiKey: data.instantly_api_key ?? process.env.INSTANTLY_API_KEY,
        accentColor: data.accent_color ?? undefined,
      };
    }
  }

  // 2. Env-configured clients
  const envClient = parseEnvClients().find((c) => c.slug === normalized);
  if (envClient) return envClient;

  // 3. Demo (mock data). Also lets a lone INSTANTLY_API_KEY power "demo".
  if (normalized === "demo") {
    return { ...DEMO, instantlyApiKey: process.env.INSTANTLY_API_KEY };
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
  return env.length ? env : [{ slug: DEMO.slug, name: DEMO.name, accentColor: DEMO.accentColor }];
}
