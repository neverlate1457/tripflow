import { describe, expect, it } from "vitest";
import { createDayContext, isEmptyDayContext, isGroundedPlaceRef, isValidDayContextDate, validateDayContext } from "./day-context";
import { demoTrip } from "@/data/demo-trip";

const place = (name = "Oita", latitude = 33.239, longitude = 131.609) => ({ name, formattedAddress: `${name}, Japan`, latitude, longitude, provider: "geoapify", providerPlaceId: `provider-${name}`, timezone: "Asia/Tokyo" });

describe("DayContext domain", () => {
  it("creates full and partial provider-grounded contexts", () => {
    const full = createDayContext(demoTrip, demoTrip.startDate, { startLocation: place("Fukuoka"), baseLocation: place("Oita"), endLocation: place("Yufuin") }, "2026-01-01T00:00:00Z");
    expect(validateDayContext(full, demoTrip)).toBe(true);
    expect(validateDayContext({ ...full, startLocation: null, endLocation: null }, demoTrip)).toBe(true);
  });
  it("uses an all-null context as the no-row invariant", () => expect(isEmptyDayContext(createDayContext(demoTrip, demoTrip.startDate, { startLocation: null, baseLocation: null, endLocation: null }))).toBe(true));
  it.each([
    [{ ...place(), latitude: 91 }, "latitude"],
    [{ ...place(), longitude: -181 }, "longitude"],
    [{ ...place(), provider: "" }, "provider"],
    [{ ...place(), providerPlaceId: "" }, "providerPlaceId"],
    [{ ...place(), raw: { unsafe: true } }, "raw provider payload"],
  ])("rejects invalid grounded-place input: %s", (value, _label) => expect(isGroundedPlaceRef(value)).toBe(false));
  it("rejects dates before and after the trip", () => {
    expect(isValidDayContextDate("2026-01-01", demoTrip)).toBe(false);
    expect(isValidDayContextDate("2099-01-01", demoTrip)).toBe(false);
  });
});
