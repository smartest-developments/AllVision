import { NextResponse, type NextRequest } from "next/server";

import {
  applyAdminReviewDecision,
  adminReviewDecisionInputSchema,
  AdminReviewDecisionError,
} from "@/server/admin-review-decisions";
import { RequestAuthError, requireRequestRole } from "@/server/request-auth";
import { SourcingRequestTransitionError } from "@/server/sourcing-requests";

export async function PATCH(
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const parsed = adminReviewDecisionInputSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "Invalid admin review decision payload.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  const { requestId } = await params;

  try {
    const result = await applyAdminReviewDecision({
      requestId,
      adminUserId,
      data: parsed.data,
    });

    return NextResponse.json(
      {
        requestId: result.request.id,
        status: result.request.status,
        statusEvent: {
          id: result.statusEvent.id,
          fromStatus: result.statusEvent.fromStatus,
          toStatus: result.statusEvent.toStatus,
          note: result.statusEvent.note,
          createdAt: result.statusEvent.createdAt,
        },
      },
      { status: 200 },
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
            allowed: error.allowed,
          },
        },
        { status: 409 },
      );
    }

    if (error instanceof AdminReviewDecisionError) {
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
}
