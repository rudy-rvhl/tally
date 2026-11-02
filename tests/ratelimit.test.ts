import { describe, expect, it } from "vitest";
import { clearFailures, isLocked, recordFailure } from "@/lib/ratelimit";

describe("sign-in rate limit", () => {
  it("locks after repeated failures and unlocks after the window", () => {
    const k = "a@example.com", t = 1_000_000;
    for (let i = 0; i < 8; i++) recordFailure(k, t);
    expect(isLocked(k, t)).toBe(true);
    expect(isLocked(k, t + 16 * 60 * 1000)).toBe(false);
  });
  it("clears on successful sign-in", () => {
    const k = "b@example.com";
    for (let i = 0; i < 8; i++) recordFailure(k);
    clearFailures(k);
    expect(isLocked(k)).toBe(false);
  });
});
