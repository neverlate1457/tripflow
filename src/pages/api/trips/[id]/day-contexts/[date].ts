import type { APIRoute } from "astro";
import { createDayContext, isEmptyDayContext, isGroundedPlaceRef, isValidDayContextDate } from "@/domain/day-context";
import type { DayContext, GroundedPlaceRef } from "@/domain/models";
import { SqliteTripRepository } from "@/services/sqlite-trip-repository";

const repository = new SqliteTripRepository();
const keys = ["startLocation", "baseLocation", "endLocation"];
const validBody = (value: unknown): value is Pick<DayContext, "startLocation"|"baseLocation"|"endLocation"> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Object.keys(data).every((key) => keys.includes(key)) && keys.every((key) => data[key] === undefined || data[key] === null || isGroundedPlaceRef(data[key]));
};

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const tripId = params.id ?? "", date = params.date ?? "", snapshot = await repository.getTrip(tripId);
    if (!snapshot) return Response.json({ error: "Trip not found" }, { status: 404 });
    if (!isValidDayContextDate(date, snapshot.trip)) return Response.json({ error: "Date is outside the trip" }, { status: 400 });
    const body: unknown = await request.json();
    if (!validBody(body)) return Response.json({ error: "Invalid day context" }, { status: 400 });
    const existing = snapshot.dayContexts?.find((value) => value.date === date), data = body as Partial<Record<typeof keys[number], GroundedPlaceRef | null>>;
    const context = createDayContext(snapshot.trip, date, {
      startLocation: data.startLocation === undefined ? existing?.startLocation ?? null : data.startLocation,
      baseLocation: data.baseLocation === undefined ? existing?.baseLocation ?? null : data.baseLocation,
      endLocation: data.endLocation === undefined ? existing?.endLocation ?? null : data.endLocation,
    });
    if (existing) context.createdAt = existing.createdAt;
    if (isEmptyDayContext(context)) {
      await repository.deleteDayContext(tripId, date);
      return new Response(null, { status: 204 });
    }
    await repository.upsertDayContext(context);
    return Response.json(context);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof Error && error.message === "INVALID_DAY_CONTEXT") return Response.json({ error: "Invalid day context" }, { status: 400 });
    return Response.json({ error: "Unable to save day context" }, { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  try {
    const tripId = params.id ?? "", date = params.date ?? "", snapshot = await repository.getTrip(tripId);
    if (!snapshot) return Response.json({ error: "Trip not found" }, { status: 404 });
    if (!isValidDayContextDate(date, snapshot.trip)) return Response.json({ error: "Date is outside the trip" }, { status: 400 });
    await repository.deleteDayContext(tripId, date);
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Unable to remove day context" }, { status: 500 });
  }
};
