import type { GroundedAirportRef, PlannerSelection, TripItem } from "./models";
import type { LineString } from "./routing";

export interface FlightRoutePreview {
  itemId: string;
  origin: GroundedAirportRef;
  destination: GroundedAirportRef;
  geometry: LineString;
}

const validCoordinate = (airport: GroundedAirportRef) =>
  Number.isFinite(airport.latitude) && airport.latitude >= -90 && airport.latitude <= 90 &&
  Number.isFinite(airport.longitude) && airport.longitude >= -180 && airport.longitude <= 180;
const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (value: number) => value * 180 / Math.PI;

/** Approximate geography only: this is not provider or operational flight-path evidence. */
export function greatCircleRoute(origin: GroundedAirportRef, destination: GroundedAirportRef, steps = 64): LineString | null {
  if (!validCoordinate(origin) || !validCoordinate(destination) || !Number.isInteger(steps) || steps < 2 || steps > 512) return null;
  const lat1 = radians(origin.latitude), lon1 = radians(origin.longitude);
  const lat2 = radians(destination.latitude), lon2 = radians(destination.longitude);
  const dot = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const coordinates: [number, number][] = [];
  let previousLongitude = origin.longitude;
  for (let index = 0; index <= steps; index++) {
    const fraction = index / steps;
    let latitude: number, longitude: number;
    if (index === 0) {
      latitude = origin.latitude; longitude = origin.longitude;
    } else if (index === steps) {
      latitude = destination.latitude; longitude = destination.longitude;
    } else if (angle < 1e-10) {
      latitude = origin.latitude + (destination.latitude - origin.latitude) * fraction;
      longitude = origin.longitude + (destination.longitude - origin.longitude) * fraction;
    } else {
      const a = Math.sin((1 - fraction) * angle) / Math.sin(angle);
      const b = Math.sin(fraction * angle) / Math.sin(angle);
      const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
      const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
      const z = a * Math.sin(lat1) + b * Math.sin(lat2);
      latitude = degrees(Math.atan2(z, Math.sqrt(x * x + y * y)));
      longitude = degrees(Math.atan2(y, x));
    }
    while (longitude - previousLongitude > 180) longitude -= 360;
    while (longitude - previousLongitude < -180) longitude += 360;
    coordinates.push([longitude, latitude]);
    previousLongitude = longitude;
  }
  return { type: "LineString", coordinates };
}

export function selectedFlightRoute(selection: PlannerSelection, items: TripItem[]): FlightRoutePreview | null {
  if (selection?.type !== "tripItem") return null;
  const item = items.find((entry) => entry.id === selection.id);
  const origin = item?.type === "flight" ? item.flightDetails?.originAirport : null;
  const destination = item?.type === "flight" ? item.flightDetails?.destinationAirport : null;
  if (!item || !origin || !destination) return null;
  const geometry = greatCircleRoute(origin, destination);
  return geometry ? { itemId: item.id, origin, destination, geometry } : null;
}
