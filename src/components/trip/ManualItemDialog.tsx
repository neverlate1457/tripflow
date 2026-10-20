import { useEffect, useRef, useState } from "react";
import {
  explicitTransportModes,
  type Trip,
  type TripItemType,
  type GroundedPlaceRef,
  type GroundedAirportRef,
  type NormalizedPlace,
  type ConfirmedManualLocation,
} from "@/domain/models";
import {
  validateManualItemInput,
  type ManualItemErrors,
  type ManualItemInput,
  type MovementEdgeOption,
} from "@/domain/manual-items";
import { generateId } from "@/lib/id";
import { HttpPlaceSearchClient } from "@/services/client-place-search";
import { AirportSearchField } from "./AirportSearchField";
import { ManualLocationField } from "./ManualLocationField";

const choices: Array<{ type: TripItemType; label: string }> = [
  { type: "place", label: "Place / Activity" },
  { type: "restaurant", label: "Meal" },
  { type: "hotel", label: "Accommodation" },
  { type: "transport", label: "Transport" },
  { type: "flight", label: "Flight" },
  { type: "note", label: "Note" },
];
const minutes = (value: string) => {
  if (!/^\d{2}:\d{2}$/.test(value)) return Number.NaN;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};
export function GroundedTransportPlaceField({ label, value, onChange }: { label: string; value: GroundedPlaceRef | null; onChange: (value: GroundedPlaceRef | null) => void }) {
  const client = useRef(new HttpPlaceSearchClient()), request = useRef(0);
  const [query, setQuery] = useState(""), [results, setResults] = useState<NormalizedPlace[]>([]), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const id = ++request.current, timer = window.setTimeout(async () => { setLoading(true); try { const places = await client.current.search(query.trim()); if (id === request.current) setResults(places.slice(0, 5)); } finally { if (id === request.current) setLoading(false); } }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  return <div className="relative text-xs font-medium text-slate-600"><span>{label}</span>{value ? <div className="mt-1 flex items-center justify-between rounded-lg border bg-white px-3 py-2"><span className="truncate">{value.name}</span><button type="button" onClick={() => onChange(null)} className="text-rose-600">Clear</button></div> : <><input aria-label={label} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search provider-backed place" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"/>{loading && <p className="mt-1 text-[10px]">Searching…</p>}{results.length > 0 && <div className="absolute z-20 mt-1 max-h-32 w-full overflow-y-auto rounded-lg border bg-white shadow-lg">{results.map((place) => <button type="button" key={`${place.provider}:${place.providerPlaceId}`} className="block w-full border-b px-2 py-1.5 text-left" onClick={() => { onChange({ name: place.name, formattedAddress: place.address ?? null, latitude: place.location.latitude, longitude: place.location.longitude, provider: place.provider, providerPlaceId: place.providerPlaceId, timezone: null }); setQuery(""); setResults([]); }}>{place.name}</button>)}</div>}</>}</div>;
}
export function ManualItemDialog({
  trip,
  selectedDate,
  movementEdges,
  onCancel,
  onCreate,
  initialMapCoordinate = null,
}: {
  trip: Trip;
  selectedDate: string;
  movementEdges: MovementEdgeOption[];
  onCancel: () => void;
  onCreate: (input: ManualItemInput) => Promise<void>;
  initialMapCoordinate?: { latitude: number; longitude: number } | null;
}) {
  const [type, setType] = useState<TripItemType>("place"),
    [title, setTitle] = useState(""),
    [startDate, setStartDate] = useState(selectedDate),
    [endDate, setEndDate] = useState(selectedDate),
    [start, setStart] = useState("10:00"),
    [end, setEnd] = useState("11:00"),
    [address, setAddress] = useState(""),
    [location, setLocation] = useState<ConfirmedManualLocation | null>(null),
    [notes, setNotes] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [mode, setMode] =
      useState<(typeof explicitTransportModes)[number]>("train"),
    [service, setService] = useState(""),
    [serviceNumber, setServiceNumber] = useState(""),
    [originAirport, setOriginAirport] = useState<GroundedAirportRef | null>(null),
    [destinationAirport, setDestinationAirport] = useState<GroundedAirportRef | null>(null),
    [transportBehavior, setTransportBehavior] = useState<"standalone" | "replace_segment">("standalone"),
    [bindingId, setBindingId] = useState(""),
    [boardingPlace, setBoardingPlace] = useState<GroundedPlaceRef | null>(null),
    [alightingPlace, setAlightingPlace] = useState<GroundedPlaceRef | null>(null),
    [reservationEnabled, setReservationEnabled] = useState(false),
    [reservationProvider, setReservationProvider] = useState(""),
    [confirmationCode, setConfirmationCode] = useState(""),
    [errors, setErrors] = useState<ManualItemErrors>({}),
    [submitMessage, setSubmitMessage] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  const fieldRefs = useRef<
    Partial<
      Record<keyof ManualItemErrors, HTMLInputElement | HTMLSelectElement>
    >
  >({});
  const field =
    "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sage-500";
  const input = (): ManualItemInput => ({
    type,
    title,
    startDate,
    startMinutes: minutes(start),
    endDate,
    endMinutes: minutes(end),
    address,
    location,
    notes,
    reservation: reservationEnabled
      ? {
          id: generateId(),
          status: "confirmed",
          provider: reservationProvider || undefined,
          confirmationCode: confirmationCode || undefined,
        }
      : null,
    transportDetails:
      type === "transport"
        ? {
            mode,
            from: transportBehavior === "replace_segment" ? movementEdges.find((edge) => edge.id === bindingId)?.label.split(" → ")[0] ?? "" : from,
            to: transportBehavior === "replace_segment" ? movementEdges.find((edge) => edge.id === bindingId)?.label.split(" → ").at(-1) ?? "" : to,
            service: service || undefined,
            serviceNumber: serviceNumber || undefined,
            behavior: transportBehavior,
            boundFromEndpoint: transportBehavior === "replace_segment" ? movementEdges.find((edge) => edge.id === bindingId)?.fromEndpoint : undefined,
            boundToEndpoint: transportBehavior === "replace_segment" ? movementEdges.find((edge) => edge.id === bindingId)?.toEndpoint : undefined,
            boardingPlace: transportBehavior === "replace_segment" ? boardingPlace : null,
            alightingPlace: transportBehavior === "replace_segment" ? alightingPlace : null,
          }
        : null,
    flightDetails:
      type === "flight"
        ? {
            origin: originAirport?.iataCode ?? originAirport?.name ?? "",
            destination: destinationAirport?.iataCode ?? destinationAirport?.name ?? "",
            airline: service || undefined,
            flightNumber: serviceNumber || undefined,
            originAirport,
            destinationAirport,
          }
        : null,
  });
  const message = (key: keyof ManualItemErrors) =>
    errors[key] ? (
      <p className="mt-1 text-[10px] text-rose-600">{errors[key]}</p>
    ) : null;
  const serviceNumberLabel =
    type === "flight"
      ? "Flight No."
      : mode === "train"
        ? "Train No."
        : mode === "bus"
          ? "Bus / Route No."
          : mode === "ferry"
            ? "Ferry / Service No."
            : mode === "metro"
              ? "Line / Service"
              : "Service number";
  const submit = async () => {
    const value = input(),
      nextErrors = validateManualItemInput(value, trip);
    setErrors(nextErrors);
    const firstKey = Object.keys(nextErrors)[0] as
      keyof ManualItemErrors | undefined;
    if (firstKey) {
      setSubmitMessage(
        nextErrors[firstKey] ?? "Review the highlighted fields.",
      );
      requestAnimationFrame(() => {
        const target = fieldRefs.current[firstKey];
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus();
      });
      return;
    }
    setSubmitMessage(null);
    setSaving(true);
    try {
      await onCreate(value);
    } catch (reason) {
      if (import.meta.env.DEV)
        console.error(
          "Manual item creation failed",
          reason instanceof Error ? reason.message : "Unknown error",
        );
      setSubmitMessage("Could not add this item. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-[76] flex items-center justify-center bg-slate-950/30 p-4"
      role="presentation"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="safe-area-bottom max-h-[calc(100dvh-1rem)] w-full max-w-xl overflow-y-auto overscroll-contain rounded-2xl bg-[#fafbf8] p-4 shadow-2xl sm:max-h-[90vh] sm:p-6"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Add itinerary item</h2>
            <p className="text-xs text-slate-500">
              Create a canonical activity without a place provider.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm text-slate-500"
          >
            Cancel
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-600">
            Kind
            <select
              className={field}
              value={type}
              onChange={(event) => setType(event.target.value as TripItemType)}
            >
              {choices.map((choice) => (
                <option key={choice.type} value={choice.type}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          {!["transport", "flight"].includes(type) && (
            <label className="text-xs font-medium text-slate-600">
              Title
              <input
                ref={(element) => {
                  fieldRefs.current.title = element ?? undefined;
                }}
                className={field}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              {message("title")}
            </label>
          )}
        </div>
        {type === "transport" && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs"><p className="font-semibold">Transport behavior</p><label className="mt-2 flex items-center gap-2"><input type="radio" name="transport-behavior" checked={transportBehavior === "standalone"} onChange={() => setTransportBehavior("standalone")}/> Standalone transport</label><label className="mt-2 flex items-center gap-2"><input type="radio" name="transport-behavior" checked={transportBehavior === "replace_segment"} onChange={() => setTransportBehavior("replace_segment")}/> Replace travel between itinerary items</label>{transportBehavior === "replace_segment" && <label className="mt-3 block font-medium">Replace travel segment<select ref={(element) => { fieldRefs.current.binding = element ?? undefined; }} className={field} value={bindingId} onChange={(event) => setBindingId(event.target.value)}><option value="">Choose an adjacent movement…</option>{movementEdges.map((edge) => <option key={edge.id} value={edge.id}>{edge.label}</option>)}</select>{message("binding")}</label>}</div>}
        {["transport", "flight"].includes(type) && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {type === "transport" && transportBehavior === "standalone" && <label className="text-xs font-medium text-slate-600">
              From
              <input
                ref={(element) => {
                  fieldRefs.current.from = element ?? undefined;
                }}
                className={field}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              {message("from")}
            </label>}
            {type === "transport" && transportBehavior === "standalone" && <label className="text-xs font-medium text-slate-600">
              To
              <input
                ref={(element) => {
                  fieldRefs.current.to = element ?? undefined;
                }}
                className={field}
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
              {message("to")}
            </label>}
            {type === "transport" && (
              <label className="text-xs font-medium text-slate-600">
                Mode
                <select
                  ref={(element) => {
                    fieldRefs.current.mode = element ?? undefined;
                  }}
                  className={field}
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as typeof mode)
                  }
                >
                  {explicitTransportModes.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                {message("mode")}
              </label>
            )}
            <label className="text-xs font-medium text-slate-600">
              {type === "flight" ? "Airline" : "Operator / Service"}
              <input
                className={field}
                value={service}
                onChange={(event) => setService(event.target.value)}
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {serviceNumberLabel}
              <input
                className={field}
                value={serviceNumber}
                onChange={(event) => setServiceNumber(event.target.value)}
              />
            </label>
          </div>
        )}
        {type === "flight" && <div className="mt-3 grid grid-cols-2 gap-3"><AirportSearchField label="Origin airport" value={originAirport} onChange={setOriginAirport}/><AirportSearchField label="Destination airport" value={destinationAirport} onChange={setDestinationAirport}/>{(message("from") || message("to")) && <div className="col-span-2">{message("from")}{message("to")}</div>}</div>}
        {type === "transport" && transportBehavior === "replace_segment" && <div className="mt-3 grid grid-cols-2 gap-3"><GroundedTransportPlaceField label="Board at (optional)" value={boardingPlace} onChange={setBoardingPlace}/><GroundedTransportPlaceField label="Get off at (optional)" value={alightingPlace} onChange={setAlightingPlace}/></div>}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-600">
            Departure date
            <input
              ref={(element) => {
                fieldRefs.current.startDate = element ?? undefined;
              }}
              type="date"
              min={trip.startDate}
              max={trip.endDate}
              className={field}
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
            {message("startDate")}
          </label>
          <label className="text-xs font-medium text-slate-600">
            Departure time
            <input
              ref={(element) => {
                fieldRefs.current.startTime = element ?? undefined;
              }}
              type="time"
              step={type === "transport" || type === "flight" ? "60" : "900"}
              className={field}
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
            {message("startTime")}
          </label>
          <label className="text-xs font-medium text-slate-600">
            Arrival date
            <input
              ref={(element) => {
                fieldRefs.current.endDate = element ?? undefined;
              }}
              type="date"
              min={trip.startDate}
              max={trip.endDate}
              className={field}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
            {message("endDate")}
          </label>
          <label className="text-xs font-medium text-slate-600">
            Arrival time
            <input
              ref={(element) => {
                fieldRefs.current.endTime = element ?? undefined;
              }}
              type="time"
              step={type === "transport" || type === "flight" ? "60" : "900"}
              className={field}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
            {message("endTime")}
          </label>
        </div>
        {!['transport', 'flight', 'note'].includes(type) ? <div className="mt-3"><ManualLocationField value={location} initialMapCoordinate={initialMapCoordinate} onChange={(next) => { setLocation(next); if (next) { setAddress(next.formattedAddress ?? ""); if (!title.trim()) setTitle(next.displayName); } }}/></div> : <label className="mt-3 block text-xs font-medium text-slate-600">Address optional<input className={field} value={address} onChange={(event) => setAddress(event.target.value)}/></label>}
        <label className="mt-3 block text-xs font-medium text-slate-600">
          Notes optional
          <textarea
            rows={3}
            className={field}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={reservationEnabled}
            onChange={(event) => setReservationEnabled(event.target.checked)}
          />
          Add confirmed reservation details
        </label>
        {reservationEnabled && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className="text-xs">
              Provider
              <input
                className={field}
                value={reservationProvider}
                onChange={(event) => setReservationProvider(event.target.value)}
              />
            </label>
            <label className="text-xs">
              Confirmation code
              <input
                className={field}
                value={confirmationCode}
                onChange={(event) => setConfirmationCode(event.target.value)}
              />
            </label>
          </div>
        )}
        {submitMessage && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-rose-50 p-2 text-xs font-medium text-rose-700"
          >
            {submitMessage}
          </p>
        )}
        <button
          disabled={saving}
          className="mt-5 w-full rounded-lg bg-sage-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add to Timeflow"}
        </button>
      </form>
    </div>
  );
}
