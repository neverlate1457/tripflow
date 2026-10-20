import { useEffect, useState } from "react";
import { Clock3, Save, Trash2, X } from "lucide-react";
import {
  explicitTransportModes,
  itemTypes,
  type Trip,
  type TripItem,
  type ConfirmedManualLocation,
} from "@/domain/models";
import {
  formatClock,
  localDateKey,
  minutesOfDay,
  type TripItemEdit,
} from "@/domain/time";
import {
  firstManualItemError,
  validateFlightDetails,
  validateTransportDetails,
  type MovementEdgeOption,
} from "@/domain/manual-items";
import { generateId } from "@/lib/id";
import { segmentEndpointKey } from "@/domain/routing";
import { GroundedTransportPlaceField } from "./ManualItemDialog";
import { AirportSearchField } from "./AirportSearchField";
import { normalizeFlightDetails, validateFlightWallClock } from "@/domain/flight";
import { ManualLocationField } from "./ManualLocationField";

const itemManualLocation = (item: TripItem): ConfirmedManualLocation | null => item.locationSource === "manual" && item.latitude != null && item.longitude != null ? {
  displayName: item.title,
  originalInput: item.originalLocationInput ?? null,
  formattedAddress: item.address,
  latitude: item.latitude,
  longitude: item.longitude,
  provider: item.provider ?? null,
  providerPlaceId: item.placeId,
  source: "manual",
} : null;

function parseClock(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function TripItemEditor({
  item,
  timezone,
  trip,
  onClose,
  onSave,
  onDelete,
  movementEdges,
}: {
  item: TripItem;
  timezone: string;
  onClose: () => void;
  onSave: (edit: TripItemEdit) => Promise<void>;
  onDelete: () => void;
  movementEdges: MovementEdgeOption[];
  trip: Trip;
}) {
  const originTimezone = item.flightDetails?.originAirport?.timezone ?? timezone;
  const destinationTimezone = item.flightDetails?.destinationAirport?.timezone ?? timezone;
  const start = minutesOfDay(item.startAt, originTimezone);
  const [draft, setDraft] = useState({
    title: item.title,
    type: item.type,
    start: formatClock(start),
    end: formatClock(minutesOfDay(item.endAt, destinationTimezone)),
    startDate: localDateKey(item.startAt, originTimezone),
    endDate: localDateKey(item.endAt, destinationTimezone),
    address: item.address ?? "",
    notes: item.notes ?? "",
    flexibility: item.flexibility,
  });
  const [constraint, setConstraint] = useState(item.schedulingConstraint);
  const [reservation, setReservation] = useState(item.reservation);
  const [transportDetails, setTransportDetails] = useState(
    item.transportDetails,
  );
  const [flightDetails, setFlightDetails] = useState(item.flightDetails);
  const [manualLocation, setManualLocation] = useState<ConfirmedManualLocation | null>(itemManualLocation(item));
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const nextOriginTimezone = item.flightDetails?.originAirport?.timezone ?? timezone;
    const nextDestinationTimezone = item.flightDetails?.destinationAirport?.timezone ?? timezone;
    const nextStart = minutesOfDay(item.startAt, nextOriginTimezone);
    setDraft({
      title: item.title,
      type: item.type,
      start: formatClock(nextStart),
      end: formatClock(minutesOfDay(item.endAt, nextDestinationTimezone)),
      startDate: localDateKey(item.startAt, nextOriginTimezone),
      endDate: localDateKey(item.endAt, nextDestinationTimezone),
      address: item.address ?? "",
      notes: item.notes ?? "",
      flexibility: item.flexibility,
    });
    setConstraint(item.schedulingConstraint);
    setReservation(item.reservation);
    setTransportDetails(item.transportDetails);
    setFlightDetails(item.flightDetails);
    setManualLocation(itemManualLocation(item));
  }, [
    item.id,
    item.startAt,
    item.endAt,
    item.title,
    item.type,
    item.address,
    item.notes,
    timezone,
  ]);

  const save = async () => {
    const detailsErrors =
      draft.type === "transport"
        ? validateTransportDetails(transportDetails)
        : draft.type === "flight"
          ? validateFlightDetails(flightDetails)
          : {};
    const error = firstManualItemError(detailsErrors);
    setDetailsError(error);
    if (error) return;
    if (draft.type === "flight" && flightDetails) {
      const flightErrors = validateFlightWallClock({ startDate: draft.startDate, startMinutes: parseClock(draft.start), endDate: draft.endDate, endMinutes: parseClock(draft.end), details: flightDetails, fallbackTimezone: timezone }, trip);
      const flightError = Object.values(flightErrors)[0];
      if (flightError) { setDetailsError(flightError); return; }
    }
    setSaving(true);
    try { await onSave({
      title:
        draft.type === "transport"
          ? `${transportDetails!.from.trim()} → ${transportDetails!.to.trim()}`
          : draft.type === "flight"
            ? `${flightDetails!.origin.trim()} → ${flightDetails!.destination.trim()}`
            : draft.title,
      type: draft.type,
      startMinutes: parseClock(draft.start),
      endMinutes: parseClock(draft.end),
      startDate: draft.type === "transport" || draft.type === "flight" ? draft.startDate : undefined,
      endDate: draft.type === "transport" || draft.type === "flight" ? draft.endDate : undefined,
      address: (manualLocation?.formattedAddress ?? draft.address) || null,
      notes: draft.notes || null,
      flexibility: draft.flexibility,
      schedulingConstraint: constraint,
      reservation,
      transportDetails,
      flightDetails: draft.type === "flight" && flightDetails ? normalizeFlightDetails(flightDetails) : flightDetails,
      ...(manualLocation ? { latitude: manualLocation.latitude, longitude: manualLocation.longitude, provider: manualLocation.provider, placeId: manualLocation.providerPlaceId, locationSource: "manual" as const, originalLocationInput: manualLocation.originalInput } : item.locationSource === "manual" ? { latitude: null, longitude: null, placeId: null, provider: null, locationSource: null, originalLocationInput: null } : {}),
    }); onClose(); }
    catch (reason) { setDetailsError(reason instanceof Error && reason.message === "INVALID_ITEM_CHRONOLOGY" ? "Arrival must be after departure by at least 15 minutes." : "Could not save this item. Please try again."); }
    finally { setSaving(false); }
  };
  const fieldClass =
    "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-100";
  const departureTimezone = draft.type === "flight" ? flightDetails?.originAirport?.timezone ?? timezone : timezone;
  const arrivalTimezone = draft.type === "flight" ? flightDetails?.destinationAirport?.timezone ?? timezone : timezone;
  return (
    <aside className="safe-area-bottom fixed inset-x-0 bottom-0 top-[max(4rem,env(safe-area-inset-top))] z-50 w-full overflow-y-auto overscroll-contain border-l border-slate-200 bg-[#fafbf8] shadow-[-18px_0_40px_rgba(29,49,40,0.12)] sm:left-auto sm:top-[130px] sm:w-[360px]">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Edit activity</h2>
          <p className="text-[11px] text-slate-500">{item.type === "flight" && item.flightDetails?.originAirport ? "Times follow each airport timezone" : `Times follow ${timezone}`}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        >
          <X size={16} />
        </button>
      </div>
      <div className="space-y-4 p-5">
        <label className="block text-xs font-medium text-slate-600">
          Title
          <input
            className={fieldClass}
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Type
          <select
            className={fieldClass}
            value={draft.type}
            onChange={(event) =>
              setDraft({
                ...draft,
                type: event.target.value as TripItem["type"],
              })
            }
          >
            {itemTypes.map((type) => (
              <option key={type} value={type}>
                {type[0].toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <div>
          <div className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
            <Clock3 size={12} /> Time
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(draft.type === "transport" || draft.type === "flight") && <><label className="text-[10px] text-slate-500">Departure date<input type="date" min={trip.startDate} max={trip.endDate} className={fieldClass} value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}/></label><label className="text-[10px] text-slate-500">Arrival date<input type="date" min={trip.startDate} max={trip.endDate} className={fieldClass} value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}/></label></>}
            <label className="text-[10px] text-slate-500">
              {draft.type === "flight" ? `Departure · ${departureTimezone}` : "Start"}
              <input
                type="time"
                step={draft.type === "transport" || draft.type === "flight" ? "60" : "900"}
                className={fieldClass}
                value={draft.start}
                onChange={(event) =>
                  setDraft({ ...draft, start: event.target.value })
                }
              />
            </label>
            <label className="text-[10px] text-slate-500">
              {draft.type === "flight" ? `Arrival · ${arrivalTimezone}` : "End"}
              <input
                type="time"
                step={draft.type === "transport" || draft.type === "flight" ? "60" : "900"}
                className={fieldClass}
                value={draft.end === "24:00" ? "23:59" : draft.end}
                onChange={(event) =>
                  setDraft({ ...draft, end: event.target.value })
                }
              />
            </label>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            {draft.type === "flight" ? "Flight times preserve exact local minutes; minimum duration is 15 minutes." : "Saved times snap to 15 minutes with a 15-minute minimum."}
          </p>
        </div>
        {!['transport', 'flight', 'note'].includes(draft.type) && (item.locationSource === "manual" || item.latitude == null || item.longitude == null) ? <div><p className="mb-1 text-xs font-medium text-slate-600">Confirmed location</p><ManualLocationField value={manualLocation} onChange={(next) => { setManualLocation(next); setDraft({ ...draft, address: next?.formattedAddress ?? "", ...(next ? { title: next.displayName } : {}) }); }}/></div> : <label className="block text-xs font-medium text-slate-600">Address<input className={fieldClass} value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })}/></label>}
        <label className="block text-xs font-medium text-slate-600">
          Notes
          <textarea
            rows={5}
            className={`${fieldClass} resize-none`}
            value={draft.notes}
            onChange={(event) =>
              setDraft({ ...draft, notes: event.target.value })
            }
          />
        </label>
        {draft.type === "transport" && (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <div className="col-span-2 text-[10px]"><p className="font-semibold">Transport behavior</p><label className="mt-1 flex gap-2"><input type="radio" checked={(transportDetails?.behavior ?? "standalone") === "standalone"} onChange={() => setTransportDetails({ ...transportDetails!, behavior: "standalone", boundFromEndpoint: undefined, boundToEndpoint: undefined })}/> Standalone transport</label><label className="mt-1 flex gap-2"><input type="radio" checked={transportDetails?.behavior === "replace_segment"} onChange={() => setTransportDetails({ ...transportDetails!, behavior: "replace_segment" })}/> Replace travel between itinerary items</label></div>
            {transportDetails?.behavior === "replace_segment" && <label className="col-span-2 text-[10px]">Replace travel segment<select className={fieldClass} value={transportDetails.boundFromEndpoint && transportDetails.boundToEndpoint ? `${segmentEndpointKey(transportDetails.boundFromEndpoint)}--${segmentEndpointKey(transportDetails.boundToEndpoint)}` : ""} onChange={(event) => { const edge = movementEdges.find((value) => value.id === event.target.value); if (edge) setTransportDetails({ ...transportDetails, from: edge.label.split(" → ")[0], to: edge.label.split(" → ").at(-1)!, boundFromEndpoint: edge.fromEndpoint, boundToEndpoint: edge.toEndpoint }); }}><option value="">Choose an adjacent movement…</option>{movementEdges.map((edge) => <option key={edge.id} value={edge.id}>{edge.label}</option>)}</select></label>}
            {(transportDetails?.behavior ?? "standalone") === "standalone" && <label className="text-[10px]">
              Mode
              <select
                className={fieldClass}
                value={transportDetails?.mode ?? "train"}
                onChange={(event) =>
                  setTransportDetails({
                    ...transportDetails,
                    mode: event.target.value as NonNullable<
                      TripItem["transportDetails"]
                    >["mode"],
                    from: transportDetails?.from ?? "",
                    to: transportDetails?.to ?? "",
                  })
                }
              >
                {explicitTransportModes.map((mode) => (
                  <option key={mode}>{mode}</option>
                ))}
              </select>
            </label>}
            {(transportDetails?.behavior ?? "standalone") === "standalone" && <label className="text-[10px]">
              Service
              <input
                className={fieldClass}
                value={transportDetails?.service ?? ""}
                onChange={(event) =>
                  setTransportDetails({
                    ...transportDetails,
                    mode: transportDetails?.mode ?? "train",
                    from: transportDetails?.from ?? "",
                    to: transportDetails?.to ?? "",
                    service: event.target.value || undefined,
                  })
                }
              />
            </label>}
            {transportDetails?.behavior === "replace_segment" && <><GroundedTransportPlaceField label="Board at (optional)" value={transportDetails.boardingPlace ?? null} onChange={(place) => setTransportDetails({ ...transportDetails, boardingPlace: place })}/><GroundedTransportPlaceField label="Get off at (optional)" value={transportDetails.alightingPlace ?? null} onChange={(place) => setTransportDetails({ ...transportDetails, alightingPlace: place })}/></>}
            <label className="text-[10px]">
              From
              <input
                className={fieldClass}
                value={transportDetails?.from ?? ""}
                onChange={(event) =>
                  setTransportDetails({
                    ...transportDetails,
                    mode: transportDetails?.mode ?? "train",
                    from: event.target.value,
                    to: transportDetails?.to ?? "",
                  })
                }
              />
            </label>
            <label className="text-[10px]">
              To
              <input
                className={fieldClass}
                value={transportDetails?.to ?? ""}
                onChange={(event) =>
                  setTransportDetails({
                    ...transportDetails,
                    mode: transportDetails?.mode ?? "train",
                    from: transportDetails?.from ?? "",
                    to: event.target.value,
                  })
                }
              />
            </label>
          </div>
        )}
        {draft.type === "flight" && (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3">
            {flightDetails?.originAirport && flightDetails.destinationAirport ? <>
              <AirportSearchField label="Origin airport" value={flightDetails.originAirport} onChange={(airport) => airport && setFlightDetails({ ...flightDetails, origin: airport.iataCode ?? airport.name, originAirport: airport })}/>
              <AirportSearchField label="Destination airport" value={flightDetails.destinationAirport} onChange={(airport) => airport && setFlightDetails({ ...flightDetails, destination: airport.iataCode ?? airport.name, destinationAirport: airport })}/>
            </> : <>
            <label className="text-[10px]">
              Origin (legacy ungrounded)
              <input
                className={fieldClass}
                value={flightDetails?.origin ?? ""}
                onChange={(event) =>
                  setFlightDetails({
                    ...flightDetails,
                    origin: event.target.value,
                    destination: flightDetails?.destination ?? "",
                  })
                }
              />
            </label>
            <label className="text-[10px]">
              Destination (legacy ungrounded)
              <input
                className={fieldClass}
                value={flightDetails?.destination ?? ""}
                onChange={(event) =>
                  setFlightDetails({
                    ...flightDetails,
                    origin: flightDetails?.origin ?? "",
                    destination: event.target.value,
                  })
                }
              />
            </label>
            </>}
            <label className="text-[10px]">
              Airline
              <input
                className={fieldClass}
                value={flightDetails?.airline ?? ""}
                onChange={(event) =>
                  setFlightDetails({
                    ...flightDetails,
                    origin: flightDetails?.origin ?? "",
                    destination: flightDetails?.destination ?? "",
                    airline: event.target.value || undefined,
                  })
                }
              />
            </label>
            <label className="text-[10px]">
              Flight number
              <input
                className={fieldClass}
                value={flightDetails?.flightNumber ?? ""}
                onChange={(event) =>
                  setFlightDetails({
                    ...flightDetails,
                    origin: flightDetails?.origin ?? "",
                    destination: flightDetails?.destination ?? "",
                    flightNumber: event.target.value || undefined,
                  })
                }
              />
            </label>
          </div>
        )}
        {detailsError && (
          <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
            {detailsError}
          </p>
        )}
        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold">
            Scheduling
          </summary>
          <label className="mt-3 block text-xs">
            Flexibility
            <select
              className={fieldClass}
              value={draft.flexibility}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  flexibility: event.target.value as TripItem["flexibility"],
                })
              }
            >
              <option value="flexible">Flexible</option>
              <option value="fixed">Fixed</option>
            </select>
          </label>
          {(
            [
              "earliestStartAt",
              "latestStartAt",
              "earliestEndAt",
              "latestEndAt",
            ] as const
          ).map((key) => (
            <label key={key} className="mt-2 block text-[10px] capitalize">
              {key.replace(/([A-Z])/g, " $1")}
              <input
                className={fieldClass}
                placeholder="ISO timestamp"
                value={constraint?.[key] ?? ""}
                onChange={(e) =>
                  setConstraint({
                    ...constraint,
                    [key]: e.target.value || undefined,
                  })
                }
              />
            </label>
          ))}
        </details>
        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold">
            Reservation
          </summary>
          <select
            aria-label="Reservation status"
            className={fieldClass}
            value={reservation?.status ?? ""}
            onChange={(e) =>
              setReservation(
                e.target.value
                  ? {
                      ...(reservation ?? { id: generateId() }),
                      status: e.target.value as
                        "confirmed" | "pending" | "cancelled",
                    }
                  : null,
              )
            }
          >
            <option value="">No reservation</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {reservation && (
            <div>
              {(
                [
                  "provider",
                  "confirmationCode",
                  "reservationAt",
                  "checkInAt",
                  "checkOutAt",
                  "url",
                  "notes",
                ] as const
              ).map((key) => (
                <label key={key} className="mt-2 block text-[10px] capitalize">
                  {key.replace(/([A-Z])/g, " $1")}
                  <input
                    className={fieldClass}
                    value={reservation[key] ?? ""}
                    onChange={(e) =>
                      setReservation({
                        ...reservation,
                        [key]: e.target.value || undefined,
                      })
                    }
                  />
                </label>
              ))}
            </div>
          )}
        </details>
        <div className="flex gap-2 border-t border-slate-200 pt-4">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-sage-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sage-700"
          >
            <Save size={14} /> {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-rose-200 px-3 text-rose-600 hover:bg-rose-50"
            aria-label="Delete activity"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
