import { describe, expect, it } from "vitest";
import { loadTripResponse } from "./[id]";
import { demoCandidates, demoItems, demoTrip } from "@/data/demo-trip";

describe("trip GET API", () => {
  it("returns an existing snapshot rather than masking it as a load failure", async () => {
    const response = await loadTripResponse(demoTrip.id, { getTrip: async () => ({ trip: demoTrip, items: demoItems, candidates: demoCandidates, segmentPreferences: [], dayContexts: [] }) } as never);
    expect(response.status).toBe(200);
    expect((await response.json()).trip.id).toBe(demoTrip.id);
  });
  it("retains the safe public error while exposing the original exception to development logging", async () => {
    const error = new Error('no such column: location_source');
    const logged = console.error;
    console.error = () => undefined;
    try {
      const response = await loadTripResponse('trip', { getTrip: async () => { throw error; } } as never);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Unable to load trip' });
    } finally { console.error = logged; }
  });
});
