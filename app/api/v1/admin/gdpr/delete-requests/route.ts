import { NextResponse, type NextRequest } from "next/server";

import { listPendingGdprDeleteRequests } from "@/server/gdpr-delete-requests";
import { RequestAuthError, requireRequestRole } from "@/server/request-auth";

export async function GET(request: NextRequest) {
  try {
    await requireRequestRole(request, "ADMIN");
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
    const requests = await listPendingGdprDeleteRequests();
    return NextResponse.json({ requests }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected error." } },
      { status: 500 },
    );
  }
}
