import { NextResponse, type NextRequest } from "next/server";

import { getAdminSourcingRequestDetail } from "@/server/admin-sourcing-queue";
import { RequestAuthError, requireRequestRole } from "@/server/request-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
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

  const { requestId } = await params;
  const detail = await getAdminSourcingRequestDetail(requestId);

  if (!detail) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Sourcing request not found." } },
      { status: 404 },
    );
  }

  const settlementEvent = detail.statusEvents.find(
    (event) => event.toStatus === "PAYMENT_SETTLED",
  );

  return NextResponse.json(
    {
      request: {
        requestId: detail.id,
        status: detail.status,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        userEmail: detail.user.email,
        countryCode: detail.prescription.countryCode,
        prescriptionCreatedAt: detail.prescription.createdAt,
        settlement: {
          settledByUserId: settlementEvent?.actorUserId ?? null,
          settledAt: settlementEvent?.createdAt ?? null,
        },
      },
      timeline: detail.statusEvents.map((event) => ({
        id: event.id,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        note: event.note,
        createdAt: event.createdAt,
      })),
      reportArtifacts: detail.reportArtifacts.map((artifact) => ({
        id: artifact.id,
        storageKey: artifact.storageKey,
        checksumSha256: artifact.checksumSha256,
        deliveryChannel: artifact.deliveryChannel,
        deliveredAt: artifact.deliveredAt,
        createdAt: artifact.createdAt,
      })),
    },
    { status: 200 },
  );
}
