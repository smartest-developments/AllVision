import { prisma } from "@/server/db";

export type GdprExportRequestRecord = {
  requestId: string;
  status: "QUEUED";
  requestedAt: string;
};

export async function createGdprExportRequest(userId: string): Promise<GdprExportRequestRecord> {
  const event = await prisma.auditEvent.create({
    data: {
      actorUserId: userId,
      entityType: "User",
      entityId: userId,
      action: "GDPR_EXPORT_REQUESTED",
      context: {
        status: "QUEUED",
      },
    },
  });

  return {
    requestId: event.id,
    status: "QUEUED",
    requestedAt: event.createdAt.toISOString(),
  };
}
