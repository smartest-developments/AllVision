import { describe, expect, it } from "vitest";
import { SourcingRequestStatus } from "@prisma/client";
import {
  assertValidTransition,
  canTransition,
  getAllowedTransitions,
  SourcingRequestTransitionError
} from "@/server/sourcing-requests";

describe("sourcing request transition guard", () => {
  it("allows SUBMITTED -> IN_REVIEW", () => {
    expect(canTransition(SourcingRequestStatus.SUBMITTED, SourcingRequestStatus.IN_REVIEW)).toBe(true);
    expect(() =>
      assertValidTransition(SourcingRequestStatus.SUBMITTED, SourcingRequestStatus.IN_REVIEW)
    ).not.toThrow();
  });

  it("allows IN_REVIEW -> REPORT_READY", () => {
    expect(canTransition(SourcingRequestStatus.IN_REVIEW, SourcingRequestStatus.REPORT_READY)).toBe(true);
    expect(() =>
      assertValidTransition(SourcingRequestStatus.IN_REVIEW, SourcingRequestStatus.REPORT_READY)
    ).not.toThrow();
  });

  it("rejects invalid transitions", () => {
    expect(canTransition(SourcingRequestStatus.SUBMITTED, SourcingRequestStatus.REPORT_READY)).toBe(
      false
    );
    expect(() =>
      assertValidTransition(SourcingRequestStatus.SUBMITTED, SourcingRequestStatus.REPORT_READY)
    ).toThrow(SourcingRequestTransitionError);
  });

  it("returns allowed transitions for a status", () => {
    expect(getAllowedTransitions(SourcingRequestStatus.SUBMITTED)).toEqual([
      SourcingRequestStatus.IN_REVIEW,
      SourcingRequestStatus.CANCELLED
    ]);
    expect(getAllowedTransitions(SourcingRequestStatus.REPORT_READY)).toEqual([
      SourcingRequestStatus.PAYMENT_PENDING,
      SourcingRequestStatus.DELIVERED
    ]);
  });
});
