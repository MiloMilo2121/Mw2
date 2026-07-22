import { describe, it, expect } from "vitest";
import { isEligible } from "../automations";

// A raw Instantly lead as returned by /leads/list. Defaults describe a lead that
// finished the 3-step Sassi sequence 5 days ago without replying.
function raw(
  o: Partial<{ stepIdx: number; daysAgo: number; status: number; replies: number; interest: number; noTs: boolean }> = {}
): Record<string, unknown> {
  const { stepIdx = 2, daysAgo = 5, status = 3, replies = 0, interest = 0, noTs = false } = o;
  const ts = new Date(Date.now() - daysAgo * 86400000).toISOString();
  return {
    status,
    email_reply_count: replies,
    lt_interest_status: interest,
    status_summary: { lastStep: { stepID: `0_${stepIdx}_0`, ...(noTs ? {} : { timestamp_executed: ts }) } },
    email: "info@x.it",
    first_name: "A",
    last_name: "B",
    company_name: "C",
  };
}

const STEPS = 3; // Sassi 1-3

describe("isEligible — Sassi → Rosa", () => {
  it("moves a lead that finished all steps, no reply, ≥ minDays ago", () => {
    expect(isEligible(raw(), 3, STEPS)).toBe(true);
  });

  it("keeps a lead that hasn't received the final email", () => {
    expect(isEligible(raw({ stepIdx: 1 }), 3, STEPS)).toBe(false);
  });

  it("waits until minDays elapsed since the last email", () => {
    expect(isEligible(raw({ daysAgo: 1 }), 3, STEPS)).toBe(false);
    expect(isEligible(raw({ daysAgo: 3 }), 3, STEPS)).toBe(true);
  });

  it("never moves a lead that replied", () => {
    expect(isEligible(raw({ replies: 1 }), 3, STEPS)).toBe(false);
  });

  it("never moves a bounced/stopped (negative status) lead", () => {
    expect(isEligible(raw({ status: -1 }), 3, STEPS)).toBe(false);
    expect(isEligible(raw({ status: -2 }), 3, STEPS)).toBe(false);
  });

  it("skips a lead marked interested", () => {
    expect(isEligible(raw({ interest: 1 }), 3, STEPS)).toBe(false);
  });

  it("requires the last step to have been actually delivered (timestamp present)", () => {
    expect(isEligible(raw({ noTs: true }), 3, STEPS)).toBe(false);
  });

  it("falls back gracefully when the sequence length is unknown (totalSteps=0)", () => {
    // completed lead (status 3, reached a last step) still qualifies without the length gate
    expect(isEligible(raw(), 3, 0)).toBe(true);
    // but an active lead at step 0 with no delivered timestamp still fails the other guards
    expect(isEligible(raw({ stepIdx: 0, replies: 1 }), 3, 0)).toBe(false);
  });
});
