import { SourcingRequestStatus } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/server/db";

const adminQueueStatusSchema = z.enum(["SUBMITTED", "IN_REVIEW"]);

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
        orderBy: { createdAt: "desc" },
        take: 1
      }
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
