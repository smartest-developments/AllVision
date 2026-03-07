import React from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { GET as getPendingDeleteRequests } from "../../api/v1/admin/gdpr/delete-requests/route";

type PendingDeleteRequest = {
  requestId: string;
  userId: string;
  userEmail: string;
  requestedAt: string;
  status: "PENDING_REVIEW";
};

type PendingDeleteListResponse = {
  requests: PendingDeleteRequest[];
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

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

async function loadPendingDeleteRequests(cookieHeader: string) {
  const response = await getPendingDeleteRequests(
    new NextRequest("http://localhost/api/v1/admin/gdpr/delete-requests", {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    }),
  );

  const payload = (await response.json()) as PendingDeleteListResponse | ErrorResponse;

  if (response.status !== 200) {
    return {
      status: response.status,
      error: payload as ErrorResponse,
      requests: [] as PendingDeleteRequest[],
    };
  }

  return {
    status: response.status,
    error: null,
    requests: (payload as PendingDeleteListResponse).requests,
  };
}

export default async function AdminGdprDeleteRequestsPage() {
  const cookieHeader = await buildCookieHeader();
  const queueState = await loadPendingDeleteRequests(cookieHeader);

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
        <Link className="underline" href="/admin/gdpr-delete-requests">
          GDPR deletes
        </Link>
      </nav>

      <h1 className="text-4xl font-semibold">Admin GDPR deletion queue</h1>
      <p className="text-sm text-neutral-700">
        Review pending account-deletion requests and execute irreversible anonymization after review.
      </p>

      {queueState.status !== 200 ? (
        <section className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <h2 className="text-base font-semibold">Admin access required</h2>
          <p className="mt-2">
            {queueState.error?.error.message ??
              "Unable to load GDPR deletion queue. Sign in with an admin account."}
          </p>
        </section>
      ) : queueState.requests.length === 0 ? (
        <section className="rounded-md border border-neutral-300 p-4 text-sm text-neutral-700">
          No pending GDPR deletion requests.
        </section>
      ) : (
        <section className="rounded-md border border-neutral-300 p-4">
          <h2 className="text-2xl font-semibold">Pending requests</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {queueState.requests.map((request) => (
              <li key={request.requestId} className="rounded-md border border-neutral-200 p-3">
                <p>
                  <strong>Request {request.requestId}</strong> - {request.status}
                </p>
                <p>User: {request.userEmail}</p>
                <p className="text-xs text-neutral-600">Requested at: {request.requestedAt}</p>
                <form
                  action={`/api/v1/admin/gdpr/delete-requests/${encodeURIComponent(request.requestId)}/execute`}
                  method="post"
                >
                  <button
                    className="mt-3 rounded-md bg-neutral-900 px-3 py-2 text-sm text-white"
                    type="submit"
                  >
                    Execute anonymization
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
