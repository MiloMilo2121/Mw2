import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
      <div className="text-xs uppercase tracking-widest muted">404</div>
      <h1 className="mt-2 text-2xl font-bold">Dashboard not found</h1>
      <p className="mt-2 text-sm muted">
        This link is invalid or the client no longer exists. Double-check the URL
        you were given.
      </p>
      <Link href="/" className="mt-6 rounded-lg accent-bg px-4 py-2 text-sm font-medium text-white">
        Back home
      </Link>
    </main>
  );
}
