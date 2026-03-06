import { NextResponse, type NextRequest } from "next/server";

import { createGdprDeleteRequest, GdprDeleteRequestError } from "@/server/gdpr-delete-requests";
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
    const deleteRequest = await createGdprDeleteRequest(userId);
    return NextResponse.json(
      {
        request: deleteRequest,
      },
      { status: 202 },
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
