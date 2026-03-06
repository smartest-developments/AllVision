import { z } from "zod";
import { SourcingRequestStatus } from "@prisma/client";

import { prisma } from "@/server/db";
import { assertValidTransition } from "@/server/sourcing-requests";

export const adminReviewDecisionInputSchema = z.object({
  toStatus: z.enum(["IN_REVIEW"]),
  note: z.string().trim().max(500).optional(),
});

export type AdminReviewDecisionInput = z.infer<typeof adminReviewDecisionInputSchema>;

export class AdminReviewDecisionError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function applyAdminReviewDecision(input: {
  requestId: string;
  adminUserId: string;
  data: AdminReviewDecisionInput;
}) {
  const admin = await prisma.user.findUnique({
    where: { id: input.adminUserId },
  });

  if (!admin || admin.role !== "ADMIN") {
    throw new AdminReviewDecisionError("FORBIDDEN", "Admin access required.", 403);
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.sourcingRequest.findUnique({
      where: { id: input.requestId },
    });

    if (!request) {
      throw new AdminReviewDecisionError("NOT_FOUND", "Sourcing request not found.", 404);
    }

    const toStatus = input.data.toStatus as SourcingRequestStatus;
    assertValidTransition(request.status, toStatus);

    const updatedRequest = await tx.sourcingRequest.update({
      where: { id: request.id },
      data: {
        status: toStatus,
      },
    });

    const statusEvent = await tx.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: request.status,
        toStatus,
        actorUserId: admin.id,
        note: input.data.note ?? null,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: admin.id,
        sourcingRequestId: request.id,
        entityType: "SourcingRequest",
        entityId: request.id,
        action: "ADMIN_REVIEW_DECISION_RECORDED",
        context: {
          fromStatus: request.status,
          toStatus,
          note: input.data.note ?? null,
          statusEventId: statusEvent.id,
        },
      },
    });

    return { request: updatedRequest, statusEvent };
  });
}
