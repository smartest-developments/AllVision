import { NextResponse, type NextRequest } from "next/server";

import {
  adminQueueFiltersSchema,
  listAdminSourcingRequests,
} from "@/server/admin-sourcing-queue";
import { RequestAuthError, requireRequestRole } from "@/server/request-auth";

export async function GET(request: NextRequest) {
  try {
    await requireRequestRole(request, "ADMIN");
  } catch (error) {
    if (error instanceof RequestAuthError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected error." } },
      { status: 500 },
    );
  }

  const parsedFilters = adminQueueFiltersSchema.safeParse({
    status: request.nextUrl.searchParams.get("status") ?? undefined,
    countryCode: request.nextUrl.searchParams.get("countryCode") ?? undefined,
    userEmail: request.nextUrl.searchParams.get("userEmail") ?? undefined,
  });

  if (!parsedFilters.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_QUERY",
          message: "Invalid admin queue query parameters.",
          issues: parsedFilters.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  const requests = await listAdminSourcingRequests(parsedFilters.data);

  return NextResponse.json(
    {
      requests: requests.map((entry) => {
        const settlementEvent = entry.statusEvents.find(
          (event) => event.toStatus === "PAYMENT_SETTLED",
        );
        const shouldExposeSettlement =
          entry.status === "PAYMENT_SETTLED" || entry.status === "DELIVERED";

        return {
        requestId: entry.id,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        userEmail: entry.user.email,
        countryCode: entry.prescription.countryCode,
        latestEventAt: entry.statusEvents[0]?.createdAt ?? null,
        settlement: shouldExposeSettlement
          ? {
              settledByUserId: settlementEvent?.actorUserId ?? null,
              settledAt: settlementEvent?.createdAt ?? null,
            }
          : {
              settledByUserId: null,
              settledAt: null,
            },
        };
      }),
    },
    { status: 200 },
  );
}
