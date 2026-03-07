import { randomUUID } from "node:crypto";

import { Prisma, SourcingRequestStatus } from "@prisma/client";

import { prisma } from "@/server/db";

export class GdprDeleteRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type GdprDeleteRequestRecord = {
  requestId: string;
  status: "PENDING_REVIEW";
  requestedAt: string;
};

export type GdprDeleteExecutionRecord = {
  requestId: string;
  userId: string;
  status: "ANONYMIZED";
  requestedAt: string;
  completedAt: string;
  reviewedByAdminUserId: string;
};

export type PendingGdprDeleteRequest = {
  requestId: string;
  userId: string;
  userEmail: string;
  requestedAt: string;
  status: "PENDING_REVIEW";
};

const LEGAL_HOLD_STATUSES: SourcingRequestStatus[] = ["SUBMITTED", "IN_REVIEW"];

function toIsoString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date().toISOString();
}

function toJsonRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

async function assertLegalHoldClear(userId: string) {
  const activeRequestsCount = await prisma.sourcingRequest.count({
    where: {
      userId,
      status: { in: LEGAL_HOLD_STATUSES },
    },
  });

  if (activeRequestsCount > 0) {
    throw new GdprDeleteRequestError(
      409,
      "GDPR_DELETE_LEGAL_HOLD",
      "Deletion is blocked by legal hold while sourcing requests are active.",
    );
  }
}

export async function createGdprDeleteRequest(userId: string): Promise<GdprDeleteRequestRecord> {
  await assertLegalHoldClear(userId);

  const requestEvent = await prisma.auditEvent.create({
    data: {
      actorUserId: userId,
      entityType: "User",
      entityId: userId,
      action: "GDPR_DELETE_REQUESTED",
      context: {
        status: "PENDING_REVIEW",
        requestedAt: new Date().toISOString(),
        legalHoldChecked: true,
      },
    },
  });

  return {
    requestId: requestEvent.id,
    status: "PENDING_REVIEW",
    requestedAt: toIsoString(requestEvent.createdAt),
  };
}

export async function listPendingGdprDeleteRequests(): Promise<PendingGdprDeleteRequest[]> {
  const requestedEvents = await prisma.auditEvent.findMany({
    where: {
      action: "GDPR_DELETE_REQUESTED",
      entityType: "User",
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  const completedEvents = await prisma.auditEvent.findMany({
    where: {
      action: "GDPR_DELETE_COMPLETED",
      entityType: "User",
    },
    select: { context: true },
  });

  const completedRequestIds = new Set(
    completedEvents
      .map((event) => toJsonRecord(event.context).requestId)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );

  const pendingEvents = requestedEvents.filter((event) => {
    if (!event.entityId || completedRequestIds.has(event.id)) {
      return false;
    }

    const context = toJsonRecord(event.context);
    return context.status === "PENDING_REVIEW";
  });

  if (pendingEvents.length === 0) {
    return [];
  }

  const userIds = Array.from(new Set(pendingEvents.map((event) => event.entityId as string)));
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true },
  });
  const userById = new Map(users.map((user) => [user.id, user]));

  return pendingEvents
    .map((event) => {
      const user = userById.get(event.entityId as string);
      if (!user) {
        return null;
      }

      return {
        requestId: event.id,
        userId: user.id,
        userEmail: user.email,
        requestedAt: event.createdAt.toISOString(),
        status: "PENDING_REVIEW" as const,
      };
    })
    .filter((item): item is PendingGdprDeleteRequest => item !== null);
}

export async function executeGdprDeleteRequest(input: {
  requestId: string;
  adminUserId: string;
}): Promise<GdprDeleteExecutionRecord> {
  const requestEvent = await prisma.auditEvent.findUnique({
    where: { id: input.requestId },
  });

  if (
    !requestEvent ||
    requestEvent.action !== "GDPR_DELETE_REQUESTED" ||
    requestEvent.entityType !== "User" ||
    !requestEvent.entityId
  ) {
    throw new GdprDeleteRequestError(404, "GDPR_DELETE_REQUEST_NOT_FOUND", "Delete request was not found.");
  }

  const targetUserId = requestEvent.entityId;
  const requestContext = toJsonRecord(requestEvent.context);
  if (requestContext.status !== "PENDING_REVIEW") {
    throw new GdprDeleteRequestError(409, "GDPR_DELETE_REQUEST_NOT_PENDING", "Delete request is not pending review.");
  }

  const completedEvents = await prisma.auditEvent.findMany({
    where: {
      action: "GDPR_DELETE_COMPLETED",
      entityType: "User",
      entityId: targetUserId,
    },
    select: { context: true },
  });

  const alreadyCompleted = completedEvents.some((event) => {
    const context = toJsonRecord(event.context);
    return context.requestId === input.requestId;
  });

  if (alreadyCompleted) {
    throw new GdprDeleteRequestError(409, "GDPR_DELETE_ALREADY_EXECUTED", "Delete request was already executed.");
  }

  await assertLegalHoldClear(targetUserId);

  const now = new Date();
  const anonymizedEmail = `deleted-${targetUserId}-${randomUUID()}@allvision.invalid`;
  const anonymizedPasswordHash = `deleted:${randomUUID()}`;
  const anonymizedStorageKey = `deleted:${targetUserId}:${randomUUID()}`;

  const completedEvent = await prisma.$transaction(async (tx) => {
    const revokedSessions = await tx.session.updateMany({
      where: { userId: targetUserId },
      data: { revokedAt: now },
    });

    await tx.user.update({
      where: { id: targetUserId },
      data: {
        email: anonymizedEmail,
        passwordHash: anonymizedPasswordHash,
      },
    });

    const redactedPrescriptions = await tx.prescription.updateMany({
      where: { userId: targetUserId },
      data: {
        countryCode: "XX",
        payload: {
          redacted: true,
          reason: "GDPR_DELETE_COMPLETED",
          redactedAt: now.toISOString(),
        } satisfies Prisma.InputJsonValue,
      },
    });

    const redactedReportArtifacts = await tx.reportArtifact.updateMany({
      where: {
        sourcingRequest: {
          userId: targetUserId,
        },
      },
      data: {
        storageKey: anonymizedStorageKey,
        checksumSha256: null,
        deliveryChannel: null,
        deliveredAt: null,
      },
    });

    await tx.auditEvent.update({
      where: { id: requestEvent.id },
      data: {
        context: {
          ...requestContext,
          status: "APPROVED",
          reviewedByAdminUserId: input.adminUserId,
          reviewedAt: now.toISOString(),
        } satisfies Prisma.InputJsonValue,
      },
    });

    return tx.auditEvent.create({
      data: {
        actorUserId: input.adminUserId,
        entityType: "User",
        entityId: targetUserId,
        action: "GDPR_DELETE_COMPLETED",
        context: {
          requestId: requestEvent.id,
          status: "ANONYMIZED",
          requestedAt: requestEvent.createdAt.toISOString(),
          completedAt: now.toISOString(),
          reviewedByAdminUserId: input.adminUserId,
          revokedSessionCount: revokedSessions.count,
          redactedPrescriptionCount: redactedPrescriptions.count,
          redactedReportArtifactCount: redactedReportArtifacts.count,
        },
      },
    });
  });

  return {
    requestId: requestEvent.id,
    userId: targetUserId,
    status: "ANONYMIZED",
    requestedAt: requestEvent.createdAt.toISOString(),
    completedAt: toIsoString(
      toJsonRecord(completedEvent.context).completedAt ?? completedEvent.createdAt,
    ),
    reviewedByAdminUserId: input.adminUserId,
  };
}
