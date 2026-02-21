import { SourcingRequestStatus } from "@prisma/client";

export class SourcingRequestTransitionError extends Error {
  code: string;
  fromStatus: SourcingRequestStatus;
  toStatus: SourcingRequestStatus;
  allowed: SourcingRequestStatus[];

  constructor(params: {
    fromStatus: SourcingRequestStatus;
    toStatus: SourcingRequestStatus;
    allowed: SourcingRequestStatus[];
  }) {
    super(`Invalid sourcing request transition: ${params.fromStatus} -> ${params.toStatus}`);
    this.code = "INVALID_STATUS_TRANSITION";
    this.fromStatus = params.fromStatus;
    this.toStatus = params.toStatus;
    this.allowed = params.allowed;
  }
}

const transitionMatrix: Record<SourcingRequestStatus, SourcingRequestStatus[]> = {
  [SourcingRequestStatus.SUBMITTED]: [SourcingRequestStatus.IN_REVIEW],
  [SourcingRequestStatus.IN_REVIEW]: [SourcingRequestStatus.REPORT_READY],
  [SourcingRequestStatus.REPORT_READY]: [],
  [SourcingRequestStatus.DELIVERED]: [],
  [SourcingRequestStatus.PAYMENT_PENDING]: [],
  [SourcingRequestStatus.PAYMENT_SETTLED]: [],
  [SourcingRequestStatus.CANCELLED]: []
};

export function getAllowedTransitions(status: SourcingRequestStatus): SourcingRequestStatus[] {
  return transitionMatrix[status] ?? [];
}

export function canTransition(
  fromStatus: SourcingRequestStatus,
  toStatus: SourcingRequestStatus
): boolean {
  if (fromStatus === toStatus) {
    return false;
  }
  return getAllowedTransitions(fromStatus).includes(toStatus);
}

export function assertValidTransition(
  fromStatus: SourcingRequestStatus,
  toStatus: SourcingRequestStatus
): void {
  const allowed = getAllowedTransitions(fromStatus);
  if (!canTransition(fromStatus, toStatus)) {
    throw new SourcingRequestTransitionError({ fromStatus, toStatus, allowed });
  }
}
