import React from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { GET as getAdminQueue } from "../../api/v1/admin/sourcing-requests/route";
import { GET as getAdminQueueDetail } from "../../api/v1/admin/sourcing-requests/[requestId]/route";

type QueueStatus = "SUBMITTED" | "IN_REVIEW";

type AdminQueueListItem = {
  requestId: string;
  status: QueueStatus;
  createdAt: string;
  updatedAt: string;
  userEmail: string;
  countryCode: string;
  latestEventAt: string | null;
};

type AdminQueueDetail = {
  requestId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  userEmail: string;
  countryCode: string;
  prescriptionCreatedAt: string;
};

type AdminQueueTimelineItem = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
};

type AdminQueueArtifactItem = {
  id: string;
  storageKey: string;
  checksumSha256: string;
  deliveryChannel: string;
  deliveredAt: string | null;
  createdAt: string;
};

type AdminQueueListResponse = {
  requests: AdminQueueListItem[];
};

type AdminQueueDetailResponse = {
  request: AdminQueueDetail;
  timeline: AdminQueueTimelineItem[];
  reportArtifacts: AdminQueueArtifactItem[];
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type AdminQueuePageProps = {
  searchParams?: Promise<{
    status?: string | string[];
    countryCode?: string | string[];
    userEmail?: string | string[];
    requestId?: string | string[];
  }>;
};

type QueueFilters = {
  status: "" | QueueStatus;
  countryCode: string;
  userEmail: string;
  requestId: string;
};

function firstParam(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0].trim() : "";
  }

  return "";
}

function normalizeStatus(value: string): "" | QueueStatus {
  if (value === "SUBMITTED" || value === "IN_REVIEW") {
    return value;
  }

  return "";
}

function buildQueryString(filters: QueueFilters): string {
  const params = new URLSearchParams();

  if (filters.status) {
    params.set("status", filters.status);
  }

  if (filters.countryCode) {
    params.set("countryCode", filters.countryCode.toUpperCase());
  }

  if (filters.userEmail) {
    params.set("userEmail", filters.userEmail);
  }

  if (filters.requestId) {
    params.set("requestId", filters.requestId);
  }

  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "N/A";
  }

  return value;
}

async function buildCookieHeader(): Promise<string> {
  try {
    const cookieStore = await cookies();

    return cookieStore
      .getAll()
      .map((entry) => `${entry.name}=${entry.value}`)
      .join("; ");
  } catch {
    return "";
  }
}

async function loadQueueFromApi(filters: QueueFilters, cookieHeader: string) {
  const listParams = new URLSearchParams();

  if (filters.status) {
    listParams.set("status", filters.status);
  }

  if (filters.countryCode) {
    listParams.set("countryCode", filters.countryCode.toUpperCase());
  }

  if (filters.userEmail) {
    listParams.set("userEmail", filters.userEmail);
  }

  const listQuery = listParams.toString();
  const listUrl = `http://localhost/api/v1/admin/sourcing-requests${
    listQuery.length > 0 ? `?${listQuery}` : ""
  }`;

  const listResponse = await getAdminQueue(
    new NextRequest(listUrl, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    }),
  );

  const listPayload = (await listResponse.json()) as
    | AdminQueueListResponse
    | ErrorResponse;

  if (listResponse.status !== 200) {
    return {
      listStatus: listResponse.status,
      listError: listPayload as ErrorResponse,
      listItems: [] as AdminQueueListItem[],
      detailStatus: null as number | null,
      detailError: null as ErrorResponse | null,
      detailPayload: null as AdminQueueDetailResponse | null,
    };
  }

  if (!filters.requestId) {
    return {
      listStatus: listResponse.status,
      listError: null,
      listItems: (listPayload as AdminQueueListResponse).requests,
      detailStatus: null as number | null,
      detailError: null as ErrorResponse | null,
      detailPayload: null as AdminQueueDetailResponse | null,
    };
  }

  const detailResponse = await getAdminQueueDetail(
    new NextRequest(
      `http://localhost/api/v1/admin/sourcing-requests/${encodeURIComponent(
        filters.requestId,
      )}`,
      {
        headers: cookieHeader ? { cookie: cookieHeader } : {},
      },
    ),
    { params: Promise.resolve({ requestId: filters.requestId }) },
  );

  const detailPayload = (await detailResponse.json()) as
    | AdminQueueDetailResponse
    | ErrorResponse;

  if (detailResponse.status !== 200) {
    return {
      listStatus: listResponse.status,
      listError: null,
      listItems: (listPayload as AdminQueueListResponse).requests,
      detailStatus: detailResponse.status,
      detailError: detailPayload as ErrorResponse,
      detailPayload: null,
    };
  }

  return {
    listStatus: listResponse.status,
    listError: null,
    listItems: (listPayload as AdminQueueListResponse).requests,
    detailStatus: detailResponse.status,
    detailError: null,
    detailPayload: detailPayload as AdminQueueDetailResponse,
  };
}

export default async function AdminSourcingQueuePage({
  searchParams,
}: AdminQueuePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const filters: QueueFilters = {
    status: normalizeStatus(firstParam(resolvedSearchParams?.status)),
    countryCode: firstParam(resolvedSearchParams?.countryCode),
    userEmail: firstParam(resolvedSearchParams?.userEmail),
    requestId: firstParam(resolvedSearchParams?.requestId),
  };

  const cookieHeader = await buildCookieHeader();
  const queueState = await loadQueueFromApi(filters, cookieHeader);

  const queueBaseFilters = {
    status: filters.status,
    countryCode: filters.countryCode,
    userEmail: filters.userEmail,
    requestId: "",
  };

  const clearFiltersHref = "/admin/sourcing-requests";

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-16">
      <nav
        aria-label="Admin navigation"
        className="flex flex-wrap items-center gap-4 text-sm text-neutral-700"
      >
        <Link className="underline" href="/">
          Home
        </Link>
        <Link className="underline" href="/timeline">
          Timeline
        </Link>
        <Link className="underline" href="/admin/sourcing-requests">
          Admin queue
        </Link>
      </nav>

      <h1 className="text-4xl font-semibold">Admin sourcing queue</h1>
      <p className="text-sm text-neutral-700">
        Review pending sourcing requests and open request detail for timeline/artifact context.
      </p>

      <section className="rounded-md border border-neutral-300 p-4">
        <h2 className="text-2xl font-semibold">Queue filters</h2>
        <form className="mt-4 grid gap-3 md:grid-cols-4" method="get">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-600">Status</span>
            <select
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              defaultValue={filters.status}
              name="status"
            >
              <option value="">SUBMITTED + IN_REVIEW</option>
              <option value="SUBMITTED">SUBMITTED</option>
              <option value="IN_REVIEW">IN_REVIEW</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-600">Country code</span>
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              defaultValue={filters.countryCode}
              maxLength={2}
              name="countryCode"
              placeholder="NL"
              type="text"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-600">User email</span>
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              defaultValue={filters.userEmail}
              name="userEmail"
              placeholder="owner@example.com"
              type="email"
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white"
              type="submit"
            >
              Apply filters
            </button>
            <Link className="text-sm underline" href={clearFiltersHref}>
              Reset
            </Link>
          </div>
        </form>
      </section>

      {queueState.listStatus !== 200 ? (
        <section className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <h2 className="text-base font-semibold">Admin access required</h2>
          <p className="mt-2">
            {queueState.listError?.error.message ??
              "Unable to load admin queue. Sign in with an admin account."}
          </p>
        </section>
      ) : (
        <section className="rounded-md border border-neutral-300 p-4">
          <h2 className="text-2xl font-semibold">Queue requests</h2>

          {queueState.listItems.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-700">
              No queue requests matched the selected filters.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {queueState.listItems.map((entry) => {
                const detailHref = `/admin/sourcing-requests${buildQueryString({
                  ...queueBaseFilters,
                  requestId: entry.requestId,
                })}`;

                return (
                  <li
                    className="rounded-md border border-neutral-200 p-3"
                    key={entry.requestId}
                  >
                    <p className="text-sm font-medium">Request {entry.requestId}</p>
                    <p className="text-sm">Status: {entry.status}</p>
                    <p className="text-xs text-neutral-600">
                      Owner: {entry.userEmail} | Country: {entry.countryCode}
                    </p>
                    <p className="text-xs text-neutral-600">
                      Created: {formatTimestamp(entry.createdAt)} | Updated: {formatTimestamp(entry.updatedAt)}
                    </p>
                    <p className="text-xs text-neutral-600">
                      Latest event: {formatTimestamp(entry.latestEventAt)}
                    </p>
                    <p className="mt-2 text-xs">
                      <Link className="underline" href={detailHref}>
                        Open request detail
                      </Link>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {queueState.listStatus === 200 && filters.requestId ? (
        <section className="rounded-md border border-neutral-300 p-4">
          <h2 className="text-2xl font-semibold">Request detail</h2>

          {queueState.detailStatus === 200 && queueState.detailPayload ? (
            <>
              <p className="mt-2 text-sm">
                Request {queueState.detailPayload.request.requestId} ({queueState.detailPayload.request.status})
              </p>
              <p className="text-xs text-neutral-600">
                Owner: {queueState.detailPayload.request.userEmail} | Country: {queueState.detailPayload.request.countryCode}
              </p>
              <p className="text-xs text-neutral-600">
                Prescription created: {formatTimestamp(queueState.detailPayload.request.prescriptionCreatedAt)}
              </p>

              <h3 className="mt-4 text-sm font-semibold">Timeline</h3>
              {queueState.detailPayload.timeline.length === 0 ? (
                <p className="mt-1 text-xs text-neutral-600">No timeline events recorded.</p>
              ) : (
                <ul className="mt-2 list-disc pl-6 text-xs">
                  {queueState.detailPayload.timeline.map((event) => (
                    <li key={event.id}>
                      {event.fromStatus ?? "START"} -&gt; {event.toStatus} ({formatTimestamp(event.createdAt)})
                      {event.note ? ` - ${event.note}` : ""}
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mt-4 text-sm font-semibold">Report artifacts</h3>
              {queueState.detailPayload.reportArtifacts.length === 0 ? (
                <p className="mt-1 text-xs text-neutral-600">No report artifacts attached.</p>
              ) : (
                <ul className="mt-2 list-disc pl-6 text-xs">
                  {queueState.detailPayload.reportArtifacts.map((artifact) => (
                    <li key={artifact.id}>
                      {artifact.storageKey} ({artifact.deliveryChannel}) - Delivered: {formatTimestamp(artifact.deliveredAt)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-neutral-700">
              {queueState.detailError?.error.code === "NOT_FOUND"
                ? "Requested queue detail was not found."
                : "Unable to load queue detail for this request."}
            </p>
          )}
        </section>
      ) : null}
    </main>
  );
}
