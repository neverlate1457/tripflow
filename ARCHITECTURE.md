# TripFlow architecture

## Repository audit

The repository was empty at the start of Phase 1: there was no package manifest,
source tree, build configuration, Git metadata, or reusable application code.
TripFlow therefore starts with a small Astro application rather than replacing
any existing infrastructure.

## Phase 1 structure

- `src/pages` owns Astro routes and API endpoints.
- `src/components` owns UI. The planner is a React island split by product area.
- `src/domain` contains framework-independent types and itinerary operations.
- `src/stores` coordinates client state through Zustand.
- `src/data` contains demo fixtures only.
- `src/db` owns Drizzle schemas and the SQLite adapter.
- `src/services` defines persistence-facing interfaces and implementations.
- `src/lib` contains reusable technical utilities.

The React UI depends on the planner store and domain operations, never directly
on Drizzle. Persistence is exposed through a service/API boundary so SQLite can
later be replaced by PostgreSQL without changing planner components.

## State and interaction model

One `DndContext` wraps Planner Explore, Map, and the selected day's Timeflow.
Candidates and scheduled items use distinct drag payloads. Timeflow converts
pointer position to a 15-minute-snapped local time and delegates Candidate
conversion or item movement to the store. Resize interactions use pointer
capture and the same time utilities.

The separate Itinerary route projects every trip date onto a shared horizontal
06:00–24:00 calendar. It is read-only in Phase 6.7: calendar geometry, overlap
lanes, selected overview date, and scroll position are ephemeral presentation
state. It creates no calendar-specific TripItem or persisted layout model.
Activity and day links return to Planner with date/item focus. Derived effective
movement uses the existing bound-Transport/manual-duration/provider precedence.
Day Start/End travel without an authoritative timestamp remains contextual in
the date header rather than receiving a fabricated time-grid position.

All canonical itinerary values are ISO datetimes. Day filtering and ordinary
wall-clock placement use the trip timezone; grounded Flight editing is the
documented exception and uses each airport timezone. Date/time math, snapping,
movement, resizing, and overlap detection live outside components and are
covered by unit tests.

## Phase 1.5 persistence

`TripPlanner` hydrates a trip by id after the React island mounts. The Zustand
store exposes explicit initial, loading, loaded, and error states and accepts an
injectable `TripPersistence`, so store tests do not require HTTP. The production
adapter validates API snapshots at runtime, while `PersistenceCoordinator`
serializes optimistic saves to prevent an older request from overwriting a
newer state.

Committed itinerary mutations record one bounded history snapshot, update the
UI immediately, and persist the resulting full trip snapshot. Resize uses local
component preview state and commits only on pointer-up. Undo and redo restore
the item/candidate snapshot and persist it like any other mutation. The API can
later add revision tokens to this coordinator without changing UI components.

## Extension seams

- Place and map providers can populate Candidates without changing TripItems.
- Routing and automatic travel segments can be domain/services features.
- Rich flight/hotel/weather fields can be separate metadata tables.
- Sharing and collaboration can replace the HTTP persistence implementation.
- Mobile can provide another presentation over the same store/domain actions.
- A future planner agent can call the same itinerary operations as the UI.

## Phase 2 places and maps

The root route owns trip management while `/trips/:id` mounts the existing
planner for a dynamic trip. `PlaceProvider` normalizes external responses into
`NormalizedPlace`; only the server-side Geoapify adapter sees provider response
shapes. Search results remain ephemeral in Zustand. Adding one maps it into the
minimal persisted Candidate fields, including provider identity for duplicate
prevention.

Planner selection is a single discriminated union covering TripItems,
Candidates, and search results. Explore, MapLibre, and Timeflow consume that
shared state. The map boundary owns provider-specific markers/camera behavior;
it does not introduce imperative component-to-component synchronization.

## Phase 3 routing

TripItems remain canonical user data. `deriveSegmentSpecs` builds adjacent,
same-day connections between chronological location activities. Notes, flights,
explicit transport items, missing coordinates, and cross-day pairs are excluded.
`TravelSegment` is client-derived state with an explicit routing lifecycle; it
is never saved in itinerary history or represented as a TripItem.

The browser calls `/api/routes` with trip/item identities and a normalized mode.
The server re-derives eligibility, keeps the Geoapify credential private, and
caches normalized duration, distance, and GeoJSON LineString data in SQLite for
30 days. Canonical mutations reconcile segments only after commit; unchanged
loaded relationships are reused. Undo and redo restore TripItems and then derive
routing again without recording cache updates as user history.

## Phase 4 canonical and derived scheduling data

Canonical data now includes Trip, TripItem, each item's flexibility and optional
scheduling window, one optional structured Reservation per item, and minimal
SegmentPreferences for user-selected travel modes. These values are persisted,
runtime-validated, and included in planner undo/redo history.

TravelSegments and DayFeasibility issues remain derived from canonical items,
preferences, and loaded routes. They never create independent history entries
or override TripItem times. Route results remain cached data with a 30-day TTL;
expired rows are deleted opportunistically whenever the routing API is used.

Fixed items reject normal drag and resize actions at both the UI and store
boundaries, while explicit editor changes remain allowed. Flexible window
violations are allowed and reported, preserving user control without silently
rearranging the itinerary.

## Phase 5 deterministic planning

`src/domain/planning.ts` is a framework-independent proposal engine. It consumes
an immutable day snapshot and returns ranked `ScheduleProposal` values. It never
imports Zustand, persistence, React, or database code. A proposal is ephemeral
until the user explicitly applies it. Timeflow renders the proposed snapshot as
dashed ghost cards while the canonical cards remain unchanged and dimmed.

The change vocabulary is `move_item`, `resize_item`, and `schedule_candidate`.
Fixed TripItems are excluded from repair moves and remain anchors. Malformed
windows make a repair unsupported; scheduling windows remain soft warnings,
matching Phase 4 semantics. Applying all changes calls one store commit, creating
one history entry and persistence operation before route reconciliation and
derived feasibility recalculation.

Lower scores are better. Central weights are: unresolved error 100000,
reservation conflict 25000, travel infeasibility 15000, unresolved warning
10000, scheduling-window warning 2500, changed item 500, moved minute 5,
travel-increase minute 2, and excess idle minute 0.1. Proposal id is the stable
final tie-breaker.

Search is bounded to a 15-minute grid, 12 hours, 2,500 states, eight flexible
repair items, five returned proposals, and ten unique hypothetical route
lookups. Candidate insertion keeps the best result per neighboring pair. An
injected route-estimate source permits normalized cached estimates without
provider coupling. Lookups are deduplicated and budgeted; absent optional data
produces limited confidence, while required missing data produces a structured
`MISSING_ROUTING_DATA` result.

- Canonical: Trip, TripItem, Candidate, SchedulingConstraint, Reservation,
  SegmentPreference.
- Derived: TravelSegment, DayFeasibility, ScheduleProposal.
- Cached: normalized route results.
- Ephemeral: solver lifecycle/result and proposal preview.

## Phase 5.5 route preparation and bounded repair

Hypothetical routing is prepared in the application layer before solving.
`discoverCandidateRouteEdges` emits identity-based, provider-independent route
requests. `planning-route-preparation` deduplicates and caps those requests,
then calls `/api/routes/estimate`. The server resolves TripItem/Candidate IDs
against the trip snapshot, so callers cannot submit arbitrary coordinates, and
uses the same normalized 30-day route cache as ordinary TravelSegments. The
core solver receives only serializable `PreparedRouteEstimate` values.

Candidate solve lifecycle is `idle → preparing_routes → solving → ready`, with
structured unsupported/error/cancelled outcomes. An AbortController cancels
HTTP preparation where supported, while a monotonically increasing request ID
prevents every stale preparation or solver result from reaching Zustand.
Canonical state is never touched by preparation or cancellation.

Repair uses a deterministic beam search over a 15-minute grid. The repair
region is the contiguous flexible block around the triggering issue, bounded by
the nearest fixed anchors. Durations and activity order are preserved. Each
beam step rejects fixed-anchor or preceding-activity overlap, ranks partial
states by movement and stable signature, and evaluates final states with the
same DayFeasibility and prepared travel data used for scoring. Limits are eight
flexible items, 32 beam states, 5,000 evaluated states, a ±180-minute movement
window per item, and five returned proposals. Candidate insertion retains the
12-hour placement horizon and ten-route preparation budget.

Confidence is `full` only when every relevant adjacent travel edge is known,
`limited` when missing non-essential data still permits a meaningful result,
and `insufficient` is reserved for result vocabulary; essential missing data
returns structured `MISSING_ROUTING_DATA` rather than a feasible proposal.
Metrics derive from the evaluated before/after states: error/warning counts,
resolved counts, modified items, total movement, travel time before/after and
delta, minimum travel buffer, and non-negative aggregate idle time.

Proposal map state is ephemeral. MapLibre highlights every changed item and,
for insertion, the Candidate plus previous/next neighbors. Prepared geometries
are rendered in a dedicated dashed GeoJSON source/layer that is removed on
cancel or proposal change.

Measured bounded searches remained below the threshold for a Web Worker, so
Phase 5.5 yields before solving and uses cancellation/stale-result protection
without adding worker complexity. If the state/region limits are raised later,
the serializable solver boundary is ready to move into a worker.

The planner now lazy-loads MapLibre, TripItemEditor, and ProposalPreview. The
main planner chunk fell from approximately 1,156 KB to 107 KB. MapLibre remains
an isolated approximately 1,050 KB on-demand chunk; editor and proposal chunks
are approximately 6 KB each.

## Phase 6 AI intent boundary

Configured Ollama and OpenAI providers are the primary semantic interpreters.
Their structured result is preserved when it passes strict runtime validation;
language-specific discovery regexes do not overwrite valid provider output. The
deterministic Mock provider retains the bounded parser for offline tests.

The model selects only bounded application capabilities: `resolve_location`,
`discover_places`, `calculate_route`, `inspect_itinerary`, and
`propose_schedule_change`. These are not arbitrary model-executed tools.
Grounding, route evidence, solver validation, proposal preview, explicit Apply,
and persistence remain deterministic. Invalid structured output may receive one
bounded model repair and is then validated again; there is no silent Mock or
regex fallback. Discovery scopes are `nearby_point`, `city_area`, `corridor`,
and `trip_context`; corridor endpoints are grounded independently.

Authority is explicit: the user applies; the deterministic planner proposes;
AI only interprets or explains. `PlanningAIProvider` is server-only and returns
untrusted output. Strict runtime validation rejects unknown fields, invalid or
out-of-trip dates, invented Candidate/proposal IDs, invalid duration/mode/pace,
and every unsupported intent before application code can act.

Supported intents are `repair_day`, `insert_candidate`, `explain_issues`, and
`explain_proposal`. There is no generic update tool and no AI path to commit,
repositories, persistence, arbitrary timestamps, proposed changes, deletion,
reservations, constraints, or flexibility. Valid planning intents call existing
deterministic services and reuse ScheduleProposal and ProposalPreview.

Production uses OpenAI Responses Structured Outputs behind the provider
abstraction. The API key is server-only; model selection is environmental.
Development can use a deterministic mock. Context is limited to trip/date
identity, item IDs/titles/types/flexibility, Candidate IDs/titles/types/duration,
structured issues, and proposal IDs. Notes, reservation secrets, provider raw
data, caches, database metadata, and unrelated trips are excluded. Titles are
untrusted JSON data, never privileged prompt instructions.

Each explicit request permits one compact interpretation call. Expected latency
is provider/network bound (normally a few seconds), while cost remains small
relative to unrestricted chat because context and output are capped. Exact cost
follows the configured model's current provider pricing.

`/api/ai/planning-intent` derives context from the repository using only trip ID
and never accepts browser-supplied canonical state. Guardrails are 500 message
characters, 50 context records, a 15-second timeout, one call per submission,
AbortController plus stale-request sequencing, and no prompt/response or chat
history persistence. Diagnostics contain only provider, model, latency, status,
and validation outcome. Pace is validated advisory metadata in Phase 6; the
balanced deterministic score remains authoritative.

### Local Ollama adapter

`OllamaPlanningAIProvider` implements the same server-only
`PlanningAIProvider` contract through Ollama `/api/chat`. Selection is explicit
through `PLANNING_AI_PROVIDER=ollama`; no OpenAI credential is read and there is
no automatic provider fallback. The configured JSON Schema is sent as Ollama's
`format`, temperature is zero, streaming is disabled, and the returned message
is still treated as untrusted input to `validateInterpretation`.

Ollama receives the same minimized context and has no access to Zustand,
persistence, Candidate/TripItem creation, proposal application, PlaceProvider,
or canonical timestamps. Abort and timeout behavior matches the OpenAI adapter.
Its timeout is independently configurable and defaults to 60 seconds for cold
local model loading; OpenAI retains its existing 15-second timeout. Diagnostics
report `ollama`, the configured model, request latency, and runtime
validation outcome; raw prompts and responses are not persisted.

### Development AI trace

`TRIPFLOW_AI_DEBUG=true` enables a development-only, 15-entry in-memory trace
store keyed by request UUID. Async request scoping prevents concurrent provider
calls from mixing prompt and response stages. The API records the real
pre-classifier, minimized context, provider payload/schema, raw provider result,
parse/validation, normalization, entity resolution, and final routing. The
browser may append sanitized solver input/result and frontend-rendering evidence
for the same request ID. A bounded typed timeline distinguishes LLM, runtime
validation, deterministic planning, place/route providers, cache, and frontend
producers with provider/model, status, duration, summaries, and fallback reason.

The debug endpoint fails closed with 404 unless both development mode and the
server setting are active. Trace data is never canonical, never persisted, and
cannot invoke a planner mutation. Recursive key-based redaction removes
authorization, cookie, API-key, secret, token, and password values.
Prompt-like content is omitted unless both `TRIPFLOW_AI_DEBUG=true` and
`TRIPFLOW_AI_DEBUG_INCLUDE_CONTENT=true` are set in development. With both
enabled, each Ollama call records its exact credential-free outbound request
(messages, schema, model, and generation options) and raw/parsed response as a
separate bounded in-memory timeline event. Structured repair never overwrites
the initial interpretation event. Production provenance always removes these
payloads regardless of configuration.
Outside development the endpoint exposes only the bounded, safe typed timeline
needed to verify source badges; detailed stage payloads stay development-only.

Assistant-visible text carries `AssistantMessageProvenance` from its creation
point: producer type/stage, provider/model, request ID, optional trace-event ID,
and any deterministic transformation layers. The UI renders this as an always-
visible source badge; it never infers authorship from wording or provider
configuration. Unverified provenance is rendered as `Source unknown`.

## Phase 6.5 grounded place discovery

Discovery carries an explicit ephemeral scope: `city_area`, `nearby_point`, or
`corridor`. Explicit user geography is resolved from a bounded Geoapify
candidate set using normalized name and requested feature-type evidence. It is
never replaced by Trip Destination or DayContext after resolution fails;
ambiguous and unresolved references return a bounded failure instead. City-area
retrieval uses the accepted provider place boundary, while nearby discovery uses
the accepted point with strong proximity ranking.

Provider-grounded canonical geographic context is never degraded into free
text and globally re-resolved merely to perform discovery. Explicit user
geography follows `text → provider grounding`; canonical fallback geography
(DayContext Base or Trip Destination) reuses its coordinates and provider place
identity directly. An unnamed general recommendation uses a grounded Trip
Destination as `city_area`, while unnamed nearby wording retains
`nearby_point` semantics.

Requested categories are deterministic hard eligibility gates. Results are not
padded with unrelated categories, and unknown detour evidence cannot satisfy a
stated maximum. Corridor discovery loads cached/provider route geometry, samples
up to five deterministic windows by route distance, merges and deduplicates
provider results, measures distance against the full route polyline, and uses
provider routes for shortlisted detours. Place-window and route lookup budgets
are both capped at ten. Anchors, geometries, candidates, diagnostics, and
suggestions remain ephemeral; discovery never mutates Trip Destination.

The assistant may now return a strictly validated `discover_places` intent with
bounded categories, themes, date/time window, duration, and travel mode. It may
not return coordinates or a place identity. The server derives an anchor from
located activities around the requested window (neighbor midpoint, one neighbor,
then a located day activity) and queries the existing `PlaceProvider`.

Only `NormalizedPlace` values returned by that provider enter deterministic
ranking. `PlaceSuggestion` is ephemeral and retains provider identity,
attribution, structured reasons, distance, available-window context, and route
confidence. Empty provider results remain empty. Suggestions never become
TripItems or Candidates automatically.

Ranking is deterministic and lower-is-better. Weights are provider order 20,
distance 4 per kilometer, category mismatch 40, theme mismatch 30, detour 2 per
minute, duplicate 1000, and missing-route limitation 8. Limits are 20 provider
results, 10 displayed suggestions, a five-place routing shortlist, and at most
10 route estimates. The server reuses `routeWithCache` for the baseline and
shortlisted neighboring edges. Failed or missing routes retain limited confidence;
detour and fixed-anchor reachability are reported only from known estimates.

The canonical transition remains `PlaceSuggestion → explicit Add to trip →
placeToCandidate → Candidate`. Scheduling then uses the existing manual drag or
deterministic Candidate insertion proposal and explicit Apply flow. Discovery
markers and selection are cleared with the result set and are never persisted.

## Core editing and provenance

Manual creation uses `createManualTripItem`, not provider search. It creates a
canonical TripItem in one planner commit and supports activities, meals,
accommodation, notes, explicit transport, and flights. Transport and flight
details are typed canonical JSON fields persisted through the existing
snapshot/API boundary. Normal route derivation continues to exclude explicit
transport, flights, and notes.

“Move to Want to go” is an inverse scheduling operation, not deletion. It is
available only for flexible, unreserved, provider-backed place/restaurant/hotel
items. Candidate identity is preserved through `provider`, `placeId`, and
`sourceCandidateId`; item removal and Candidate restoration are one history and
persistence transaction. Legacy items created before provenance was stored stay
ineligible rather than receiving fabricated identity. Delete is a separate
confirmed canonical operation and removes related segment preferences.

## Derived travel visibility

`deriveSegmentSpecs` considers consecutive same-day canonical items and emits a
segment only when both endpoints are ordinary located activities. Explicit
Transport, Flight, Note, and coordinate-less manual activities are boundaries;
they are never presented as failed routes and are not skipped over to create a
misleading connection. TravelSegments remain ephemeral derived state.

Timeflow renders every derived segment midway between its two activities. The
connector exposes its persisted `SegmentPreference`, normalized duration and
distance, route-loading/error/retry state, and any shortage taken from the
existing DayFeasibility issue. Selecting it highlights the existing normalized
route geometry and both endpoints on MapLibre. The connector is not draggable
and never becomes a TripItem.

## Interactive map planning

MapLibre remains a rendering and interaction surface, not a place authority.
Known Search, Suggestion, Candidate, and TripItem markers reuse normalized
TripFlow identity. A clicked OpenFreeMap vector-tile point contributes only a
bounded name, category hint, and coordinate to `/api/places/resolve-map`; the
server searches Geoapify and requires a deterministic normalized-name,
distance, and category-evidence match before exposing canonical actions.

Unverified features and ordinary coordinates can start a bounded three-kilometer
`Search around here` request. Results remain ephemeral until an explicit action.
Resolution and nearby results are cached by rounded coordinate/provider hint;
stale requests are aborted. Map Find best time uses a transient Candidate in an
immutable solver snapshot. Hypothetical routing resolves its provider place ID
server-side, and only proposal Apply creates a persisted TripItem. Manual time
selection uses the same scheduling rules and preserves provider provenance.

## Canonical Candidate intent resolution

Ask TripFlow resolves canonical Candidate references before semantic discovery
classification. Exact and safely normalized title matches produce only IDs
already present in the active trip. Scheduling language plus one resolved
Candidate produces `insert_candidate`; a bounded deterministic collection
produces `insert_candidates` and one proposal transaction.

Counted references such as “these three places” resolve only when Want to go
contains exactly that many Candidates. Whole-collection wording may resolve all
saved Candidates; otherwise the assistant asks for clarification. Scheduling
takes precedence over implicit discovery. Explicit and afternoon time windows
are passed into the solver and enforced during search, never clamped afterward.

Discovery may carry a non-authoritative `geographicReference.text`. The server
grounds that text with the existing Geoapify destination search before POI
discovery. Its ephemeral coordinates override itinerary and Trip Destination
anchors for that request only; failure or material ambiguity never silently
falls back to the Trip Destination. AI output cannot supply coordinates,
provider IDs, or claim that places were found before provider discovery.

## Phase 6.6A DayContext persistence

`GroundedPlaceRef` is the normalized provider-identity contract used by
date-scoped geographic anchors. `DayContext` is canonical Trip-owned metadata,
unique by `(tripId, date)`, with optional start, base, and end locations. These
anchors are not TripItems, Candidates, accommodations, reservations, or routes.

DayContexts use normalized columns in `trip_day_contexts` and cascade with the
Trip. An all-null value is equivalent to no context and removes the row.
Hydration loads persisted contexts but never synthesizes them from Trip
Destination. Date-range shrink transactionally removes contexts outside the
new range; expansion creates none.

DayContext edits use the normal persistence coordinator but remain outside the
itinerary Undo/Redo stack, consistent with Trip metadata.

## Phase 6.6B DayContext UI and geographic resolution

The selected date owns a compact Start / Base / End editor. Every stored value
must be an explicitly selected provider result normalized to `GroundedPlaceRef`;
free-text locations and raw provider payloads are never canonical. Saving is an
explicit metadata mutation. Clearing the final value removes the DayContext
row. Missing values remain visibly unset, with Trip Destination shown only as
fallback help rather than as a stored DayContext value.

`resolveDiscoveryGeographicContext` is the single deterministic, read-only
POINT-discovery resolver. Its precedence is: an explicitly supplied ephemeral
map/place anchor, safely relevant itinerary context, the target date's
`DayContext.baseLocation`, Trip Destination, then unsupported. Explicit user
geography and corridor references remain higher-priority request-scoped
anchors. Start and End are deliberately not discovery fallbacks in this phase.

DayContext remains metadata only. Phase 6.6B does not use Start/Base/End as
routing boundaries, alter TravelSegment derivation or feasibility, feed solver
constraints, or allow AI or other planner data to derive or mutate it.

## Phase 6.6C DayContext routing boundaries

`startLocation` and `endLocation` now delimit derived routing around a day that
contains scheduled items: Start → first item, normal item adjacency, and last
item → End. An empty day never creates Start → End travel. `baseLocation`
remains discovery-only and is never substituted for a missing boundary. No
boundary is synthesized from Trip Destination, accommodations, Candidates,
map state, or AI output.

`TravelSegment` and `SegmentSpec` carry explicit serializable
`SegmentEndpoint` values (`trip_item`, `day_start`, or `day_end`). Nullable
legacy convenience IDs identify only real TripItems; boundary endpoints never
use fake canonical IDs. Stable endpoint keys also scope SegmentPreferences to
boundary edges without pretending the boundary is a TripItem. Existing
TripItem-to-TripItem segment IDs and behavior remain compatible.

Boundary segments are derived, non-canonical evidence. They use the same
server-validated routing endpoint and coordinate/mode normalized route cache as
ordinary segments. A label-only change retains cache eligibility, while a
coordinate or supported-mode change produces a new evidence key and route
lookup. DayContext editing remains outside itinerary Undo/Redo.

Because DayContext has no departure deadline for Start or arrival deadline for
End, boundary duration is shown but does not fabricate a feasibility issue.
Internal item-to-item feasibility remains unchanged. Existing repair and
Candidate insertion solvers do not expand into whole-day planning.

Geoapify transit and `approximated_transit` remain unavailable for itinerary
feasibility. A transit preference produces an explicit unsupported state and
never falls back to driving or walking. Future scheduled transit requires a
separate provider/domain result such as `TransitJourney`, retaining departure
and arrival times, structured legs, transfers, service identifiers, geometry,
and optional fare instead of flattening a journey into timeless duration.
Phase 7 remains deferred.

## Phase 6.6D manual travel duration overrides

Provider route evidence and user timing authority remain separate:

```text
Provider Route
    ↓
provider duration, distance, geometry
    ├─ no override → effective duration = provider duration
    └─ SegmentPreference.durationOverrideMinutes
                         → effective duration = manual duration
```

`durationOverrideMinutes` is canonical SegmentPreference metadata keyed by the
existing explicit segment endpoint keys. It accepts integer minutes from 1 to
1440; null or an absent legacy value means no override. `TravelSegment` retains
the provider duration in `durationSeconds` and separately exposes
`effectiveDurationSeconds` plus `durationSource` (`provider` or `manual`). The
single `resolveEffectiveDuration` domain helper owns this authority rule.

Feasibility and existing solver evaluation consume effective duration. Changing
or resetting an override persists through the normal preference path but never
changes route-cache keys or refetches provider evidence. Like existing travel
mode preferences, overrides remain outside itinerary Undo/Redo.

A manual duration may supply timing evidence when provider evidence is absent,
including for transit. This records only a user-budgeted duration: it supplies
no geometry, distance, station, service, departure, arrival, transfer, fare, or
timetable evidence. Geoapify transit remains disabled, and a scheduled
`TransitJourney` remains separate provider evidence.

## Phase 7A scheduled transit domain boundary

Generic routing and scheduled public transport are separate authorities:

```text
RouteProvider                     TransitJourneyProvider
├─ driving                        └─ scheduled public transport
├─ walking                            ├─ walk legs
└─ cycling                            ├─ transit legs
                                      ├─ departure / arrival
                                      ├─ transfers
                                      └─ schedule/realtime evidence
```

`TransitJourneyRequest` contains validated coordinates, one optional absolute
`departureAt` or `arriveBy` constraint, an IANA timezone, provider-independent
transit modes, and an optional bounded walking limit. All journey and leg times
are offset-qualified absolute timestamps, so cross-midnight journeys retain
their actual chronology without relying on the server timezone.

`TransitJourney` is normalized, response-lifetime provider evidence rather than
canonical itinerary state. It contains explicit walk/transit legs, normalized
stops, transfers, and provenance classified as `scheduled`,
`realtime_adjusted`, or `estimated`. Strict runtime validators reject unknown
fields, invalid coordinates/times, invalid leg chronology, raw provider
payloads, and provider mismatches. Results distinguish successful alternatives,
`no_service`, `unsupported`, and transient `unavailable` outcomes. Successful
alternative order is provider order; Phase 7A adds no ranking policy.

The provider contract accepts an `AbortSignal`, but no implementation or HTTP
integration exists yet. A future Taiwan adapter may follow:

```text
TDX static/realtime data
    → normalized GTFS / GTFS-RT
    → OpenTripPlanner (or equivalent journey engine)
    → adapter
    → TransitJourneyProvider
```

TDX/OTP identifiers remain adapter details; only normalized provenance IDs
cross the domain boundary. Geoapify stays responsible for drive, walk, and
bicycle routes. Manual `SegmentPreference` transit duration remains an
independent user budget and is never converted into a timetable-backed
`TransitJourney`. Persistence, UI, realtime polling, solver consumption,
service selection, and whole-day planning remain deferred.

## Phase 6.6E bound Manual Transport

An explicit Transport TripItem remains canonical user input and declares
either `standalone` or `replace_segment` behavior. Missing behavior on legacy
records normalizes to `standalone`. Replacement identity uses an existing
stable `SegmentEndpoint` pair; optional physical `boardingPlace` and
`alightingPlace` values are separate normalized `GroundedPlaceRef` data and
never alias the itinerary endpoints.

```text
Bound Manual Transport
        ↓ fallback
SegmentPreference duration override
        ↓ fallback
Provider route evidence
        ↓
Unavailable
```

A bound Transport is excluded from routing-node derivation and rendered on its
claimed edge, preventing double counting. Provider duration, distance,
geometry, cache identity, and lower-priority duration overrides remain intact.
Unbinding therefore exposes the next authority without deleting evidence or
refetching an unchanged route.

Only a current routing-chain edge can be active. Deleted, moved, or reordered
endpoint references remain preserved but inactive and are never retargeted by
title, proximity, or coordinates. Multiple records claiming one edge are a
conflict; none is chosen arbitrarily, and new duplicate claims are rejected.

Explicit departure/arrival timestamps retain minute precision and support
cross-midnight movement. Feasibility reports missed departures and arrivals
after the following activity. Grounded station/airport data does not fabricate
access/egress routes. Manual Transport is not `TransitJourney` and receives no
provider schedule provenance.

## Phase 6.6F grounded manual Flight time semantics

A canonical manual Flight may retain provider-grounded origin and destination
airport references. Airport grounding proves only place identity, coordinates,
and an IANA timezone; it does **not** verify the airline, flight number,
schedule, terminal, gate, booking, or status. Provider raw payloads are never
stored. Legacy Flights with text-only endpoints remain explicit ungrounded user
data and are not geocoded automatically.

Airport lookup is a server-side, explicitly confirmed grounding boundary. Name,
localized-name, and city queries use bounded Geoapify results. Because the
Geoapify geocoder neither reliably resolves raw IATA codes nor consistently
returns IATA metadata, an exact three-letter query first uses the public
OurAirports CSV as a non-canonical lookup index. TripFlow then geocodes the
indexed airport name, inspects a bounded set of Geoapify Place Details results,
and accepts only airport evidence carrying the same IATA code. The index never
supplies canonical provider identity or silently substitutes a nearby airport;
the selected `GroundedAirportRef` remains Geoapify-backed. Raw index and provider
records remain server-only and are not persisted.

IATA and ICAO remain distinct optional identifiers (`AAA` versus four-character
ICAO). Schedule and calendar projections prefer a compact IATA route label and
fall back to grounded airport names without changing canonical Flight data.

```text
departure local date/time + origin airport timezone      → TripItem.startAt
arrival local date/time   + destination airport timezone → TripItem.endAt
```

Elapsed duration and chronology use those absolute instants. Flight minutes
are exact and do not use the 15-minute activity grid. Both endpoint-local dates
must fall within the trip date range. Creation, editing, and snapshot/API
validation share airport, timestamp, chronology, string-bound, and
normalization rules.

Flight remains canonical user input, not `TransitJourney` or future
`FlightProvider` evidence. It remains excluded from Geoapify route-node
derivation and is independent of Bound Manual Transport authority.

Selecting a grounded Flight may project an ephemeral great-circle preview onto
the existing Planner MapLibre map. The dashed line and endpoint markers are
computed solely from the canonical grounded airport coordinates, are explicitly
labelled approximate, and are neither Geoapify route evidence nor an operational
flight trajectory. The interpolation unwraps longitude across the International
Date Line to avoid map-spanning artifacts. Selection changes remove the source,
layer, and markers; nothing is persisted or added to `TravelSegment`.

## Phase 6.7 itinerary overview

`/trips/:id/itinerary` is a read-oriented projection over the same hydrated
Trip, TripItems, DayContexts, SegmentPreferences, derived TravelSegments, and
DayFeasibility used by the planner. It creates no overview tables, copied
TripItems, persisted day selection, or alternate movement authority.

The planner remains the editing/planning surface; the itinerary is the
consumption/read surface. The overview groups canonical items by the existing
trip-timezone date semantics, preserves endpoint-local Flight wall clocks,
omits active bound Transport records as ordinary nodes, and renders the
already-resolved effective movement authority. Standalone Transport remains a
normal TripItem. DayContext is displayed as metadata rather than synthesized
activities, and Accommodation never implies Start/Base/End.

Opening the overview hydrates through the existing read boundary and reuses the
normal bounded, cache-first route reconciliation. Presentation components do
not call Geoapify, write canonical state, or implement feasibility rules.
Phase 7B whole-day planning remains deferred.
## Manual location grounding

Manual itinerary locations reuse the canonical `TripItem` location fields and the existing routing pipeline. Text entered by a user is sent to the server-side `PlaceProvider`; the UI presents bounded normalized candidates and requires an explicit choice. A map pin can instead supply coordinates directly with a user-defined display name. Canonical items retain `locationSource = manual` and `originalLocationInput` while `latitude`, `longitude`, `address`, `provider`, and `placeId` contain the confirmed normalized evidence. Provider payloads are never persisted.

Routing, route-cache reconciliation, feasibility, duration overrides, and bound manual transport continue to consume the same canonical coordinates and derived `TravelSegment` model. Editing confirmed coordinates invalidates only the affected coordinate-based route relationship; changing labels does not create a new route-cache key.

Map Nearby search sends the clicked coordinates and explicit radius to the server. Results are conservatively filtered by measured straight-line distance to that same center before display. Development responses expose only sanitized center/radius/result-distance diagnostics.
