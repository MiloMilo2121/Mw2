import { Shell } from "@/components/dashboard/Shell";

export const dynamic = "force-dynamic";

export default async function ClientDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <Shell slug={slug} />;
}
