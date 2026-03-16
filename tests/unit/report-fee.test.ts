import { describe, expect, it } from "vitest";

import {
  formatPostDeliveryAcknowledgmentConfirmation,
  formatPostCheckoutPendingConfirmation,
  formatPendingReportFeeMessage,
  formatReportFeeReadinessContext,
  formatReportFeeSummary,
  resolvePendingReportFeeHintBadge,
} from "@/lib/report-fee";

describe("formatReportFeeSummary", () => {
  it("formats report fee amount when cents are provided", () => {
    expect(formatReportFeeSummary({ currency: "EUR", feeCents: 1990 })).toBe("EUR 19.90");
  });

  it("returns deterministic pending-pricing copy when fee cents are unavailable", () => {
    expect(formatReportFeeSummary({ currency: "EUR", feeCents: null })).toBe("EUR pending pricing");
  });
});

describe("formatPendingReportFeeMessage", () => {
  it("formats checkout message with amount when cents are provided", () => {
    expect(
      formatPendingReportFeeMessage({
        currency: "EUR",
        feeCents: 1990,
      }),
    ).toBe("Report fee pending (EUR 19.90).");
  });

  it("formats reason-aware pending message when pricing is in progress", () => {
    expect(
      formatPendingReportFeeMessage({
        currency: "EUR",
        feeCents: null,
        pendingReason: "PRICING_IN_PROGRESS",
      }),
    ).toBe("Report fee pending (pricing in progress; EUR amount not finalized).");
  });
});

describe("resolvePendingReportFeeHintBadge", () => {
  it("returns deterministic badge copy for pricing-in-progress pending reason", () => {
    expect(
      resolvePendingReportFeeHintBadge({
        currency: "EUR",
        feeCents: null,
        pendingReason: "PRICING_IN_PROGRESS",
      }),
    ).toBe("Pricing in progress");
  });

  it("returns null when pending reason is not present", () => {
    expect(
      resolvePendingReportFeeHintBadge({
        currency: "EUR",
        feeCents: 1990,
        pendingReason: null,
      }),
    ).toBeNull();
  });
});

describe("formatPostCheckoutPendingConfirmation", () => {
  it("returns reason-aware confirmation copy when pricing is in progress", () => {
    expect(
      formatPostCheckoutPendingConfirmation({
        currency: "EUR",
        feeCents: null,
        pendingReason: "PRICING_IN_PROGRESS",
      }),
    ).toBe(
      "Checkout started. Pricing is still in progress; we'll show the final fee as soon as it is finalized.",
    );
  });

  it("returns generic confirmation copy when no pending reason is present", () => {
    expect(
      formatPostCheckoutPendingConfirmation({
        currency: "EUR",
        feeCents: 1990,
        pendingReason: null,
      }),
    ).toBe("Checkout started. Report-fee payment remains pending.");
  });

  it("appends checkout timestamp context when backend metadata is available", () => {
    expect(
      formatPostCheckoutPendingConfirmation({
        currency: "EUR",
        feeCents: null,
        pendingReason: "PRICING_IN_PROGRESS",
        checkoutInitiatedAt: "2026-03-10T04:00:00.000Z",
      }),
    ).toContain("Checkout initiated at 2026-03-10T04:00:00.000Z.");
  });

  it("renders settled confirmation with settlement actor email when metadata is available", () => {
    expect(
      formatPostCheckoutPendingConfirmation({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T04:20:00.000Z",
        settledByUserId: "usr_admin_123",
        settledByUserEmail: "admin@example.com",
      }),
    ).toBe(
      "Checkout already settled at 2026-03-10T04:20:00.000Z. Settlement actor id: usr_admin_123. Settlement actor email: admin@example.com.",
    );
  });

  it("renders admin-role context for settled checkout confirmation when role metadata is available", () => {
    expect(
      formatPostCheckoutPendingConfirmation({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T04:20:00.000Z",
        settledByRole: "ADMIN",
      }),
    ).toBe(
      "Checkout already settled at 2026-03-10T04:20:00.000Z by an admin.",
    );
  });

  it("appends settlement evidence token when settlement event metadata is present", () => {
    expect(
      formatPostCheckoutPendingConfirmation({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T04:20:00.000Z",
        settlementEventId: "evt_789",
      }),
    ).toBe(
      "Checkout already settled at 2026-03-10T04:20:00.000Z. Settlement evidence token: evt_789.",
    );
  });

  it("appends settlement note when settlement note metadata is present", () => {
    expect(
      formatPostCheckoutPendingConfirmation({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T04:20:00.000Z",
        settlementNote: "Manual settlement evidence verified",
      }),
    ).toBe(
      "Checkout already settled at 2026-03-10T04:20:00.000Z. Settlement note: Manual settlement evidence verified.",
    );
  });
});

describe("formatPostDeliveryAcknowledgmentConfirmation", () => {
  it("renders generic acknowledgment confirmation when no settlement metadata is present", () => {
    expect(
      formatPostDeliveryAcknowledgmentConfirmation({
        currency: "EUR",
        feeCents: 1990,
      }),
    ).toBe("Delivery acknowledgment recorded.");
  });

  it("renders settlement actor email context when metadata is present", () => {
    expect(
      formatPostDeliveryAcknowledgmentConfirmation({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T06:20:00.000Z",
        settledByRole: "ADMIN",
        settledByUserEmail: "admin@example.com",
      }),
    ).toBe(
      "Delivery acknowledgment recorded. Settlement was completed at 2026-03-10T06:20:00.000Z by an admin. Settlement actor email: admin@example.com.",
    );
  });

  it("appends settlement evidence token when settlement event metadata is present", () => {
    expect(
      formatPostDeliveryAcknowledgmentConfirmation({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T06:20:00.000Z",
        settledByRole: "ADMIN",
        settlementEventId: "evt_456",
      }),
    ).toBe(
      "Delivery acknowledgment recorded. Settlement was completed at 2026-03-10T06:20:00.000Z by an admin. Settlement evidence token: evt_456.",
    );
  });

  it("appends settlement actor id when actor-id metadata is present", () => {
    expect(
      formatPostDeliveryAcknowledgmentConfirmation({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T06:20:00.000Z",
        settledByRole: "ADMIN",
        settledByUserId: "usr_admin_123",
      }),
    ).toBe(
      "Delivery acknowledgment recorded. Settlement was completed at 2026-03-10T06:20:00.000Z by an admin. Settlement actor id: usr_admin_123.",
    );
  });

  it("appends settlement note when settlement note metadata is present", () => {
    expect(
      formatPostDeliveryAcknowledgmentConfirmation({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T06:20:00.000Z",
        settledByRole: "ADMIN",
        settlementNote: "Manual settlement evidence verified",
      }),
    ).toBe(
      "Delivery acknowledgment recorded. Settlement was completed at 2026-03-10T06:20:00.000Z by an admin. Settlement note: Manual settlement evidence verified.",
    );
  });

  it("omits settlement note copy when settlement note metadata is whitespace-only", () => {
    expect(
      formatPostDeliveryAcknowledgmentConfirmation({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T06:20:00.000Z",
        settledByRole: "ADMIN",
        settlementNote: "   ",
      }),
    ).toBe(
      "Delivery acknowledgment recorded. Settlement was completed at 2026-03-10T06:20:00.000Z by an admin.",
    );
  });

  it("renders owner-role context when settlement actor role metadata is USER", () => {
    expect(
      formatPostDeliveryAcknowledgmentConfirmation({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T06:20:00.000Z",
        settledByRole: "USER",
      }),
    ).toBe(
      "Delivery acknowledgment recorded. Settlement was completed at 2026-03-10T06:20:00.000Z by the account owner.",
    );
  });
});

describe("formatReportFeeReadinessContext", () => {
  it("returns null when checkout initiation metadata is absent", () => {
    expect(
      formatReportFeeReadinessContext({
        currency: "EUR",
        feeCents: 1990,
        checkoutInitiatedAt: null,
      }),
    ).toBeNull();
  });

  it("returns readiness context when checkout initiation metadata is available", () => {
    expect(
      formatReportFeeReadinessContext({
        currency: "EUR",
        feeCents: 1990,
        checkoutInitiatedAt: "2026-03-10T05:10:00.000Z",
      }),
    ).toBe("Report-fee checkout was initiated at 2026-03-10T05:10:00.000Z.");
  });

  it("prioritizes settlement metadata context when available with admin actor role", () => {
    expect(
      formatReportFeeReadinessContext({
        currency: "EUR",
        feeCents: 1990,
        checkoutInitiatedAt: "2026-03-10T05:10:00.000Z",
        settledAt: "2026-03-10T05:20:00.000Z",
        settledByRole: "ADMIN",
      }),
    ).toBe("Report-fee settlement was recorded at 2026-03-10T05:20:00.000Z by an admin.");
  });

  it("appends settlement evidence token when settlement event id metadata is available", () => {
    expect(
      formatReportFeeReadinessContext({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T05:20:00.000Z",
        settledByRole: "ADMIN",
        settlementEventId: "evt_123",
      }),
    ).toBe(
      "Report-fee settlement was recorded at 2026-03-10T05:20:00.000Z by an admin. Settlement evidence token: evt_123.",
    );
  });

  it("renders settlement-note context when note metadata is available", () => {
    expect(
      formatReportFeeReadinessContext({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T05:20:00.000Z",
        settledByRole: "ADMIN",
        settlementNote: "Manual settlement evidence verified",
      }),
    ).toBe(
      "Report-fee settlement was recorded at 2026-03-10T05:20:00.000Z by an admin. Settlement note: Manual settlement evidence verified.",
    );
  });

  it("renders settlement actor id context when actor metadata is available", () => {
    expect(
      formatReportFeeReadinessContext({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T05:20:00.000Z",
        settledByRole: "ADMIN",
        settledByUserId: "usr_admin_123",
      }),
    ).toBe(
      "Report-fee settlement was recorded at 2026-03-10T05:20:00.000Z by an admin. Settlement actor id: usr_admin_123.",
    );
  });

  it("renders settlement actor email context when actor email metadata is available", () => {
    expect(
      formatReportFeeReadinessContext({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T05:20:00.000Z",
        settledByRole: "ADMIN",
        settledByUserEmail: "admin@example.com",
      }),
    ).toBe(
      "Report-fee settlement was recorded at 2026-03-10T05:20:00.000Z by an admin. Settlement actor email: admin@example.com.",
    );
  });

  it("renders generic settlement context when actor role metadata is unavailable", () => {
    expect(
      formatReportFeeReadinessContext({
        currency: "EUR",
        feeCents: 1990,
        settledAt: "2026-03-10T05:20:00.000Z",
        settledByRole: null,
      }),
    ).toBe("Report-fee settlement was recorded at 2026-03-10T05:20:00.000Z.");
  });
});
