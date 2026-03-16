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
import { resolvePageSessionUserId } from "@/server/page-auth";
import { listSourcingRequestStatusesForUser } from "@/server/sourcing-request-status";

function formatTimestamp(value: Date | null): string {
  if (!value) {
    return "N/A";
  }

  return value.toISOString();
}

type HomePageProps = {
  searchParams?: Promise<{
    requestId?: string | string[];
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

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawRequestId = resolvedSearchParams?.requestId;
  const checkoutRequestId = typeof rawRequestId === "string" ? rawRequestId.trim() : "";
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
        <Link className="underline" href="/gdpr">
          GDPR
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
            {requests.map((request) => {
              const reportFeeRequiresPayment =
                request.reportFee.required && request.reportFee.paymentState === "PENDING";
              const reportFeePendingReasonBadge = resolvePendingReportFeeHintBadge(
                request.reportFee,
              );
              const reportFeeCheckoutAction = `/api/v1/sourcing-requests/${encodeURIComponent(
                request.requestId,
              )}/report-fee/checkout`;
              const homeRedirectTo = `/?requestId=${encodeURIComponent(
                request.requestId,
              )}&checkout=1`;
              const checkoutForCurrentRequest =
                checkoutCompleted &&
                checkoutRequestId !== "" &&
                checkoutRequestId === request.requestId;
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
                checkoutRequestId !== "" &&
                checkoutRequestId === request.requestId;
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
              const ackRedirectTo = `/?requestId=${encodeURIComponent(
                request.requestId,
              )}&ack=1`;
              return (
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
                        <input type="hidden" name="redirectTo" value={ackRedirectTo} />
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
                    <form
                      className="mt-2 text-xs text-neutral-700"
                      action={reportFeeCheckoutAction}
                      method="post"
                    >
                      <input type="hidden" name="redirectTo" value={homeRedirectTo} />
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
      </section>

      <section className="rounded-md border border-neutral-300 p-4">
        <h2 className="text-2xl font-semibold">GDPR self-service actions</h2>
        <p className="mt-2 text-sm text-neutral-700">
          Use these controls to create export/deletion requests from the authenticated UI.
        </p>
        <p className="mt-2 text-sm text-neutral-700">
          For request history and legal-hold guidance, open{" "}
          <Link className="underline" href="/gdpr">
            /gdpr
          </Link>
          .
        </p>

        {!userId ? (
          <p className="mt-4 text-sm text-neutral-700">
            Sign in to submit GDPR requests. <Link className="underline" href={signInHref}>Sign in</Link>
            .
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-3">
            <form action="/api/v1/gdpr/export" method="post">
              <button
                type="submit"
                className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white"
              >
                Request data export
              </button>
            </form>
            <form action="/api/v1/gdpr/delete" method="post">
              <button
                type="submit"
                className="rounded-md border border-neutral-400 px-3 py-2 text-sm text-neutral-900"
              >
                Request account deletion
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
