import { z } from "zod";
import { SourcingRequestStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { assertValidTransition } from "@/server/sourcing-requests";

const reviewDecisionStatusSchema = z.enum([SourcingRequestStatus.IN_REVIEW]);

export const adminReviewDecisionInputSchema = z.object({
  toStatus: reviewDecisionStatusSchema,
  note: z.string().trim().max(500).optional().nullable(),
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

    assertValidTransition(request.status, input.data.toStatus);

    const note = input.data.note?.trim() || "Admin review decision recorded.";

    const updatedRequest = await tx.sourcingRequest.update({
      where: { id: request.id },
      data: { status: input.data.toStatus },
    });

    await tx.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: request.id,
        fromStatus: request.status,
        toStatus: input.data.toStatus,
        actorUserId: admin.id,
        note,
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
          toStatus: input.data.toStatus,
          note,
        },
      },
    });

    return updatedRequest;
  });
}
