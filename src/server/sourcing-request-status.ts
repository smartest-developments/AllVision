import { prisma } from "@/server/db";

export type UserSourcingRequestStatus = {
  requestId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  latestEventAt: Date | null;
  timeline: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    createdAt: Date;
  }>;
};

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
    timeline: request.statusEvents.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt,
    })),
  }));
}
