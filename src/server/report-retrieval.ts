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
