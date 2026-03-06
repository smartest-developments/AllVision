import { NextResponse, type NextRequest } from "next/server";
import { getReportArtifactForOwner, ReportRetrievalError } from "@/server/report-retrieval";
import { getLegalCopy } from "@/legal/disclaimers";
import { RequestAuthError, requireRequestUserId } from "@/server/request-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
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
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected error." } },
      { status: 500 }
    );
  }

  try {
    const result = await getReportArtifactForOwner({
      requestId,
      userId
    });

    return NextResponse.json(
      {
        requestId: result.request.id,
        status: result.request.status,
        artifact: {
          id: result.artifact.id,
          storageKey: result.artifact.storageKey,
          checksumSha256: result.artifact.checksumSha256,
          deliveryChannel: result.artifact.deliveryChannel,
          createdAt: result.artifact.createdAt
        },
        legal
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
