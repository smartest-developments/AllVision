import { NextResponse, type NextRequest } from "next/server";
import { RequestAuthError, requireRequestIdentity } from "@/server/request-auth";
import {
  getPrescriptionForViewer,
  PrescriptionAccessError
} from "@/server/prescriptions";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ prescriptionId: string }> }
) {
  const { prescriptionId } = await params;
  let identity: { userId: string; role: "USER" | "ADMIN" };
  try {
    identity = await requireRequestIdentity(request);
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
    const prescription = await getPrescriptionForViewer({
      prescriptionId,
      viewerUserId: identity.userId,
      viewerRole: identity.role
    });

    return NextResponse.json(
      {
        id: prescription.id,
        userId: prescription.userId,
        countryCode: prescription.countryCode,
        payload: prescription.payload,
        consentVersion: prescription.consentVersion,
        createdAt: prescription.createdAt,
        updatedAt: prescription.updatedAt
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof PrescriptionAccessError) {
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
