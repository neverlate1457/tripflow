import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpMapPlaceClient } from "./client-map-places";

afterEach(() => vi.unstubAllGlobals());
const place = { provider: "geoapify", providerPlaceId: "p1", name: "Lighthouse", location: { latitude: 35.7, longitude: 140.8 } };
describe("map place client", () => {
  it("uses provider-grounded resolution and caches repeated clicks", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "resolved", place }) }); vi.stubGlobal("fetch", fetcher); const client = new HttpMapPlaceClient();
    await client.resolve({ name: "Lighthouse", latitude: 35.7, longitude: 140.8 }); await client.resolve({ name: "Lighthouse", latitude: 35.7, longitude: 140.8 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("returns only normalized nearby provider results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [place] }) }));
    expect(await new HttpMapPlaceClient().nearby(35.7, 140.8, 5000)).toEqual([place]);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("radius=5000"), expect.any(Object));
  });
  it("surfaces provider failure without inventing a place", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "offline" }) }));
    await expect(new HttpMapPlaceClient().resolve({ name: "x", latitude: 1, longitude: 1 })).rejects.toThrow("offline");
  });
});
