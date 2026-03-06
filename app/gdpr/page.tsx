import React from "react";
import Link from "next/link";
import { resolvePageSessionUserId } from "@/server/page-auth";
import { listGdprRequestHistoryForUser } from "@/server/gdpr-request-history";

export default async function GdprPage() {
  const userId = await resolvePageSessionUserId();
  const history = userId ? await listGdprRequestHistoryForUser(userId) : [];
  const nextPath = "/gdpr";
  const signInHref = "/auth/login?next=" + encodeURIComponent(nextPath);
  const registerHref = "/auth/register?next=" + encodeURIComponent(nextPath);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <nav
        aria-label="Authenticated navigation"
        className="flex flex-wrap items-center gap-4 text-sm text-neutral-700"
      >
        <Link className="underline" href="/">
          Home
        </Link>
        <Link className="underline" href="/timeline">
          Timeline
        </Link>
        <Link className="underline" href="/gdpr">
          GDPR
        </Link>
      </nav>

      <h1 className="text-4xl font-semibold">GDPR request history</h1>
      <p className="text-sm text-neutral-700">
        Review your export/deletion request history and legal-hold guidance.
      </p>

      {!userId ? (
        <section className="rounded-md border border-neutral-300 p-4 text-sm text-neutral-700">
          <p>
            Sign in to view GDPR request history. <Link className="underline" href={signInHref}>Sign in</Link> or{" "}
            <Link className="underline" href={registerHref}>create an account</Link>.
          </p>
        </section>
      ) : (
        <section className="rounded-md border border-neutral-300 p-4">
          <h2 className="text-2xl font-semibold">Recent requests</h2>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-700">No GDPR requests found for this account.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {history.map((entry) => (
                <li key={entry.requestId} className="rounded-md border border-neutral-200 p-3">
                  <p>
                    <strong>{entry.action}</strong> - {entry.status}
                  </p>
                  <p className="text-xs text-neutral-600">{new Date(entry.createdAt).toISOString()}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-md border border-neutral-300 p-4 text-sm text-neutral-700">
        <h2 className="text-lg font-semibold text-neutral-900">Legal-hold guidance</h2>
        <p className="mt-2">
          Deletion requests can return <code>409 GDPR_DELETE_LEGAL_HOLD</code> while sourcing requests remain active
          in <code>SUBMITTED</code> or <code>IN_REVIEW</code> states.
        </p>
        <p className="mt-2">
          You can still submit export requests while legal hold is active.
        </p>
      </section>
    </main>
  );
}
