import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRoutingClient } from "./client-routing";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});
describe("HttpRoutingClient", () => {
  it("binds the native fetch receiver and reaches the route API", async () => {
    const strictFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(
        Response.json({
          provider: "test",
          origin: { latitude: 1, longitude: 2 },
          destination: { latitude: 3, longitude: 4 },
          mode: "driving",
          durationSeconds: 60,
          distanceMeters: 100,
        }),
      );
    }) as unknown as typeof fetch;
    globalThis.fetch = strictFetch;
    const client = new HttpRoutingClient();
    await expect(
      client.route("trip", { id: "a--b", tripId: "trip", date: "2026-01-01", fromEndpoint: { kind: "trip_item", tripItemId: "a" }, toEndpoint: { kind: "trip_item", tripItemId: "b" }, fromTripItemId: "a", toTripItemId: "b", origin: { latitude: 1, longitude: 2 }, destination: { latitude: 3, longitude: 4 }, departureAt: "2026-01-01T00:00:00Z" }, {
        origin: { latitude: 1, longitude: 2 },
        destination: { latitude: 3, longitude: 4 },
        mode: "driving",
      }),
    ).resolves.toMatchObject({ durationSeconds: 60 });
    expect(strictFetch).toHaveBeenCalledWith(
      "/api/routes",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
