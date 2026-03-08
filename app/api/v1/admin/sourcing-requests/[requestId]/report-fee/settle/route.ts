import { NextResponse, type NextRequest } from "next/server";

import {
  ReportRetrievalError,
  settleReportFeeForRequest
} from "@/server/report-retrieval";
import { RequestAuthError, requireRequestRole } from "@/server/request-auth";

function sanitizeAdminRedirectPath(value: unknown): string | null {
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
  if (!trimmed.startsWith("/admin/sourcing-requests")) {
    return null;
  }

  return trimmed;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;

  let adminUserId: string;
  try {
    adminUserId = await requireRequestRole(request, "ADMIN");
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
      redirectTo = sanitizeAdminRedirectPath(formData.get("redirectTo"));
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_FORM", message: "Request body must be valid form data." } },
        { status: 400 }
      );
    }
  }

  try {
    const updated = await settleReportFeeForRequest({
      requestId,
      actorUserId: adminUserId
    });

    if (redirectTo) {
      const redirectUrl = new URL(redirectTo, request.url);
      redirectUrl.searchParams.set("settled", "1");
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
          paymentState: updated.status === "PAYMENT_PENDING" ? "PENDING" : "SETTLED"
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
