import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { demoTrip } from "@/data/demo-trip";
import type { DayContext, NormalizedPlace, Trip } from "@/domain/models";
import { DayContextEditor, dayContextSummary, normalizedPlaceToGroundedPlaceRef } from "./DayContextEditor";

const trip: Trip = {
  ...demoTrip,
  destination: {
    name: "Oita",
    latitude: 33.239,
    longitude: 131.609,
    provider: "geoapify",
    providerPlaceId: "oita",
    timezone: "Asia/Tokyo",
  },
};

describe("DayContextEditor", () => {
  const location = (name: string, providerPlaceId = name) => ({
    name,
    formattedAddress: `${name}, Japan`,
    latitude: 33.266,
    longitude: 131.367,
    provider: "geoapify",
    providerPlaceId,
    timezone: "Asia/Tokyo",
  });
  const context = (values: Partial<DayContext> = {}): DayContext => ({
    tripId: trip.id,
    date: "2026-10-31",
    startLocation: null,
    baseLocation: null,
    endLocation: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...values,
  });
  const renderEditor = (props: Partial<React.ComponentProps<typeof DayContextEditor>> = {}) => renderToStaticMarkup(
    <DayContextEditor trip={trip} date="2026-10-31" context={null} saveStatus="idle" saveError={null} onSave={vi.fn()} {...props} />,
  );

  it("is collapsed by default with an accessible disclosure button", () => {
    const html = renderEditor();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Expand day context for 2026-10-31"');
    expect(html).not.toContain("Where this day starts");
    expect(html).not.toContain(">Set<");
  });

  it("expands and can render the collapsed state again", () => {
    const expanded = renderEditor({ defaultExpanded: true });
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('aria-label="Collapse day context for 2026-10-31"');
    expect(expanded).toContain('id="day-context-editor-content"');
    expect(renderEditor()).not.toContain('id="day-context-editor-content"');
  });

  it("summarizes every configured field compactly", () => {
    const value = context({ startLocation: location("Oita Station"), baseLocation: location("Yufuin"), endLocation: location("Yufuin Hotel") });
    expect(dayContextSummary(value, trip)).toBe("Start: Oita Station · Base: Yufuin · End: Yufuin Hotel");
    expect(renderEditor({ context: value })).toContain("Start: Oita Station · Base: Yufuin · End: Yufuin Hotel");
  });

  it("omits unset fields from a partial summary", () => {
    expect(dayContextSummary(context({ baseLocation: location("Yufuin") }), trip)).toBe("Base: Yufuin");
  });

  it("shows an empty summary separately from the Trip Destination fallback", () => {
    const html = renderToStaticMarkup(
      <DayContextEditor
        trip={trip}
        date="2026-10-31"
        context={null}
        saveStatus="idle"
        saveError={null}
        onSave={vi.fn()}
      />,
    );
    expect(html).toContain("Not configured · Trip fallback: Oita");
    expect(html).not.toContain("Base: Oita");
    expect(html).toContain("Day context for 2026-10-31");
  });

  it("switches date data without changing an expanded presentation state", () => {
    const oct30 = renderEditor({ date: "2026-10-30", context: context({ date: "2026-10-30", baseLocation: location("Beppu") }), defaultExpanded: true });
    const oct31 = renderEditor({ date: "2026-10-31", context: context({ baseLocation: location("Yufuin") }), defaultExpanded: true });
    expect(oct30).toContain('aria-expanded="true"'); expect(oct30).toContain("Base: Beppu");
    expect(oct31).toContain('aria-expanded="true"'); expect(oct31).toContain("Base: Yufuin"); expect(oct31).not.toContain("Beppu");
  });

  it("switches date data without changing a collapsed presentation state", () => {
    const oct31 = renderEditor({ context: context({ baseLocation: location("Yufuin") }) });
    expect(oct31).toContain('aria-expanded="false"'); expect(oct31).toContain("Base: Yufuin"); expect(oct31).not.toContain(">Set<");
  });

  it("does not show a previous trip summary", () => {
    const otherTrip = { ...trip, id: "other-trip", destination: { ...trip.destination!, name: "Taipei", providerPlaceId: "taipei" } };
    const html = renderEditor({ trip: otherTrip, context: null });
    expect(html).toContain("Trip fallback: Taipei");
    expect(html).not.toContain("Oita Station");
    expect(html).not.toContain("Trip fallback: Oita");
  });

  it("preserves Set, Change, and Clear controls when expanded", () => {
    const html = renderEditor({ context: context({ startLocation: location("Oita Station") }), defaultExpanded: true, saveStatus: "saved" });
    expect(html).toContain(">Change<");
    expect(html).toContain(">Set<");
    expect(html).toContain('aria-label="Clear Start"');
    expect(html).toContain("Trip fallback: Oita");
    expect(html).toContain("Saved");
  });

  it("persists only normalized provider-backed fields", () => {
    const place: NormalizedPlace = {
      provider: "geoapify",
      providerPlaceId: "place-1",
      name: "Oita Station",
      address: "1 Oita Ekimae",
      location: { latitude: 33.233, longitude: 131.607 },
      category: "public_transport.train",
      categories: ["public_transport.train"],
      attribution: "Geoapify",
    };
    expect(normalizedPlaceToGroundedPlaceRef(place)).toEqual({
      name: "Oita Station",
      formattedAddress: "1 Oita Ekimae",
      latitude: 33.233,
      longitude: 131.607,
      provider: "geoapify",
      providerPlaceId: "place-1",
      timezone: null,
    });
  });
});
