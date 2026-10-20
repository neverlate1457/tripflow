import { describe, expect, it } from "vitest";
import { resolveMapPlace } from "./map-planning";

const place = (id: string, name: string, latitude: number, longitude: number) => ({ provider: "geoapify", providerPlaceId: id, name, location: { latitude, longitude }, categories: ["tourism.sights.lighthouse"] });
describe("map POI grounding", () => {
  it("accepts a nearby normalized name match", () => expect(resolveMapPlace({ name: "犬吠埼燈台", category: "lighthouse", latitude: 35.706, longitude: 140.869 }, [place("p1", "犬吠埼燈台", 35.7061, 140.8691)])?.providerPlaceId).toBe("p1"));
  it("rejects a distant or unrelated result", () => expect(resolveMapPlace({ name: "犬吠埼燈台", latitude: 35.706, longitude: 140.869 }, [place("p2", "Unrelated museum", 35.8, 140.9)])).toBeNull());
});
