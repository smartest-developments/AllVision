export type ReportFeeSummaryInput = {
  currency: string;
  feeCents: number | null;
};

export function formatReportFeeSummary(reportFee: ReportFeeSummaryInput): string {
  if (reportFee.feeCents === null) {
    return `${reportFee.currency} pending pricing`;
  }

  return `${reportFee.currency} ${(reportFee.feeCents / 100).toFixed(2)}`;
}
