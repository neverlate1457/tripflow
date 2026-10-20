import { readFileSync, readdirSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { demoCandidates, demoItems, demoTrip } from "@/data/demo-trip";
import { SqliteTripRepository } from "./sqlite-trip-repository";
import { createDayContext } from "@/domain/day-context";
import { createTrip } from "@/domain/trips";

const place = (name: string) => ({ name, formattedAddress: `${name}, Japan`, latitude: 33.2, longitude: 131.6, provider: "geoapify", providerPlaceId: `place-${name}`, timezone: "Asia/Tokyo" });

describe("SQLite trip deletion", () => {
  it("loads legacy trips after the additive manual-location migration", async () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    for (const file of readdirSync("drizzle").filter((value) => value.endsWith(".sql")).sort().map((value) => `drizzle/${value}`))
      for (const statement of readFileSync(file, "utf8").split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);
    const repository = new SqliteTripRepository(drizzle(sqlite, { schema }));
    await repository.saveTrip({ trip: demoTrip, items: [{ ...demoItems[0], locationSource: "manual", originalLocationInput: "台北車站", latitude: 25.0478, longitude: 121.517 }], candidates: [], segmentPreferences: [], dayContexts: [] });
    expect((await repository.getTrip(demoTrip.id))?.items[0]).toMatchObject({ locationSource: "manual", originalLocationInput: "台北車站", latitude: 25.0478 });
    sqlite.close();
  });
  it("cascades to items and candidates", async () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    for (const file of readdirSync("drizzle")
      .filter((value) => value.endsWith(".sql"))
      .sort()
      .map((value) => `drizzle/${value}`)) {
      for (const statement of readFileSync(file, "utf8").split(
        "--> statement-breakpoint",
      ))
        if (statement.trim()) sqlite.exec(statement);
    }
    const repository = new SqliteTripRepository(drizzle(sqlite, { schema }));
    await repository.saveTrip({
      trip: demoTrip,
      items: demoItems,
      candidates: demoCandidates,
      segmentPreferences: [],
    });
    expect(await repository.deleteTrip(demoTrip.id)).toBe(true);
    expect(await repository.getTrip(demoTrip.id)).toBeNull();
    expect(
      sqlite.prepare("select count(*) as count from trip_items").get(),
    ).toMatchObject({ count: 0 });
    expect(
      sqlite.prepare("select count(*) as count from candidates").get(),
    ).toMatchObject({ count: 0 });
    sqlite.close();
  });

  it("persists, upserts, isolates, shrinks, and cascades normalized DayContexts", async () => {
    const sqlite = new Database(":memory:"); sqlite.pragma("foreign_keys = ON");
    for (const file of readdirSync("drizzle").filter((value) => value.endsWith(".sql")).sort().map((value) => `drizzle/${value}`)) for (const statement of readFileSync(file, "utf8").split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);
    const repository = new SqliteTripRepository(drizzle(sqlite, { schema }));
    const trip = createTrip({ name: "Multi-base", startDate: "2026-10-30", endDate: "2026-11-02", timezone: "Asia/Tokyo", destination: null }, "trip-a", "2026-01-01T00:00:00Z");
    const other = createTrip({ name: "Other", startDate: "2026-10-30", endDate: "2026-11-02", timezone: "Asia/Tokyo" }, "trip-b", "2026-01-01T00:00:00Z");
    await repository.createTrip(trip); await repository.createTrip(other);
    const first = createDayContext(trip, "2026-10-30", { startLocation: place("Fukuoka"), baseLocation: place("Oita"), endLocation: place("Yufuin") }, "2026-01-01T00:00:00Z"),
      later = createDayContext(trip, "2026-11-02", { startLocation: null, baseLocation: place("Beppu"), endLocation: null }, "2026-01-01T00:00:00Z"),
      isolated = createDayContext(other, "2026-10-30", { startLocation: null, baseLocation: place("Other"), endLocation: null }, "2026-01-01T00:00:00Z");
    await repository.upsertDayContext(first); await repository.upsertDayContext(later); await repository.upsertDayContext(isolated);
    await repository.upsertDayContext({ ...first, startLocation: null, baseLocation: place("Updated"), updatedAt: "2026-01-02T00:00:00Z" });
    expect(await repository.listDayContexts(trip.id)).toHaveLength(2);
    expect((await repository.listDayContexts(trip.id))[0]).toMatchObject({ startLocation: null, baseLocation: { providerPlaceId: "place-Updated" }, endLocation: { providerPlaceId: "place-Yufuin" } });
    expect(await repository.listDayContexts(other.id)).toHaveLength(1);
    await repository.updateTrip({ ...trip, endDate: "2026-11-01" });
    expect((await repository.listDayContexts(trip.id)).map((value) => value.date)).toEqual(["2026-10-30"]);
    await repository.updateTrip({ ...trip, endDate: "2026-11-03" });
    expect(await repository.listDayContexts(trip.id)).toHaveLength(1);
    expect(await repository.deleteDayContext(trip.id, "2026-10-30")).toBe(true);
    expect(await repository.listDayContexts(trip.id)).toEqual([]);
    await repository.upsertDayContext(first); await repository.deleteTrip(trip.id);
    expect(sqlite.prepare("select count(*) as count from trip_day_contexts where trip_id = ?").get(trip.id)).toMatchObject({ count: 0 });
    sqlite.close();
  });
});
