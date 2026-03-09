export type QueueStatus = "SUBMITTED" | "IN_REVIEW" | "PAYMENT_SETTLED" | "DELIVERED";
export type QueueFilterGroupKey = "TRIAGE" | "SETTLED";

export type QueueFilterGroup = {
  key: QueueFilterGroupKey;
  displayOrder?: number;
  label?: string;
  description?: string;
  statuses: QueueStatus[];
};

export type QueueStatusMetadata = Record<QueueStatus, { label: string }>;

export function getDefaultFilterGroups(): QueueFilterGroup[] {
  return [
    {
      key: "TRIAGE",
      displayOrder: 10,
      label: "Triage queue",
      description: "Submitted and in-review requests awaiting admin triage decisions.",
      statuses: ["SUBMITTED", "IN_REVIEW"],
    },
    {
      key: "SETTLED",
      displayOrder: 20,
      label: "Settlement evidence queue",
      description: "Settled and delivered requests with payment-settlement evidence attached.",
      statuses: ["PAYMENT_SETTLED", "DELIVERED"],
    },
  ];
}

export function getDefaultStatusMetadata(): QueueStatusMetadata {
  return {
    SUBMITTED: { label: "Submitted" },
    IN_REVIEW: { label: "In review" },
    PAYMENT_SETTLED: { label: "Payment settled" },
    DELIVERED: { label: "Delivered" },
  };
}

function normalizeDisplayOrder(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

export function sortFilterGroupsByDisplayOrder(
  groups: QueueFilterGroup[],
): QueueFilterGroup[] {
  return groups
    .map((group, index) => ({
      group,
      index,
      order: normalizeDisplayOrder(group.displayOrder),
    }))
    .sort((left, right) => {
      if (left.order === null && right.order === null) {
        return left.index - right.index;
      }

      if (left.order === null) {
        return 1;
      }

      if (right.order === null) {
        return -1;
      }

      if (left.order !== right.order) {
        return left.order - right.order;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.group);
}
