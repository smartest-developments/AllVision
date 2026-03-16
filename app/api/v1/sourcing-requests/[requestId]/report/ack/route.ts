import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";

import { acknowledgeReportDeliveryForOwner, ReportRetrievalError } from "@/server/report-retrieval";
import { RequestAuthError, requireRequestUserId } from "@/server/request-auth";

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

function resolveVisibleText(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
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
    const updated = await acknowledgeReportDeliveryForOwner({
      requestId,
      userId
    });
    const paymentState =
      updated.reportPaymentRequired && updated.status === "DELIVERED" ? "SETTLED" : "NOT_REQUIRED";
    const settlementAudit = await readSettlementAuditMetadata(updated.id);

    if (redirectTo) {
      const redirectUrl = new URL(redirectTo, request.url);
      if (settlementAudit.settledByRole) {
        redirectUrl.searchParams.set("settledByRole", settlementAudit.settledByRole);
      }
      if (settlementAudit.settledAt) {
        redirectUrl.searchParams.set("settledAt", settlementAudit.settledAt);
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
      const redirectSettlementNote = resolveVisibleText(settlementAudit.settlementNote);
      if (redirectSettlementNote) {
        redirectUrl.searchParams.set("settlementNote", redirectSettlementNote);
      }
      return NextResponse.redirect(redirectUrl, { status: 303 });
    }

    return NextResponse.json(
      {
        requestId: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt,
        reportFee: {
          required: updated.reportPaymentRequired,
          feeCents: updated.reportFeeCents,
          currency: updated.currency,
          paymentState,
          settledAt: settlementAudit.settledAt,
          settledByRole: settlementAudit.settledByRole,
          settledByUserId: settlementAudit.settledByUserId,
          settledByUserEmail: settlementAudit.settledByUserEmail,
          settlementEventId: settlementAudit.settlementEventId,
          settlementNote: settlementAudit.settlementNote,
        },
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
