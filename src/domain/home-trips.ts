import type { Trip } from "./models";

export const homeTripSortModes = ["date_asc", "date_desc", "name_asc"] as const;
export const homeTripViewModes = ["grid", "list"] as const;

export type HomeTripSortMode = (typeof homeTripSortModes)[number];
export type HomeTripViewMode = (typeof homeTripViewModes)[number];

export const defaultHomeTripSort: HomeTripSortMode = "date_asc";
export const defaultHomeTripView: HomeTripViewMode = "grid";

const nameCollator = new Intl.Collator(undefined, {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

export function parseHomeTripSort(value: unknown): HomeTripSortMode {
  return homeTripSortModes.includes(value as HomeTripSortMode)
    ? (value as HomeTripSortMode)
    : defaultHomeTripSort;
}

export function parseHomeTripView(value: unknown): HomeTripViewMode {
  return homeTripViewModes.includes(value as HomeTripViewMode)
    ? (value as HomeTripViewMode)
    : defaultHomeTripView;
}

function compareNames(left: Trip, right: Trip) {
  return nameCollator.compare(left.name.normalize(), right.name.normalize());
}

export function sortHomeTrips(
  trips: readonly Trip[],
  mode: HomeTripSortMode,
): Trip[] {
  return [...trips].sort((left, right) => {
    const date = left.startDate.localeCompare(right.startDate);
    const name = compareNames(left, right);
    const id = left.id.localeCompare(right.id);
    if (mode === "date_asc") return date || name || id;
    if (mode === "date_desc") return -date || name || id;
    return name || date || id;
  });
}

export function tripDurationDays(trip: Pick<Trip, "startDate" | "endDate">) {
  const start = Date.parse(`${trip.startDate}T12:00:00Z`);
  const end = Date.parse(`${trip.endDate}T12:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

export function tripHref(trip: Pick<Trip, "id">) {
  return `/trips/${trip.id}`;
}
