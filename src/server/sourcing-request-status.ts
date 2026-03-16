import { SourcingRequestStatus, UserRole } from "@prisma/client";

import { prisma } from "@/server/db";

export type ReportFeePaymentState = "NOT_REQUIRED" | "PENDING" | "SETTLED";
export type ReportFeePendingReason = "PRICING_IN_PROGRESS";

export type UserSourcingRequestStatus = {
  requestId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  latestEventAt: Date | null;
  reportFee: {
    required: boolean;
    feeCents: number | null;
    currency: string;
    paymentState: ReportFeePaymentState;
    pendingReason: ReportFeePendingReason | null;
    checkoutInitiatedAt: string | null;
    settledAt: string | null;
    settledByRole: UserRole | null;
    settledByUserId: string | null;
    settledByUserEmail: string | null;
    settlementEventId: string | null;
    settlementNote: string | null;
  };
  timeline: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    createdAt: Date;
  }>;
};

function resolveReportFeePaymentState(
  required: boolean,
  status: SourcingRequestStatus,
): ReportFeePaymentState {
  if (!required) {
    return "NOT_REQUIRED";
  }

  if (
    status === SourcingRequestStatus.PAYMENT_SETTLED ||
    status === SourcingRequestStatus.DELIVERED
  ) {
    return "SETTLED";
  }

  return "PENDING";
}

function resolveReportFeePendingReason(
  required: boolean,
  paymentState: ReportFeePaymentState,
  feeCents: number | null,
): ReportFeePendingReason | null {
  if (!required || paymentState !== "PENDING" || feeCents !== null) {
    return null;
  }

  return "PRICING_IN_PROGRESS";
}

function resolveCheckoutInitiatedAt(
  timeline: UserSourcingRequestStatus["timeline"],
): string | null {
  const checkoutEvent = timeline.find((event) => event.toStatus === "PAYMENT_PENDING");
  return checkoutEvent ? checkoutEvent.createdAt.toISOString() : null;
}

export async function listSourcingRequestStatusesForUser(
  userId: string,
): Promise<UserSourcingRequestStatus[]> {
  const requests = await prisma.sourcingRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      statusEvents: {
        orderBy: { createdAt: "desc" },
        include: {
          actor: {
            select: { id: true, role: true, email: true },
          },
        },
      },
    },
  });

  return requests.map((request) => {
    const paymentState = resolveReportFeePaymentState(
      request.reportPaymentRequired,
      request.status,
    );

    const timeline = request.statusEvents.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt,
    }));
    const settlementEvent = request.statusEvents.find(
      (event) => event.toStatus === SourcingRequestStatus.PAYMENT_SETTLED,
    );

    return {
      requestId: request.id,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      latestEventAt: request.statusEvents[0]?.createdAt ?? null,
      reportFee: {
        required: request.reportPaymentRequired,
        feeCents: request.reportFeeCents,
        currency: request.currency,
        paymentState,
        pendingReason: resolveReportFeePendingReason(
          request.reportPaymentRequired,
          paymentState,
          request.reportFeeCents,
        ),
        checkoutInitiatedAt: resolveCheckoutInitiatedAt(timeline),
        settledAt: settlementEvent?.createdAt.toISOString() ?? null,
        settledByRole: settlementEvent?.actor?.role ?? null,
        settledByUserId: settlementEvent?.actor?.id ?? null,
        settledByUserEmail: settlementEvent?.actor?.email ?? null,
        settlementEventId: settlementEvent?.id ?? null,
        settlementNote: settlementEvent?.note ?? null,
      },
      timeline,
    };
  });
}
