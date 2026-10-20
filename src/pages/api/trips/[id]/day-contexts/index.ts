import type { APIRoute } from "astro";
import { SqliteTripRepository } from "@/services/sqlite-trip-repository";

const repository = new SqliteTripRepository();

export const GET: APIRoute = async ({ params }) => {
  try {
    const tripId = params.id ?? "";
    if (!(await repository.getTrip(tripId))) return Response.json({ error: "Trip not found" }, { status: 404 });
    return Response.json(await repository.listDayContexts(tripId));
  } catch {
    return Response.json({ error: "Unable to load day contexts" }, { status: 500 });
  }
};
