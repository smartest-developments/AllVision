import { NextResponse, type NextRequest } from "next/server";

import { RequestAuthError, requireRequestRole } from "@/server/request-auth";
import {
  reportTemplateDraftInputSchema,
  ReportTemplateDraftError,
  saveAdminReportTemplateDraft,
} from "@/server/report-template-drafts";

type RouteContext = { params: Promise<{ requestId: string }> };

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

export async function POST(request: NextRequest, { params }: RouteContext) {
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_FORM", message: "Request body must be valid form data." } },
      { status: 400 },
    );
  }

  const parsed = reportTemplateDraftInputSchema.safeParse({
    templateId: formData.get("templateId"),
    templateBody: formData.get("templateBody"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "Invalid template draft payload.",
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
  const redirectTo = sanitizeAdminRedirectPath(formData.get("redirectTo"));

  try {
    const savedDraft = await saveAdminReportTemplateDraft({
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
        requestId,
        templateId: savedDraft.templateId,
        savedAt: savedDraft.savedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ReportTemplateDraftError) {
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
