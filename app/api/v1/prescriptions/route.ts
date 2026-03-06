import { NextResponse, type NextRequest } from "next/server";
import { createPrescription, PrescriptionIntakeError } from "@/server/prescriptions";
import { getLegalCopy } from "@/legal/disclaimers";
import { RequestAuthError, requireRequestUserId } from "@/server/request-auth";

export async function POST(request: NextRequest) {
  const legal = getLegalCopy("intake");
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } },
      { status: 400 }
    );
  }

  try {
    const record = await createPrescription({
      userId,
      payload
    });

    return NextResponse.json(
      {
        id: record.id,
        createdAt: record.createdAt,
        countryCode: record.countryCode,
        legal
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof PrescriptionIntakeError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            issues: error.issues ?? []
          }
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected error." } },
      { status: 500 }
    );
  }
}
