import { NextResponse, type NextRequest } from "next/server";

import { acknowledgeReportDeliveryForOwner, ReportRetrievalError } from "@/server/report-retrieval";
import { RequestAuthError, requireRequestUserId } from "@/server/request-auth";

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

  try {
    const updated = await acknowledgeReportDeliveryForOwner({
      requestId,
      userId
    });

    return NextResponse.json(
      {
        requestId: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt
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
