import React from "react";
import Link from "next/link";
import { getLegalCopy } from "@/legal/disclaimers";
import {
  formatReportFeeReadinessContext,
  formatPostDeliveryAcknowledgmentConfirmation,
  formatPostCheckoutPendingConfirmation,
  formatPendingReportFeeMessage,
  resolvePendingReportFeeHintBadge,
} from "@/lib/report-fee";
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
    checkout?: string | string[];
    ack?: string | string[];
    settledAt?: string | string[];
    settledByRole?: string | string[];
    settledByUserId?: string | string[];
    settledByUserEmail?: string | string[];
    settlementEventId?: string | string[];
    settlementNote?: string | string[];
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
  const rawCheckout = resolvedSearchParams?.checkout;
  const checkoutCompleted = typeof rawCheckout === "string" && rawCheckout === "1";
  const rawAck = resolvedSearchParams?.ack;
  const acknowledgmentCompleted = typeof rawAck === "string" && rawAck === "1";
  const rawSettledAt = resolvedSearchParams?.settledAt;
  const redirectSettledAt =
    typeof rawSettledAt === "string" && rawSettledAt.trim() !== ""
      ? rawSettledAt.trim()
      : null;
  const rawSettledByRole = resolvedSearchParams?.settledByRole;
  const redirectSettledByRole =
    typeof rawSettledByRole === "string" &&
    (rawSettledByRole === "USER" || rawSettledByRole === "ADMIN")
      ? rawSettledByRole
      : null;
  const rawSettledByUserId = resolvedSearchParams?.settledByUserId;
  const redirectSettledByUserId =
    typeof rawSettledByUserId === "string" && rawSettledByUserId.trim() !== ""
      ? rawSettledByUserId.trim()
      : null;
  const rawSettledByUserEmail = resolvedSearchParams?.settledByUserEmail;
  const redirectSettledByUserEmail =
    typeof rawSettledByUserEmail === "string" && rawSettledByUserEmail.trim() !== ""
      ? rawSettledByUserEmail.trim()
      : null;
  const hasCompleteRedirectActorTrio =
    redirectSettledByRole !== null &&
    redirectSettledByUserId !== null &&
    redirectSettledByUserEmail !== null;
  const coherentRedirectSettledByRole = hasCompleteRedirectActorTrio
    ? redirectSettledByRole
    : null;
  const coherentRedirectSettledByUserId = hasCompleteRedirectActorTrio
    ? redirectSettledByUserId
    : null;
  const coherentRedirectSettledByUserEmail = hasCompleteRedirectActorTrio
    ? redirectSettledByUserEmail
    : null;
  const rawSettlementEventId = resolvedSearchParams?.settlementEventId;
  const redirectSettlementEventId =
    typeof rawSettlementEventId === "string" && rawSettlementEventId.trim() !== ""
      ? rawSettlementEventId.trim()
      : null;
  const rawSettlementNote = resolvedSearchParams?.settlementNote;
  const redirectSettlementNote =
    typeof rawSettlementNote === "string" && rawSettlementNote.trim() !== ""
      ? rawSettlementNote.trim()
      : null;
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
      <nav aria-label="Authenticated navigation" className="flex flex-wrap items-center gap-4 text-sm text-neutral-700">
        <Link className="underline" href={homeHref}>Home</Link>
        <Link className="underline" href={timelineHref}>Timeline</Link>
        {sessionIdentity?.role === "ADMIN" ? (
          <Link className="underline" href="/admin/sourcing-requests">Admin</Link>
        ) : null}
        <Link className="underline" href="/gdpr">GDPR</Link>
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
              const reportFeePendingReasonBadge = resolvePendingReportFeeHintBadge(
                request.reportFee,
              );
              const reportFeeCheckoutAction = `/api/v1/sourcing-requests/${encodeURIComponent(
                request.requestId,
              )}/report-fee/checkout`;
              const timelineRedirectTo = `/timeline?requestId=${encodeURIComponent(
                request.requestId,
              )}&checkout=1`;
              const checkoutForCurrentRequest =
                checkoutCompleted &&
                requestId !== "" &&
                requestId === request.requestId;
              const showCheckoutConfirmation =
                checkoutForCurrentRequest && request.reportFee.required;
              const checkoutConfirmationReportFee = showCheckoutConfirmation
                ? {
                    ...request.reportFee,
                    settledAt: request.reportFee.settledAt ?? redirectSettledAt,
                    settledByRole:
                      request.reportFee.settledByRole ?? coherentRedirectSettledByRole,
                    settledByUserId:
                      request.reportFee.settledByUserId ?? coherentRedirectSettledByUserId,
                    settledByUserEmail:
                      request.reportFee.settledByUserEmail ??
                      coherentRedirectSettledByUserEmail,
                    settlementEventId:
                      request.reportFee.settlementEventId ?? redirectSettlementEventId,
                    settlementNote: request.reportFee.settlementNote ?? redirectSettlementNote,
                  }
                : request.reportFee;
              const acknowledgmentForCurrentRequest =
                acknowledgmentCompleted &&
                requestId !== "" &&
                requestId === request.requestId;
              const showAcknowledgmentConfirmation =
                acknowledgmentForCurrentRequest && request.status === "DELIVERED";
              const acknowledgmentConfirmationReportFee = showAcknowledgmentConfirmation
                ? {
                    ...request.reportFee,
                    settledAt: request.reportFee.settledAt ?? redirectSettledAt,
                    settledByRole:
                      request.reportFee.settledByRole ?? coherentRedirectSettledByRole,
                    settledByUserId:
                      request.reportFee.settledByUserId ?? coherentRedirectSettledByUserId,
                    settledByUserEmail:
                      request.reportFee.settledByUserEmail ??
                      coherentRedirectSettledByUserEmail,
                    settlementEventId:
                      request.reportFee.settlementEventId ?? redirectSettlementEventId,
                    settlementNote: request.reportFee.settlementNote ?? redirectSettlementNote,
                  }
                : request.reportFee;
              const reportFeeReadinessContext = formatReportFeeReadinessContext(
                request.reportFee,
              );
              const timelineAckRedirectTo = `/timeline?requestId=${encodeURIComponent(
                request.requestId,
              )}&ack=1`;
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
                  {showCheckoutConfirmation ? (
                    <p className="mb-1 mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900">
                      {formatPostCheckoutPendingConfirmation(checkoutConfirmationReportFee)}
                    </p>
                  ) : null}
                  {showAcknowledgmentConfirmation ? (
                    <p className="mb-1 mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900">
                      {formatPostDeliveryAcknowledgmentConfirmation(
                        acknowledgmentConfirmationReportFee,
                      )}
                    </p>
                  ) : null}
                  {(request.status === "REPORT_READY" || request.status === "PAYMENT_SETTLED") &&
                  !reportFeeRequiresPayment ? (
                    <>
                      {reportFeeReadinessContext ? (
                        <p className="mt-2 text-xs text-neutral-700">{reportFeeReadinessContext}</p>
                      ) : null}
                      <form
                        className="mt-2"
                        action={`/api/v1/sourcing-requests/${encodeURIComponent(
                          request.requestId,
                        )}/report/ack`}
                        method="post"
                      >
                        <input type="hidden" name="redirectTo" value={timelineAckRedirectTo} />
                        <button
                          type="submit"
                          className="rounded-md border border-neutral-400 px-2 py-1 text-xs text-neutral-900"
                        >
                          Acknowledge report delivery
                        </button>
                      </form>
                    </>
                  ) : null}
                  {reportFeeRequiresPayment ? (
                    <form className="mt-2 text-xs text-neutral-700" action={reportFeeCheckoutAction} method="post">
                      <input type="hidden" name="redirectTo" value={timelineRedirectTo} />
                      {reportFeePendingReasonBadge ? (
                        <p className="mb-1 inline-flex rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-700">
                          {reportFeePendingReasonBadge}
                        </p>
                      ) : null}
                      {formatPendingReportFeeMessage(request.reportFee)}
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
