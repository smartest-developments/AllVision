import { SourcingRequestStatus } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/server/db";

const adminQueueStatusSchema = z.enum([
  "SUBMITTED",
  "IN_REVIEW",
  "PAYMENT_SETTLED",
  "DELIVERED",
]);

export const adminQueueFiltersSchema = z.object({
  status: adminQueueStatusSchema.optional(),
  countryCode: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, "countryCode must be a 2-letter ISO code."))
    .optional(),
  userEmail: z.string().email().optional()
});

export type AdminQueueFilters = z.infer<typeof adminQueueFiltersSchema>;

export const ADMIN_QUEUE_FILTER_GROUPS = [
  {
    key: "TRIAGE" as const,
    displayOrder: 10,
    label: "Triage queue",
    description: "Submitted and in-review requests awaiting admin triage decisions.",
    statuses: [SourcingRequestStatus.SUBMITTED, SourcingRequestStatus.IN_REVIEW],
  },
  {
    key: "SETTLED" as const,
    displayOrder: 20,
    label: "Settlement evidence queue",
    description: "Settled and delivered requests with payment-settlement evidence attached.",
    statuses: [SourcingRequestStatus.PAYMENT_SETTLED, SourcingRequestStatus.DELIVERED],
  },
];

export const ADMIN_QUEUE_STATUS_METADATA = {
  SUBMITTED: { label: "Submitted" },
  IN_REVIEW: { label: "In review" },
  PAYMENT_SETTLED: { label: "Payment settled" },
  DELIVERED: { label: "Delivered" },
} as const;

export const ADMIN_QUEUE_DEFAULT_FILTER_GROUP_KEY = "TRIAGE" as const;

export async function listAdminSourcingRequests(filters: AdminQueueFilters) {
  const statuses: SourcingRequestStatus[] = filters.status
    ? [filters.status]
    : [SourcingRequestStatus.SUBMITTED, SourcingRequestStatus.IN_REVIEW];

  return prisma.sourcingRequest.findMany({
    where: {
      status: { in: statuses },
      ...(filters.countryCode ? { prescription: { countryCode: filters.countryCode } } : {}),
      ...(filters.userEmail ? { user: { email: filters.userEmail } } : {})
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      user: {
        select: {
          email: true
        }
      },
      prescription: {
        select: {
          countryCode: true
        }
      },
      statusEvents: {
        orderBy: { createdAt: "desc" }
      },
    }
  });
}

export async function getAdminSourcingRequestDetail(requestId: string) {
  return prisma.sourcingRequest.findUnique({
    where: { id: requestId },
    include: {
      user: {
        select: {
          email: true
        }
      },
      prescription: {
        select: {
          countryCode: true,
          createdAt: true
        }
      },
      statusEvents: {
        orderBy: { createdAt: "desc" }
      },
      reportArtifacts: {
        orderBy: { createdAt: "desc" }
      }
    }
  });
}

export async function listAdminThroughputRequests(filters: {
  countryCode?: string;
  userEmail?: string;
}) {
  return prisma.sourcingRequest.findMany({
    where: {
      status: { in: [SourcingRequestStatus.REPORT_READY, SourcingRequestStatus.DELIVERED] },
      ...(filters.countryCode
        ? { prescription: { countryCode: filters.countryCode.toUpperCase() } }
        : {}),
      ...(filters.userEmail ? { user: { email: filters.userEmail } } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      statusEvents: {
        orderBy: { createdAt: "asc" },
      },
      reportArtifacts: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
}
