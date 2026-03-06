import { NextResponse, type NextRequest } from "next/server";
import {
  createReportArtifactAndMarkReady,
  reportArtifactInputSchema,
  ReportArtifactError
} from "@/server/report-artifacts";
import { RequestAuthError, requireRequestRole } from "@/server/request-auth";
import { SourcingRequestTransitionError } from "@/server/sourcing-requests";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;

  let userId: string;
  try {
    userId = await requireRequestRole(request, "ADMIN");
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } },
      { status: 400 }
    );
  }

  const parsed = reportArtifactInputSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "Invalid report artifact payload.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        }
      },
      { status: 400 }
    );
  }

  try {
    const result = await createReportArtifactAndMarkReady({
      requestId,
      adminUserId: userId,
      data: parsed.data
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
        }
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof SourcingRequestTransitionError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            fromStatus: error.fromStatus,
            toStatus: error.toStatus,
            allowed: error.allowed
          }
        },
        { status: 409 }
      );
    }

    if (error instanceof ReportArtifactError) {
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
