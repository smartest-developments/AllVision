import { prisma } from "@/server/db";
import { SourcingRequestStatus } from "@prisma/client";

export class ReportRetrievalError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function getReportArtifactForOwner(input: {
  requestId: string;
  userId: string;
}) {
  const request = await prisma.sourcingRequest.findUnique({
    where: { id: input.requestId },
    include: {
      reportArtifacts: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!request) {
    throw new ReportRetrievalError("NOT_FOUND", "Sourcing request not found.", 404);
  }

  if (request.userId !== input.userId) {
    throw new ReportRetrievalError("FORBIDDEN", "Access denied.", 403);
  }

  if (
    request.status !== SourcingRequestStatus.REPORT_READY &&
    request.status !== SourcingRequestStatus.DELIVERED
  ) {
    throw new ReportRetrievalError(
      "REPORT_NOT_READY",
      "Report is not available yet.",
      409
    );
  }

  const artifact = request.reportArtifacts[0];
  if (!artifact) {
    throw new ReportRetrievalError("REPORT_NOT_READY", "Report is not available yet.", 409);
  }

  return { request, artifact };
}

export async function acknowledgeReportDeliveryForOwner(input: {
  requestId: string;
  userId: string;
}) {
  const request = await prisma.sourcingRequest.findUnique({
    where: { id: input.requestId },
    include: {
      reportArtifacts: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!request) {
    throw new ReportRetrievalError("NOT_FOUND", "Sourcing request not found.", 404);
  }

  if (request.userId !== input.userId) {
    throw new ReportRetrievalError("FORBIDDEN", "Access denied.", 403);
  }

  if (request.status !== SourcingRequestStatus.REPORT_READY && request.status !== SourcingRequestStatus.DELIVERED) {
    throw new ReportRetrievalError("REPORT_NOT_READY", "Report is not available yet.", 409);
  }

  const artifact = request.reportArtifacts[0];
  if (!artifact) {
    throw new ReportRetrievalError("REPORT_NOT_READY", "Report is not available yet.", 409);
  }

  if (request.status === SourcingRequestStatus.DELIVERED) {
    return request;
  }

  return prisma.$transaction(async (tx) => {
    const transition = await tx.sourcingRequest.updateMany({
      where: {
        id: request.id,
        status: SourcingRequestStatus.REPORT_READY
      },
      data: {
        status: SourcingRequestStatus.DELIVERED
      }
    });

    if (transition.count === 0) {
      return tx.sourcingRequest.findUniqueOrThrow({
        where: { id: request.id }
      });
    }

    const statusEvent = await tx.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: request.status,
        toStatus: SourcingRequestStatus.DELIVERED,
        actorUserId: input.userId,
        note: "Owner acknowledged report delivery."
      }
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.userId,
        sourcingRequestId: request.id,
        entityType: "SourcingRequest",
        entityId: request.id,
        action: "REPORT_DELIVERY_ACKNOWLEDGED",
        context: {
          fromStatus: request.status,
          toStatus: SourcingRequestStatus.DELIVERED,
          statusEventId: statusEvent.id,
          artifactId: artifact.id
        }
      }
    });

    return tx.sourcingRequest.findUniqueOrThrow({
      where: { id: request.id }
    });
  });
}

export async function startReportFeeCheckoutForOwner(input: {
  requestId: string;
  userId: string;
}) {
  const request = await prisma.sourcingRequest.findUnique({
    where: { id: input.requestId }
  });

  if (!request) {
    throw new ReportRetrievalError("NOT_FOUND", "Sourcing request not found.", 404);
  }

  if (request.userId !== input.userId) {
    throw new ReportRetrievalError("FORBIDDEN", "Access denied.", 403);
  }

  if (!request.reportPaymentRequired) {
    throw new ReportRetrievalError(
      "REPORT_FEE_NOT_REQUIRED",
      "Report fee is not required for this request.",
      409
    );
  }

  if (
    request.status === SourcingRequestStatus.PAYMENT_PENDING ||
    request.status === SourcingRequestStatus.PAYMENT_SETTLED ||
    request.status === SourcingRequestStatus.DELIVERED
  ) {
    return request;
  }

  if (request.status !== SourcingRequestStatus.REPORT_READY) {
    throw new ReportRetrievalError(
      "PAYMENT_NOT_READY",
      "Report fee checkout can start only when report is ready.",
      409
    );
  }

  return prisma.$transaction(async (tx) => {
    const transition = await tx.sourcingRequest.updateMany({
      where: {
        id: request.id,
        status: SourcingRequestStatus.REPORT_READY
      },
      data: {
        status: SourcingRequestStatus.PAYMENT_PENDING
      }
    });

    if (transition.count === 0) {
      return tx.sourcingRequest.findUniqueOrThrow({
        where: { id: request.id }
      });
    }

    const statusEvent = await tx.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: SourcingRequestStatus.REPORT_READY,
        toStatus: SourcingRequestStatus.PAYMENT_PENDING,
        actorUserId: input.userId,
        note: "Owner initiated report-fee checkout."
      }
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.userId,
        sourcingRequestId: request.id,
        entityType: "SourcingRequest",
        entityId: request.id,
        action: "REPORT_FEE_CHECKOUT_INITIATED",
        context: {
          fromStatus: SourcingRequestStatus.REPORT_READY,
          toStatus: SourcingRequestStatus.PAYMENT_PENDING,
          statusEventId: statusEvent.id,
          product: "REPORT_SERVICE",
          feeCents: request.reportFeeCents,
          currency: request.currency
        }
      }
    });

    return tx.sourcingRequest.findUniqueOrThrow({
      where: { id: request.id }
    });
  });
}
