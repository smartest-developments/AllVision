import { NextResponse, type NextRequest } from "next/server";
import { getReportArtifactForOwner, ReportRetrievalError } from "@/server/report-retrieval";
import { getLegalCopy } from "@/legal/disclaimers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const legal = getLegalCopy("report_delivery");
  const { requestId } = await params;
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required." } },
      { status: 401 }
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
