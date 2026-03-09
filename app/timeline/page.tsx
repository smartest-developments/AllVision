import React from "react";
import Link from "next/link";
import { getLegalCopy } from "@/legal/disclaimers";
import { formatReportFeeSummary } from "@/lib/report-fee";
import { resolvePageSessionIdentity } from "@/server/page-auth";
import { listSourcingRequestStatusesForUser } from "@/server/sourcing-request-status";
import {
  getPrescriptionForViewer,
  PrescriptionAccessError
} from "@/server/prescriptions";

type TimelinePageProps = {
  searchParams?: Promise<{
    requestId?: string | string[];
    prescriptionId?: string | string[];
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
  const sessionIdentity = await resolvePageSessionIdentity();
  const userId = sessionIdentity?.userId ?? null;
  const rawRequestId = resolvedSearchParams?.requestId;
  const requestId = typeof rawRequestId === "string" ? rawRequestId.trim() : "";
  const rawPrescriptionId = resolvedSearchParams?.prescriptionId;
  const prescriptionId =
    typeof rawPrescriptionId === "string" ? rawPrescriptionId.trim() : "";
  const legal = getLegalCopy("request");
  const requests = userId ? await listSourcingRequestStatusesForUser(userId) : [];
  const filteredRequests = requestId
    ? requests.filter((request) => request.requestId === requestId)
    : requests;
  const homeHref = "/";
  const timelineHref = "/timeline";
  const returnToTimelineHref =
    requestId !== "" || prescriptionId !== ""
      ? `${timelineHref}?${new URLSearchParams({
          ...(requestId !== "" ? { requestId } : {}),
          ...(prescriptionId !== "" ? { prescriptionId } : {}),
        }).toString()}`
      : timelineHref;
  const signInHref = `/auth/login?next=${encodeURIComponent(returnToTimelineHref)}`;
  const registerHref = `/auth/register?next=${encodeURIComponent(
    returnToTimelineHref,
  )}`;
  const hasInvalidRequestFocus =
    userId !== "" && requestId !== "" && filteredRequests.length === 0;
  let prescriptionPanel:
    | { state: "hidden" }
    | { state: "auth_required" }
    | { state: "forbidden" }
    | { state: "not_found" }
    | {
        state: "loaded";
        prescription: {
          id: string;
          countryCode: string;
          consentVersion: string | null;
          leftSphere: string;
          rightSphere: string;
          pupillaryDistance: string;
          createdAt: string;
          updatedAt: string;
        };
      } = { state: "hidden" };

  if (prescriptionId !== "") {
    if (!sessionIdentity) {
      prescriptionPanel = { state: "auth_required" };
    } else {
      try {
        const prescription = await getPrescriptionForViewer({
          prescriptionId,
          viewerUserId: sessionIdentity.userId,
          viewerRole: sessionIdentity.role,
        });
        const payload =
          typeof prescription.payload === "object" && prescription.payload !== null
            ? (prescription.payload as Record<string, unknown>)
            : {};
        const leftEye =
          typeof payload.leftEye === "object" && payload.leftEye !== null
            ? (payload.leftEye as Record<string, unknown>)
            : {};
        const rightEye =
          typeof payload.rightEye === "object" && payload.rightEye !== null
            ? (payload.rightEye as Record<string, unknown>)
            : {};

        prescriptionPanel = {
          state: "loaded",
          prescription: {
            id: prescription.id,
            countryCode: prescription.countryCode,
            consentVersion: prescription.consentVersion,
            leftSphere:
              typeof leftEye.sphere === "number" ? String(leftEye.sphere) : "N/A",
            rightSphere:
              typeof rightEye.sphere === "number" ? String(rightEye.sphere) : "N/A",
            pupillaryDistance:
              typeof payload.pupillaryDistance === "number"
                ? String(payload.pupillaryDistance)
                : "N/A",
            createdAt: formatTimestamp(prescription.createdAt),
            updatedAt: formatTimestamp(prescription.updatedAt),
          },
        };
      } catch (error) {
        if (error instanceof PrescriptionAccessError) {
          prescriptionPanel =
            error.status === 403 ? { state: "forbidden" } : { state: "not_found" };
        } else {
          prescriptionPanel = { state: "not_found" };
        }
      }
    }
  }

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
        <Link className="underline" href="/gdpr">
          GDPR
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
        <form className="mt-3 flex gap-2" method="get">
          <input type="hidden" name="requestId" value={requestId} />
          <input
            type="text"
            name="prescriptionId"
            defaultValue={prescriptionId}
            placeholder="prescription-id (optional)"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
          >
            Open prescription panel
          </button>
        </form>

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
              const reportFeeRequiresPayment =
                request.reportFee.required && request.reportFee.paymentState === "PENDING";
              const reportFeeCheckoutAction = `/api/v1/sourcing-requests/${encodeURIComponent(
                request.requestId,
              )}/report-fee/checkout`;
              const timelineRedirectTo = `/timeline?requestId=${encodeURIComponent(
                request.requestId,
              )}`;
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
                  {(request.status === "REPORT_READY" || request.status === "PAYMENT_SETTLED") &&
                  !reportFeeRequiresPayment ? (
                    <form
                      className="mt-2"
                      action={`/api/v1/sourcing-requests/${encodeURIComponent(
                        request.requestId,
                      )}/report/ack`}
                      method="post"
                    >
                      <button
                        type="submit"
                        className="rounded-md border border-neutral-400 px-2 py-1 text-xs text-neutral-900"
                      >
                        Acknowledge report delivery
                      </button>
                    </form>
                  ) : null}
                  {reportFeeRequiresPayment ? (
                    <form className="mt-2 text-xs text-neutral-700" action={reportFeeCheckoutAction} method="post">
                      <input type="hidden" name="redirectTo" value={timelineRedirectTo} />
                      Report fee pending ({formatReportFeeSummary(request.reportFee)}).
                      <button
                        type="submit"
                        className="ml-2 rounded-md border border-neutral-400 px-2 py-1 text-xs text-neutral-900"
                      >
                        Start report fee checkout
                      </button>
                    </form>
                  ) : null}
                  {request.status === "DELIVERED" ? (
                    <p className="mt-2 text-xs text-neutral-700">
                      Report delivery already acknowledged.
                    </p>
                  ) : null}
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

        {prescriptionPanel.state === "auth_required" ? (
          <p className="mt-4 text-sm text-neutral-700">
            Prescription detail requires authentication (401).{" "}
            <Link className="underline" href={signInHref}>
              Sign in
            </Link>{" "}
            to continue.
          </p>
        ) : null}

        {prescriptionPanel.state === "forbidden" ? (
          <p className="mt-4 text-sm text-neutral-700">
            Prescription detail unavailable: access denied for this account (403).
          </p>
        ) : null}

        {prescriptionPanel.state === "not_found" ? (
          <p className="mt-4 text-sm text-neutral-700">
            Prescription detail unavailable: record not found (404).
          </p>
        ) : null}

        {prescriptionPanel.state === "loaded" ? (
          <section className="mt-4 rounded-md border border-neutral-200 p-3">
            <h3 className="text-sm font-semibold">
              Prescription detail {prescriptionPanel.prescription.id}
            </h3>
            <ul className="mt-2 list-disc pl-6 text-xs">
              <li>Country: {prescriptionPanel.prescription.countryCode}</li>
              <li>Left sphere: {prescriptionPanel.prescription.leftSphere}</li>
              <li>Right sphere: {prescriptionPanel.prescription.rightSphere}</li>
              <li>
                Pupillary distance:{" "}
                {prescriptionPanel.prescription.pupillaryDistance}
              </li>
              <li>
                Consent version:{" "}
                {prescriptionPanel.prescription.consentVersion ?? "N/A"}
              </li>
              <li>Created: {prescriptionPanel.prescription.createdAt}</li>
              <li>Updated: {prescriptionPanel.prescription.updatedAt}</li>
            </ul>
          </section>
        ) : null}
      </section>
    </main>
  );
}
