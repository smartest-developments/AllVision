import { NextResponse, type NextRequest } from "next/server";
import {
  ReportRetrievalError,
  startReportFeeCheckoutForOwner
} from "@/server/report-retrieval";
import { RequestAuthError, requireRequestUserId } from "@/server/request-auth";
import { prisma } from "@/server/db";

type RouteContext = { params: Promise<{ requestId: string }> };
type ReportFeePendingReason = "PRICING_IN_PROGRESS";

function sanitizeUserRedirectPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  if (trimmed.startsWith("//")) {
    return null;
  }

  return trimmed;
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

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { requestId } = await params;
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

  let redirectTo: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    try {
      const formData = await request.formData();
      redirectTo = sanitizeUserRedirectPath(formData.get("redirectTo"));
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_FORM", message: "Request body must be valid form data." } },
        { status: 400 }
      );
    }
  }

  try {
    const updated = await startReportFeeCheckoutForOwner({
      requestId,
      userId
    });
    const paymentState = updated.status === "PAYMENT_PENDING" ? "PENDING" : "SETTLED";
    const pendingReason: ReportFeePendingReason | null =
      paymentState === "PENDING" && updated.reportFeeCents === null
        ? "PRICING_IN_PROGRESS"
        : null;
    const checkoutInitiatedAt = await readCheckoutInitiatedAt(updated.id);
    const settlementAudit = await readSettlementAuditMetadata(updated.id);

    if (redirectTo) {
      const redirectUrl = new URL(redirectTo, request.url);
      if (settlementAudit.settledAt) {
        redirectUrl.searchParams.set("settledAt", settlementAudit.settledAt);
      }
      if (settlementAudit.settledByRole) {
        redirectUrl.searchParams.set("settledByRole", settlementAudit.settledByRole);
      }
      if (settlementAudit.settledByUserId) {
        redirectUrl.searchParams.set("settledByUserId", settlementAudit.settledByUserId);
      }
      if (settlementAudit.settledByUserEmail) {
        redirectUrl.searchParams.set("settledByUserEmail", settlementAudit.settledByUserEmail);
      }
      if (settlementAudit.settlementEventId) {
        redirectUrl.searchParams.set("settlementEventId", settlementAudit.settlementEventId);
      }
      if (settlementAudit.settlementNote) {
        redirectUrl.searchParams.set("settlementNote", settlementAudit.settlementNote);
      }
      return NextResponse.redirect(redirectUrl, { status: 303 });
    }

    return NextResponse.json(
      {
        requestId: updated.id,
        status: updated.status,
        reportFee: {
          required: updated.reportPaymentRequired,
          feeCents: updated.reportFeeCents,
          currency: updated.currency,
          paymentState,
          pendingReason,
          checkoutInitiatedAt,
          settledAt: settlementAudit.settledAt,
          settledByRole: settlementAudit.settledByRole,
          settledByUserId: settlementAudit.settledByUserId,
          settledByUserEmail: settlementAudit.settledByUserEmail,
          settlementEventId: settlementAudit.settlementEventId,
          settlementNote: settlementAudit.settlementNote,
        }
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ReportRetrievalError) {
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
}
