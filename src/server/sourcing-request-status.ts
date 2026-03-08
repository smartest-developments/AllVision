import { SourcingRequestStatus } from "@prisma/client";

import { prisma } from "@/server/db";

export type ReportFeePaymentState = "NOT_REQUIRED" | "PENDING" | "SETTLED";

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

export async function listSourcingRequestStatusesForUser(
  userId: string,
): Promise<UserSourcingRequestStatus[]> {
  const requests = await prisma.sourcingRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      statusEvents: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return requests.map((request) => ({
    requestId: request.id,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    latestEventAt: request.statusEvents[0]?.createdAt ?? null,
    reportFee: {
      required: request.reportPaymentRequired,
      feeCents: request.reportFeeCents,
      currency: request.currency,
      paymentState: resolveReportFeePaymentState(
        request.reportPaymentRequired,
        request.status,
      ),
    },
    timeline: request.statusEvents.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt,
    })),
  }));
}
