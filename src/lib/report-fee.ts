export type ReportFeeSummaryInput = {
  currency: string;
  feeCents: number | null;
  pendingReason?: "PRICING_IN_PROGRESS" | null;
  checkoutInitiatedAt?: string | null;
  settledAt?: string | null;
  settledByRole?: "USER" | "ADMIN" | null;
  settledByUserId?: string | null;
  settledByUserEmail?: string | null;
  settlementEventId?: string | null;
  settlementNote?: string | null;
};

function resolveSettlementNote(note: string | null | undefined): string | null {
  if (typeof note !== "string") {
    return null;
  }

  const trimmed = note.trim();
  return trimmed === "" ? null : trimmed;
}

export function formatReportFeeSummary(reportFee: ReportFeeSummaryInput): string {
  if (reportFee.feeCents === null) {
    return `${reportFee.currency} pending pricing`;
  }

  return `${reportFee.currency} ${(reportFee.feeCents / 100).toFixed(2)}`;
}

export function formatPendingReportFeeMessage(
  reportFee: ReportFeeSummaryInput,
): string {
  if (reportFee.feeCents !== null) {
    return `Report fee pending (${formatReportFeeSummary(reportFee)}).`;
  }

  if (reportFee.pendingReason === "PRICING_IN_PROGRESS") {
    return `Report fee pending (pricing in progress; ${reportFee.currency} amount not finalized).`;
  }

  return `Report fee pending (${formatReportFeeSummary(reportFee)}).`;
}

export function resolvePendingReportFeeHintBadge(
  reportFee: ReportFeeSummaryInput,
): string | null {
  if (reportFee.pendingReason === "PRICING_IN_PROGRESS") {
    return "Pricing in progress";
  }

  return null;
}

export function formatPostCheckoutPendingConfirmation(
  reportFee: ReportFeeSummaryInput,
): string {
  if (reportFee.settledAt) {
    const settlementNote = resolveSettlementNote(reportFee.settlementNote);
    const settlementRoleSuffix =
      reportFee.settledByRole === "ADMIN"
        ? " by an admin."
        : reportFee.settledByRole === "USER"
          ? " by the account owner."
          : ".";
    const settlementActorIdSuffix = reportFee.settledByUserId
      ? ` Settlement actor id: ${reportFee.settledByUserId}.`
      : "";
    const settlementActorEmailSuffix = reportFee.settledByUserEmail
      ? ` Settlement actor email: ${reportFee.settledByUserEmail}.`
      : "";
    const evidenceTokenSuffix = reportFee.settlementEventId
      ? ` Settlement evidence token: ${reportFee.settlementEventId}.`
      : "";
    const settlementNoteSuffix = settlementNote
      ? ` Settlement note: ${settlementNote}.`
      : "";
    return `Checkout already settled at ${reportFee.settledAt}${settlementRoleSuffix}${settlementActorIdSuffix}${settlementActorEmailSuffix}${evidenceTokenSuffix}${settlementNoteSuffix}`;
  }

  const baseCopy =
    reportFee.pendingReason === "PRICING_IN_PROGRESS"
      ? "Checkout started. Pricing is still in progress; we'll show the final fee as soon as it is finalized."
      : "Checkout started. Report-fee payment remains pending.";

  if (!reportFee.checkoutInitiatedAt) {
    return baseCopy;
  }

  return `${baseCopy} Checkout initiated at ${reportFee.checkoutInitiatedAt}.`;
}

export function formatPostDeliveryAcknowledgmentConfirmation(
  reportFee: ReportFeeSummaryInput,
): string {
  if (reportFee.settledAt) {
    const settlementNote = resolveSettlementNote(reportFee.settlementNote);
    const settlementRoleSuffix =
      reportFee.settledByRole === "ADMIN"
        ? " by an admin."
        : reportFee.settledByRole === "USER"
          ? " by the account owner."
          : ".";
    const settlementActorEmailSuffix = reportFee.settledByUserEmail
      ? ` Settlement actor email: ${reportFee.settledByUserEmail}.`
      : "";
    const settlementActorIdSuffix = reportFee.settledByUserId
      ? ` Settlement actor id: ${reportFee.settledByUserId}.`
      : "";
    const evidenceTokenSuffix = reportFee.settlementEventId
      ? ` Settlement evidence token: ${reportFee.settlementEventId}.`
      : "";
    const settlementNoteSuffix = settlementNote
      ? ` Settlement note: ${settlementNote}.`
      : "";
    return `Delivery acknowledgment recorded. Settlement was completed at ${reportFee.settledAt}${settlementRoleSuffix}${settlementActorIdSuffix}${settlementActorEmailSuffix}${evidenceTokenSuffix}${settlementNoteSuffix}`;
  }

  return "Delivery acknowledgment recorded.";
}

export function formatReportFeeReadinessContext(
  reportFee: ReportFeeSummaryInput,
): string | null {
  if (reportFee.settledAt) {
    const settlementNote = resolveSettlementNote(reportFee.settlementNote);
    const settlementNoteSuffix = settlementNote
      ? ` Settlement note: ${settlementNote}.`
      : "";
    const settlementActorIdSuffix = reportFee.settledByUserId
      ? ` Settlement actor id: ${reportFee.settledByUserId}.`
      : "";
    const settlementActorEmailSuffix = reportFee.settledByUserEmail
      ? ` Settlement actor email: ${reportFee.settledByUserEmail}.`
      : "";
    const evidenceTokenSuffix = reportFee.settlementEventId
      ? ` Settlement evidence token: ${reportFee.settlementEventId}.`
      : "";
    if (reportFee.settledByRole === "ADMIN") {
      return `Report-fee settlement was recorded at ${reportFee.settledAt} by an admin.${settlementNoteSuffix}${settlementActorIdSuffix}${settlementActorEmailSuffix}${evidenceTokenSuffix}`;
    }

    if (reportFee.settledByRole === "USER") {
      return `Report-fee settlement was recorded at ${reportFee.settledAt} by the account owner.${settlementNoteSuffix}${settlementActorIdSuffix}${settlementActorEmailSuffix}${evidenceTokenSuffix}`;
    }

    return `Report-fee settlement was recorded at ${reportFee.settledAt}.${settlementNoteSuffix}${settlementActorIdSuffix}${settlementActorEmailSuffix}${evidenceTokenSuffix}`;
  }

  if (!reportFee.checkoutInitiatedAt) {
    return null;
  }

  return `Report-fee checkout was initiated at ${reportFee.checkoutInitiatedAt}.`;
}
