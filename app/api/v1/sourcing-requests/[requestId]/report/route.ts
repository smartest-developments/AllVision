import { NextResponse, type NextRequest } from "next/server";
import {
  getReportArtifactForOwner,
  ReportRetrievalError,
} from "@/server/report-retrieval";
import { getLegalCopy } from "@/legal/disclaimers";
import { RequestAuthError, requireRequestUserId } from "@/server/request-auth";
import { prisma } from "@/server/db";

function resolveReportFeePaymentState(
  reportPaymentRequired: boolean,
  status: string,
): "NOT_REQUIRED" | "PENDING" | "SETTLED" {
  if (!reportPaymentRequired) {
    return "NOT_REQUIRED";
  }

  if (status === "PAYMENT_SETTLED" || status === "DELIVERED") {
    return "SETTLED";
  }

  return "PENDING";
}

function resolveReportFeePendingReason(
  required: boolean,
  paymentState: "NOT_REQUIRED" | "PENDING" | "SETTLED",
  feeCents: number | null,
): "PRICING_IN_PROGRESS" | null {
  if (!required || paymentState !== "PENDING" || feeCents !== null) {
    return null;
  }

  return "PRICING_IN_PROGRESS";
}

async function readCheckoutInitiatedAt(requestId: string): Promise<string | null> {
  const checkoutEvent = await prisma.sourcingStatusEvent.findFirst({
    where: {
      sourcingRequestId: requestId,
      toStatus: "PAYMENT_PENDING",
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  return checkoutEvent?.createdAt.toISOString() ?? null;
}

async function readSettlementAuditMetadata(requestId: string): Promise<{
  settledAt: string | null;
  settledByRole: "USER" | "ADMIN" | null;
  settledByUserId: string | null;
  settledByUserEmail: string | null;
  settlementEventId: string | null;
  settlementNote: string | null;
}> {
  const settlementEvent = await prisma.sourcingStatusEvent.findFirst({
    where: {
      sourcingRequestId: requestId,
      toStatus: "PAYMENT_SETTLED",
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      actor: {
        select: {
          id: true,
          role: true,
          email: true,
        },
      },
      note: true,
    },
  });

  return {
    settledAt: settlementEvent?.createdAt.toISOString() ?? null,
    settledByRole: settlementEvent?.actor?.role ?? null,
    settledByUserId: settlementEvent?.actor?.id ?? null,
    settledByUserEmail: settlementEvent?.actor?.email ?? null,
    settlementEventId: settlementEvent?.id ?? null,
    settlementNote: settlementEvent?.note ?? null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const legal = getLegalCopy("report_delivery");
  const { requestId } = await params;
  let userId: string;
  try {
    userId = await requireRequestUserId(request);
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

  try {
    const result = await getReportArtifactForOwner({
      requestId,
      userId,
    });
    const reportFeePaymentState = resolveReportFeePaymentState(
      result.request.reportPaymentRequired,
      result.request.status,
    );
    const checkoutInitiatedAt = await readCheckoutInitiatedAt(result.request.id);
    const settlementAudit = await readSettlementAuditMetadata(result.request.id);

    return NextResponse.json(
      {
        requestId: result.request.id,
        status: result.request.status,
        reportFee: {
          product: "REPORT_SERVICE",
          required: result.request.reportPaymentRequired,
          feeCents: result.request.reportFeeCents,
          currency: result.request.currency,
          paymentState: reportFeePaymentState,
          pendingReason: resolveReportFeePendingReason(
            result.request.reportPaymentRequired,
            reportFeePaymentState,
            result.request.reportFeeCents,
          ),
          checkoutInitiatedAt,
          settledAt: settlementAudit.settledAt,
          settledByRole: settlementAudit.settledByRole,
          settledByUserId: settlementAudit.settledByUserId,
          settledByUserEmail: settlementAudit.settledByUserEmail,
          settlementEventId: settlementAudit.settlementEventId,
          settlementNote: settlementAudit.settlementNote,
        },
        artifact: {
          id: result.artifact.id,
          storageKey: result.artifact.storageKey,
          checksumSha256: result.artifact.checksumSha256,
          deliveryChannel: result.artifact.deliveryChannel,
          createdAt: result.artifact.createdAt,
        },
        legal,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ReportRetrievalError) {
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
}
