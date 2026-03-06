import { NextResponse, type NextRequest } from "next/server";

import { getLegalCopy } from "@/legal/disclaimers";
import { RequestAuthError, requireRequestUserId } from "@/server/request-auth";
import { listSourcingRequestStatusesForUser } from "@/server/sourcing-request-status";

export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireRequestUserId(request);
  } catch (error) {
    if (error instanceof RequestAuthError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected error." } },
      { status: 500 }
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
