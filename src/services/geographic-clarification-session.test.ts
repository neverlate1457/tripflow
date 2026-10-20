import { beforeEach, describe, expect, it } from "vitest";
import type { DiscoverPlacesIntent } from "@/domain/discovery";
import type { ScoredGeographicCandidate } from "@/domain/geographic-resolution";
import {
  clearGeographicClarificationSessions,
  createGeographicClarificationSession,
  resolveGeographicClarification,
} from "./geographic-clarification-session";

const intent: DiscoverPlacesIntent = {
  type: "discover_places",
  date: "2026-10-30",
  geographicScope: "nearby_point",
  geographicReference: { text: "博多站" },
  categories: ["cafe"],
};

const scored = (id: string, name: string, latitude: number): ScoredGeographicCandidate => ({
  score: 90,
  reasons: ["name_exact", "feature_station"],
  candidate: {
    name,
    formattedAddress: `${name}, Japan`,
    latitude,
    longitude: 130.42,
    provider: "geoapify",
    providerPlaceId: id,
    timezone: "Asia/Tokyo",
    resultType: "amenity",
    categories: ["public_transport.train"],
    country: "Japan",
  },
});

describe("geographic clarification sessions", () => {
  beforeEach(clearGeographicClarificationSessions);

  it("preserves the validated discovery intent and resolves only a session candidate", () => {
    const created = createGeographicClarificationSession({
      tripId: "trip-a",
      tripUpdatedAt: "2026-10-01T00:00:00.000Z",
      date: intent.date!,
      originalRequest: "博多站附近找咖啡廳",
      geographicReference: "博多站",
      geographicScope: "nearby_point",
      intent,
      candidates: [scored("fukuoka", "Hakata Station", 33.59), scored("amagasaki", "博多駅", 34.73)],
      now: 1_000,
    });
    expect(created.candidates).toHaveLength(2);
    expect(created.candidates[0]).not.toHaveProperty("score");
    const resolved = resolveGeographicClarification(created.clarificationToken, created.candidates[0].candidateId, 2_000);
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.session.intent.categories).toEqual(["cafe"]);
      expect(resolved.session.tripId).toBe("trip-a");
      expect(resolved.candidate.providerPlaceId).toBe("fukuoka");
      expect(resolved.candidate.latitude).toBe(33.59);
    }
  });

  it("rejects invalid, expired, and repeated selections", () => {
    const created = createGeographicClarificationSession({ tripId: "trip", tripUpdatedAt: "2026-10-01T00:00:00.000Z", date: intent.date!, originalRequest: "query", geographicReference: "博多站", geographicScope: "nearby_point", intent, candidates: [scored("one", "One", 1)], now: 1_000 });
    expect(resolveGeographicClarification(created.clarificationToken, "tampered", 2_000).status).toBe("invalid_candidate");
    expect(resolveGeographicClarification(created.clarificationToken, created.candidates[0].candidateId, 2_000).status).toBe("resolved");
    expect(resolveGeographicClarification(created.clarificationToken, created.candidates[0].candidateId, 2_001).status).toBe("already_used");
    const expired = createGeographicClarificationSession({ tripId: "trip", tripUpdatedAt: "2026-10-01T00:00:00.000Z", date: intent.date!, originalRequest: "query", geographicReference: "博多站", geographicScope: "nearby_point", intent, candidates: [scored("two", "Two", 2)], now: 1_000 });
    expect(resolveGeographicClarification(expired.clarificationToken, expired.candidates[0].candidateId, 301_001).status).toBe("expired");
  });

  it("keeps concurrent requests isolated", () => {
    const make = (tripId: string, id: string) => createGeographicClarificationSession({ tripId, tripUpdatedAt: "2026-10-01T00:00:00.000Z", date: intent.date!, originalRequest: id, geographicReference: id, geographicScope: "nearby_point", intent, candidates: [scored(id, id, 1)], now: 1_000 });
    const first = make("trip-a", "a"), second = make("trip-b", "b");
    expect(resolveGeographicClarification(first.clarificationToken, second.candidates[0].candidateId, 2_000).status).toBe("invalid_candidate");
    const resolved = resolveGeographicClarification(second.clarificationToken, second.candidates[0].candidateId, 2_000);
    expect(resolved.status === "resolved" && resolved.session.tripId).toBe("trip-b");
  });

  it("preserves the ambiguous corridor endpoint role without changing the original intent", () => {
    const corridorIntent: DiscoverPlacesIntent = {
      type: "discover_places", date: "2026-10-30", categories: ["cafe"], geographicScope: "corridor",
      corridorReference: { originText: "Fukuoka", destinationText: "Kokura" },
    };
    const created = createGeographicClarificationSession({
      tripId: "trip", tripUpdatedAt: "2026-10-01T00:00:00.000Z", date: corridorIntent.date!,
      originalRequest: "Find cafes between Fukuoka and Kokura", geographicReference: "Kokura",
      geographicScope: "corridor", corridorEndpoint: "destination", intent: corridorIntent,
      candidates: [scored("kitakyushu", "Kokura-Kita Ward", 33.88), scored("mino", "Kokura", 35.5)], now: 1_000,
    });
    expect(created.corridorEndpoint).toBe("destination");
    const resolved = resolveGeographicClarification(created.clarificationToken, created.candidates[0].candidateId, 2_000);
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.session.corridorEndpoint).toBe("destination");
      expect(resolved.session.intent).toEqual(corridorIntent);
    }
  });
});
