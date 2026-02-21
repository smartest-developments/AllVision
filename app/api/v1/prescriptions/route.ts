import { NextResponse, type NextRequest } from "next/server";
import { createPrescription, PrescriptionIntakeError } from "@/server/prescriptions";

export async function POST(request: NextRequest) {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required." } },
      { status: 401 }
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
        countryCode: record.countryCode
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
