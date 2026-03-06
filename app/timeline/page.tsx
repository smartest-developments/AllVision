import React from "react";
import Link from "next/link";
import { getLegalCopy } from "@/legal/disclaimers";
import { resolvePageSessionUserId } from "@/server/page-auth";
import { listSourcingRequestStatusesForUser } from "@/server/sourcing-request-status";

type TimelinePageProps = {
  searchParams?: Promise<{
    requestId?: string | string[];
  }>;
};

function formatTimestamp(value: Date | null): string {
  if (!value) {
    return "N/A";
  }

  return value.toISOString();
}

export default async function TimelinePage({ searchParams }: TimelinePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const userId = await resolvePageSessionUserId();
  const rawRequestId = resolvedSearchParams?.requestId;
  const requestId = typeof rawRequestId === "string" ? rawRequestId.trim() : "";
  const legal = getLegalCopy("request");
  const requests = userId ? await listSourcingRequestStatusesForUser(userId) : [];
  const filteredRequests = requestId
    ? requests.filter((request) => request.requestId === requestId)
    : requests;
  const homeHref = "/";
  const timelineHref = "/timeline";
  const hasInvalidRequestFocus =
    userId !== "" && requestId !== "" && filteredRequests.length === 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <nav
        aria-label="Authenticated navigation"
        className="flex flex-wrap items-center gap-4 text-sm text-neutral-700"
      >
        <Link className="underline" href={homeHref}>
          Home
        </Link>
        <Link className="underline" href={timelineHref}>
          Timeline
        </Link>
      </nav>
      <h1 className="text-4xl font-semibold">Sourcing timeline</h1>
      <p className="text-sm text-neutral-700">
        Owner-scoped request timeline with optional request deep-linking.
      </p>
      <p className="text-sm text-neutral-700">
        <Link className="underline" href={homeHref}>
          Return to home
        </Link>
      </p>
      <ul className="list-disc pl-6 text-sm">
        {legal.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
        <li>{legal.surfaceNote}</li>
      </ul>

      <section className="rounded-md border border-neutral-300 p-4">
        <h2 className="text-2xl font-semibold">Requests</h2>
        <form className="mt-4 flex gap-2" method="get">
          <input
            type="text"
            name="requestId"
            defaultValue={requestId}
            placeholder="request-id (optional)"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            Load timeline
          </button>
        </form>

        {!userId ? (
          <p className="mt-4 text-sm text-neutral-700">
            Sign in to load your owner-only sourcing request statuses.
          </p>
        ) : null}

        {userId && requests.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-700">
            No sourcing requests found for this account.
          </p>
        ) : null}

        {hasInvalidRequestFocus ? (
          <p className="mt-4 text-sm text-neutral-700">
            No request matching this request ID was found for this account.{" "}
            <Link className="underline" href={timelineHref}>
              Clear request focus
            </Link>
            .
          </p>
        ) : null}

        {filteredRequests.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {filteredRequests.map((request) => {
              const isFocused = requestId !== "" && request.requestId === requestId;
              return (
                <li
                  key={request.requestId}
                  className={`rounded-md border p-3 ${
                    isFocused ? "border-neutral-900" : "border-neutral-200"
                  }`}
                >
                  {isFocused ? (
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-700">
                      Focused request
                    </p>
                  ) : null}
                  <p className="text-sm font-medium">Request {request.requestId}</p>
                  <p className="text-sm">Current status: {request.status}</p>
                  <p className="text-xs text-neutral-600">
                    Updated: {formatTimestamp(request.updatedAt)} | Latest event:{" "}
                    {formatTimestamp(request.latestEventAt)}
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
              );
            })}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
