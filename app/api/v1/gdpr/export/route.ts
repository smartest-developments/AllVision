import { NextResponse, type NextRequest } from "next/server";

import { createGdprExportRequest } from "@/server/gdpr-export-requests";
import { RequestAuthError, requireRequestUserId } from "@/server/request-auth";

export async function POST(request: NextRequest) {
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
    const exportRequest = await createGdprExportRequest(userId);
    return NextResponse.json(
      {
        request: exportRequest,
      },
      { status: 202 },
    );
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected error." } },
      { status: 500 },
    );
  }
}
