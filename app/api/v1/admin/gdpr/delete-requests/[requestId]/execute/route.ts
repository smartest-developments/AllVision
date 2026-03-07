import { NextResponse, type NextRequest } from "next/server";

import { executeGdprDeleteRequest, GdprDeleteRequestError } from "@/server/gdpr-delete-requests";
import { RequestAuthError, requireRequestRole } from "@/server/request-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  let adminUserId: string;

  try {
    adminUserId = await requireRequestRole(request, "ADMIN");
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

  const { requestId } = await params;

  try {
    const result = await executeGdprDeleteRequest({
      requestId,
      adminUserId,
    });

    return NextResponse.json(
      {
        request: result,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof GdprDeleteRequestError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected error." } },
      { status: 500 },
    );
  }
}
