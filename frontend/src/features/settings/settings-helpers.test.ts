import { describe, expect, it } from "vitest";

import {
  COACHING_NOTES_MAX_BYTES,
  COACHING_PROFILE_MAX_BYTES,
  formatByteUsage,
  formatClientTimestamp,
  formatPairingCountdown,
  remainingPairingSeconds,
  utf8ByteLength,
} from "./settings-helpers";

describe("settings-helpers", () => {
  it("computes and formats pairing window countdowns", () => {
    const now = Date.parse("2026-11-23T12:00:00.000Z");
    expect(remainingPairingSeconds(null, now)).toBe(0);
    expect(remainingPairingSeconds(undefined, now)).toBe(0);
    expect(remainingPairingSeconds("not-a-date", now)).toBe(0);
    expect(remainingPairingSeconds("2026-11-23T11:59:59.000Z", now)).toBe(0);
    expect(formatPairingCountdown("2026-11-23T11:59:59.000Z", now)).toBeNull();

    expect(remainingPairingSeconds("2026-11-23T12:05:09.000Z", now)).toBe(309);
    expect(formatPairingCountdown("2026-11-23T12:05:09.000Z", now)).toBe("5:09");
    expect(formatPairingCountdown("2026-11-23T12:00:01.000Z", now)).toBe("0:01");
  });

  it("formats client timestamps", () => {
    expect(formatClientTimestamp(null)).toBe("Never");
    expect(formatClientTimestamp("2026-11-23T14:25:30Z")).toBe("2026-11-23 14:25 UTC");
  });

  it("measures UTF-8 byte lengths and formats coaching context byte budgets", () => {
    expect(COACHING_PROFILE_MAX_BYTES).toBe(8192);
    expect(COACHING_NOTES_MAX_BYTES).toBe(4096);
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("hello")).toBe(5);
    expect(utf8ByteLength("č")).toBe(2);
    expect(utf8ByteLength("🏒")).toBe(4);
    expect(formatByteUsage(512, COACHING_NOTES_MAX_BYTES)).toBe("512 / 4,096 bytes");
    expect(formatByteUsage(8192, COACHING_PROFILE_MAX_BYTES)).toBe("8,192 / 8,192 bytes");
  });
});
