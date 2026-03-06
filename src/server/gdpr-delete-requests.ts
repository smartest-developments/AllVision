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
  status: "ANONYMIZED";
  requestedAt: string;
  completedAt: string;
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

export async function createGdprDeleteRequest(userId: string): Promise<GdprDeleteRequestRecord> {
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

  const now = new Date();
  const anonymizedEmail = `deleted-${userId}-${randomUUID()}@allvision.invalid`;
  const anonymizedPasswordHash = `deleted:${randomUUID()}`;

  const { softDeleteEvent, anonymizedEvent } = await prisma.$transaction(async (tx) => {
    const softDelete = await tx.auditEvent.create({
      data: {
        actorUserId: userId,
        entityType: "User",
        entityId: userId,
        action: "GDPR_DELETE_REQUESTED",
        context: {
          status: "SOFT_DELETED",
          requestedAt: now.toISOString(),
          legalHoldChecked: true,
        },
      },
    });

    await tx.session.updateMany({
      where: { userId },
      data: { revokedAt: now },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        email: anonymizedEmail,
        passwordHash: anonymizedPasswordHash,
      },
    });

    await tx.prescription.updateMany({
      where: { userId },
      data: {
        countryCode: "XX",
        payload: {
          redacted: true,
          reason: "GDPR_DELETE_REQUESTED",
          redactedAt: now.toISOString(),
        } satisfies Prisma.InputJsonValue,
      },
    });

    const anonymized = await tx.auditEvent.create({
      data: {
        actorUserId: null,
        entityType: "User",
        entityId: userId,
        action: "GDPR_DELETE_COMPLETED",
        context: {
          status: "ANONYMIZED",
          requestedAt: softDelete.createdAt.toISOString(),
          completedAt: now.toISOString(),
        },
      },
    });

    return {
      softDeleteEvent: softDelete,
      anonymizedEvent: anonymized,
    };
  });

  return {
    requestId: softDeleteEvent.id,
    status: "ANONYMIZED",
    requestedAt: toIsoString(softDeleteEvent.createdAt),
    completedAt: toIsoString(
      (anonymizedEvent.context as { completedAt?: unknown } | null)?.completedAt ?? anonymizedEvent.createdAt,
    ),
  };
}
