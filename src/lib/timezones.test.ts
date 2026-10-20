import { describe, expect, it } from "vitest";
import { isValidTimezone, supportedTimezones, timezoneOffsetLabel } from "./timezones";

describe("timezone utilities", () => {
  it("searchable source includes Tokyo and Taipei", () => {
    const zones = supportedTimezones();
    expect(zones).toContain("Asia/Tokyo");
    expect(zones).toContain("Asia/Taipei");
  });
  it("rejects invalid identifiers and formats DST-sensitive offsets", () => {
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(timezoneOffsetLabel("America/New_York", "2026-01-15")).toBe("UTC-05:00");
    expect(timezoneOffsetLabel("America/New_York", "2026-07-15")).toBe("UTC-04:00");
  });
  it("uses a deterministic fallback without supportedValuesOf", () => {
    const fake = { ...Intl, supportedValuesOf: undefined } as unknown as typeof Intl;
    expect(supportedTimezones(fake)).toContain("Asia/Tokyo");
  });
});
