import { z } from "zod";

import { prisma } from "@/server/db";

const REPORT_TEMPLATE_DRAFT_ACTION = "ADMIN_REPORT_TEMPLATE_DRAFT_SAVED";
const LEGACY_REPORT_TEMPLATE_DRAFT_ACTION = "REPORT_TEMPLATE_DRAFT_SAVED";

const templateIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9_]+$/);

const templateBodySchema = z.string().trim().min(1).max(8000);

export const reportTemplateDraftInputSchema = z.object({
  templateId: templateIdSchema,
  templateBody: templateBodySchema,
});

export type ReportTemplateDraftInput = z.infer<typeof reportTemplateDraftInputSchema>;

export class ReportTemplateDraftError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function saveAdminReportTemplateDraft(input: {
  requestId: string;
  adminUserId: string;
  data: ReportTemplateDraftInput;
}) {
  const request = await prisma.sourcingRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true },
  });

  if (!request) {
    throw new ReportTemplateDraftError(404, "NOT_FOUND", "Sourcing request not found.");
  }

  const auditEvent = await prisma.auditEvent.create({
    data: {
      actorUserId: input.adminUserId,
      sourcingRequestId: input.requestId,
      entityType: "SourcingRequest",
      entityId: input.requestId,
      action: REPORT_TEMPLATE_DRAFT_ACTION,
      context: {
        templateId: input.data.templateId,
        templateBody: input.data.templateBody,
      },
    },
  });

  return {
    requestId: request.id,
    templateId: input.data.templateId,
    templateBody: input.data.templateBody,
    savedAt: auditEvent.createdAt,
  };
}

export async function listAdminReportTemplateDrafts(requestId: string): Promise<
  Record<
    string,
    {
      templateId: string;
      templateBody: string;
      savedAt: Date;
    }
  >
> {
  const events = await prisma.auditEvent.findMany({
    where: {
      sourcingRequestId: requestId,
      action: {
        in: [REPORT_TEMPLATE_DRAFT_ACTION, LEGACY_REPORT_TEMPLATE_DRAFT_ACTION],
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      context: true,
    },
  });

  const draftsByTemplate: Record<
    string,
    {
      templateId: string;
      templateBody: string;
      savedAt: Date;
    }
  > = {};

  for (const event of events) {
    if (typeof event.context !== "object" || event.context === null) {
      continue;
    }

    const parsed = reportTemplateDraftInputSchema.safeParse(event.context);
    if (!parsed.success) {
      continue;
    }

    if (draftsByTemplate[parsed.data.templateId]) {
      continue;
    }

    draftsByTemplate[parsed.data.templateId] = {
      templateId: parsed.data.templateId,
      templateBody: parsed.data.templateBody,
      savedAt: event.createdAt,
    };
  }

  return draftsByTemplate;
}

export async function getLatestAdminReportTemplateDraft(requestId: string): Promise<{
  templateId: string;
  templateBody: string;
  savedAt: string;
} | null> {
  const draftsByTemplate = await listAdminReportTemplateDrafts(requestId);
  const latestDraft = Object.values(draftsByTemplate).sort(
    (left, right) => right.savedAt.getTime() - left.savedAt.getTime(),
  )[0];

  if (!latestDraft) {
    return null;
  }

  return {
    templateId: latestDraft.templateId,
    templateBody: latestDraft.templateBody,
    savedAt: latestDraft.savedAt.toISOString(),
  };
}
