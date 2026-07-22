import { notFound } from "next/navigation";

// Internal admin area (QA cestini, audit, upload). Gated by a shared secret in
// the URL, compared to ADMIN_SECRET. Fails CLOSED: if the env var is unset or
// the secret doesn't match, the whole subtree 404s. Never expose client data
// that shouldn't be internal here — this is separate from /c/[slug] (§3.6).

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ secret: string }>;
}) {
  const { secret } = await params;
  const expected = process.env.ADMIN_SECRET;
  if (!expected || secret !== expected) notFound();

  return <div className="min-h-screen bg-neutral-950 text-neutral-100">{children}</div>;
}
