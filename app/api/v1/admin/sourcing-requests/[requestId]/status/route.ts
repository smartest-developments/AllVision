import { NextResponse, type NextRequest } from "next/server";

import {
  applyAdminReviewDecision,
  adminReviewDecisionInputSchema,
  AdminReviewDecisionError,
} from "@/server/admin-review-decisions";
import { RequestAuthError, requireRequestRole } from "@/server/request-auth";
import { SourcingRequestTransitionError } from "@/server/sourcing-requests";

type RouteContext = { params: Promise<{ requestId: string }> };

function buildUnexpectedErrorResponse() {
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Unexpected error." } },
    { status: 500 },
  );
}

function sanitizeAdminRedirectPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("/admin/sourcing-requests")) {
    return null;
  }

  return trimmed;
}

async function requireAdminUserId(request: NextRequest): Promise<string | NextResponse> {
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

    return buildUnexpectedErrorResponse();
  }

  return adminUserId;
}

async function applyDecision(
  request: NextRequest,
  params: Promise<{ requestId: string }>,
  payload: unknown,
  redirectTo?: string | null,
) {
  const adminUserId = await requireAdminUserId(request);
  if (adminUserId instanceof NextResponse) {
    return adminUserId;
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

    if (redirectTo) {
      const redirectUrl = new URL(redirectTo, request.url);
      return NextResponse.redirect(redirectUrl, { status: 303 });
    }

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
      if (redirectTo) {
        const redirectUrl = new URL(redirectTo, request.url);
        return NextResponse.redirect(redirectUrl, { status: 303 });
      }

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

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  return applyDecision(request, params, payload);
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_FORM", message: "Request body must be valid form data." } },
      { status: 400 },
    );
  }

  const redirectTo = sanitizeAdminRedirectPath(formData.get("redirectTo"));
  const payload = {
    toStatus: formData.get("toStatus"),
    note: formData.get("note"),
  };

  return applyDecision(request, params, payload, redirectTo);
}
