import { prisma } from "@/server/db";

export type GdprRequestHistoryItem = {
  requestId: string;
  action: "GDPR_EXPORT_REQUESTED" | "GDPR_DELETE_REQUESTED" | "GDPR_DELETE_COMPLETED";
  status: string;
  createdAt: string;
};

function coerceStatus(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  return "UNKNOWN";
}

export async function listGdprRequestHistoryForUser(userId: string): Promise<GdprRequestHistoryItem[]> {
  const events = await prisma.auditEvent.findMany({
    where: {
      action: {
        in: ["GDPR_EXPORT_REQUESTED", "GDPR_DELETE_REQUESTED", "GDPR_DELETE_COMPLETED"],
      },
      OR: [{ actorUserId: userId }, { entityId: userId }],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return events.map((event) => {
    const context =
      typeof event.context === "object" && event.context !== null
        ? (event.context as Record<string, unknown>)
        : null;

    return {
      requestId: event.id,
      action: event.action as GdprRequestHistoryItem["action"],
      status: coerceStatus(context?.status),
      createdAt: event.createdAt.toISOString(),
    };
  });
}
