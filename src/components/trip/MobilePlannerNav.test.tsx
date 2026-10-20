import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MobilePlannerNav } from "./MobilePlannerNav";

describe("MobilePlannerNav", () => {
  it("exposes all four mobile sections with one current section", () => {
    const html = renderToStaticMarkup(<MobilePlannerNav active="map" onChange={vi.fn()}/>);
    expect(html).toContain('aria-label="Mobile planner sections"');
    expect(html).toContain("Planner");
    expect(html).toContain("Explore");
    expect(html).toContain("Map");
    expect(html).toContain("Candidates");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("safe-area-bottom");
  });

  it("marks the requested section as current", () => {
    const html = renderToStaticMarkup(<MobilePlannerNav active="candidates" onChange={vi.fn()}/>);
    expect(html).toMatch(/aria-current="page"[^>]*>[\s\S]*?Candidates/);
  });
});
