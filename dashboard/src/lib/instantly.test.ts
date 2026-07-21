import { describe, it, expect } from "vitest";
import { normAccount } from "./instantly";

// §8 test on this PR's instantly.ts delta: the read-only statusMessage
// passthrough (raw provider SMTP text) added to normAccount for P0.2(a) alerts.
describe("normAccount statusMessage passthrough", () => {
  it("maps the provider status_message verbatim on an errored account", () => {
    const a = normAccount({
      email: "x@metodogeriko.it",
      status: -3,
      status_message: "550 5.4.5 Daily user sending limit exceeded",
    });
    expect(a.status).toBe(-3);
    expect(a.statusLabel).toBe("Errore invio");
    expect(a.statusMessage).toBe("550 5.4.5 Daily user sending limit exceeded");
  });

  it("falls back across the alternate message keys", () => {
    expect(normAccount({ email: "a@x.it", warmup_status_message: "warmup paused" }).statusMessage).toBe(
      "warmup paused"
    );
    expect(normAccount({ email: "a@x.it", error_message: "auth failed" }).statusMessage).toBe("auth failed");
  });

  it("is undefined for a healthy account with no message", () => {
    expect(normAccount({ email: "ok@metodogeriko.it", status: 1 }).statusMessage).toBeUndefined();
  });
});
