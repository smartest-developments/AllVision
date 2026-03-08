import { NextResponse, type NextRequest } from "next/server";

import {
  ReportRetrievalError,
  settleReportFeeForRequest
} from "@/server/report-retrieval";
import { RequestAuthError, requireRequestRole } from "@/server/request-auth";

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

  try {
    const updated = await settleReportFeeForRequest({
      requestId,
      actorUserId: adminUserId
    });

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
