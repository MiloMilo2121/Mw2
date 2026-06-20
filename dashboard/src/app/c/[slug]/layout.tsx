import { notFound } from "next/navigation";
import { getClient } from "@/lib/clients";
import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) notFound();

  const style = { "--accent": client.accentColor ?? "#6366f1" } as CSSProperties;

  return (
    <div style={style} className="min-h-screen">
      {children}
    </div>
  );
}
