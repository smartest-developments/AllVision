import React from "react";
import Link from "next/link";
import { getLegalCopy } from "@/legal/disclaimers";
import { resolvePageSessionUserId } from "@/server/page-auth";
import { listSourcingRequestStatusesForUser } from "@/server/sourcing-request-status";

function formatTimestamp(value: Date | null): string {
  if (!value) {
    return "N/A";
  }

  return value.toISOString();
}

export default async function HomePage() {
  const userId = await resolvePageSessionUserId();
  const legal = getLegalCopy("request");
  const requests = userId ? await listSourcingRequestStatusesForUser(userId) : [];
  const timelineHref = "/timeline";
  const signInHref = `/auth/login?next=${encodeURIComponent(timelineHref)}`;
  const registerHref = `/auth/register?next=${encodeURIComponent(timelineHref)}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <nav
        aria-label="Authenticated navigation"
        className="flex flex-wrap items-center gap-4 text-sm text-neutral-700"
      >
        <Link className="underline" href="/">
          Home
        </Link>
        <Link className="underline" href={timelineHref}>
          Timeline
        </Link>
      </nav>
      <h1 className="text-4xl font-semibold">AllVision</h1>
      <p className="text-lg">
        Documentation-first bootstrap. This service provides informational
        price-comparison and sourcing reports for eyeglass lenses in the EU and
        Switzerland.
      </p>
      <p className="text-sm text-neutral-700">
        View the dedicated timeline page at{" "}
        <Link className="underline" href={timelineHref}>
          /timeline
        </Link>{" "}
        for deep-link request focus.
      </p>
      <ul className="list-disc pl-6 text-sm">
        {legal.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
        <li>{legal.surfaceNote}</li>
      </ul>

      <section className="rounded-md border border-neutral-300 p-4">
        <h2 className="text-2xl font-semibold">Sourcing request timeline</h2>
        <p className="mt-2 text-sm text-neutral-700">
          Authenticated preview: timeline cards load from your current session.
        </p>

        {!userId ? (
          <p className="mt-4 text-sm text-neutral-700">
            Sign in to load your owner-only sourcing request statuses.{" "}
            <Link className="underline" href={signInHref}>
              Sign in
            </Link>{" "}
            or{" "}
            <Link className="underline" href={registerHref}>
              create an account
            </Link>
            .
          </p>
        ) : null}

        {userId && requests.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-700">
            No sourcing requests found for this account.
          </p>
        ) : null}

        {requests.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {requests.map((request) => (
              <li
                key={request.requestId}
                className="rounded-md border border-neutral-200 p-3"
              >
                <p className="text-sm font-medium">Request {request.requestId}</p>
                <p className="text-sm">Current status: {request.status}</p>
                <p className="text-xs text-neutral-600">
                  Updated: {formatTimestamp(request.updatedAt)} | Latest event:{" "}
                  {formatTimestamp(request.latestEventAt)}
                </p>
                <p className="mt-2 text-xs">
                  <Link
                    className="underline"
                    href={`/timeline?requestId=${encodeURIComponent(
                      request.requestId,
                    )}`}
                  >
                    Open focused timeline view
                  </Link>
                </p>
                {request.timeline.length > 0 ? (
                  <ul className="mt-2 list-disc pl-6 text-xs">
                    {request.timeline.map((event) => (
                      <li key={event.id}>
                        {event.fromStatus ?? "START"} -&gt; {event.toStatus} (
                        {formatTimestamp(event.createdAt)})
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-neutral-600">
                    No status events recorded yet.
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
