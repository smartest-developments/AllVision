import { NextResponse, type NextRequest } from "next/server";
import {
  getReportArtifactForOwner,
  ReportRetrievalError,
} from "@/server/report-retrieval";
import { getLegalCopy } from "@/legal/disclaimers";
import { RequestAuthError, requireRequestUserId } from "@/server/request-auth";

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

    return NextResponse.json(
      {
        requestId: result.request.id,
        status: result.request.status,
        reportFee: {
          product: "REPORT_SERVICE",
          required: result.request.reportPaymentRequired,
          feeCents: result.request.reportFeeCents,
          currency: result.request.currency,
          paymentState: resolveReportFeePaymentState(
            result.request.reportPaymentRequired,
            result.request.status,
          ),
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
