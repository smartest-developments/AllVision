import { NextResponse, type NextRequest } from "next/server";

import { getLegalCopy } from "@/legal/disclaimers";
import { listSourcingRequestStatusesForUser } from "@/server/sourcing-request-status";

export async function GET(request: NextRequest) {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required." } },
      { status: 401 }
    );
  }

  const legal = getLegalCopy("request");
  const requests = await listSourcingRequestStatusesForUser(userId);

  return NextResponse.json(
    {
      requests: requests.map((entry) => ({
        requestId: entry.requestId,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        latestEventAt: entry.latestEventAt,
        timeline: entry.timeline
      })),
      legal
    },
    { status: 200 }
  );
}
