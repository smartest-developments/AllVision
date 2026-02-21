import { z } from "zod";
import { prisma } from "@/server/db";
import { assertValidTransition } from "@/server/sourcing-requests";
import { SourcingRequestStatus } from "@prisma/client";

export const reportArtifactInputSchema = z.object({
  storageKey: z.string().min(1, "storageKey is required"),
  checksumSha256: z.string().min(1).optional().nullable(),
  deliveryChannel: z.string().min(1).optional().nullable()
});

export type ReportArtifactInput = z.infer<typeof reportArtifactInputSchema>;

export class ReportArtifactError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function createReportArtifactAndMarkReady(input: {
  requestId: string;
  adminUserId: string;
  data: ReportArtifactInput;
}) {
  const admin = await prisma.user.findUnique({
    where: { id: input.adminUserId }
  });

  if (!admin || admin.role !== "ADMIN") {
    throw new ReportArtifactError("FORBIDDEN", "Admin access required.", 403);
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.sourcingRequest.findUnique({
      where: { id: input.requestId }
    });

    if (!request) {
      throw new ReportArtifactError("NOT_FOUND", "Sourcing request not found.", 404);
    }

    assertValidTransition(request.status, SourcingRequestStatus.REPORT_READY);

    const artifact = await tx.reportArtifact.create({
      data: {
        sourcingRequestId: request.id,
        createdByAdminId: admin.id,
        storageKey: input.data.storageKey,
        checksumSha256: input.data.checksumSha256 ?? null,
        deliveryChannel: input.data.deliveryChannel ?? null
      }
    });

    const updatedRequest = await tx.sourcingRequest.update({
      where: { id: request.id },
      data: {
        status: SourcingRequestStatus.REPORT_READY
      }
    });

    return { artifact, request: updatedRequest };
  });
}
