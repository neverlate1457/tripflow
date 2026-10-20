# TripFlow

Visual travel itinerary planning with Astro, React, Zustand, dnd-kit, Drizzle,
and SQLite.

Trip pages now provide two complementary surfaces. **Planner** (`/trips/:id`)
owns editing, drag/drop, Candidates, deterministic proposals, and explicit
canonical commits. **Itinerary** (`/trips/:id/itinerary`) is a responsive,
read-oriented day-by-day projection for reviewing and using the trip. It shows
DayContext, scheduled items, effective movement, Flight endpoint-local times,
and deterministic feasibility without creating a second itinerary authority
or exposing editing controls.

Planner keeps its original single-day Timeflow editor: selected-day drag/drop,
15-minute snapping, resizing, Candidate insertion, route editing, proposals,
Undo/Redo, and autosave all use the existing canonical commands. The separate
Itinerary page is now a horizontally scrollable, read-only multi-day calendar:
trip dates are columns and 06:00–24:00 is a shared vertical scale. Desktop shows
several dates at once; phones show one day with previous/next navigation.

The overview reuses effective movement authority—active Bound Manual Transport,
manual duration override, provider route, then unavailable—and deterministic
feasibility. DayContext is summarized per date. Boundary travel with no
canonical departure or arrival time is header context and is never assigned an
invented timestamp. Calendar overlap lanes, selection, and scroll position are
ephemeral; there is no second itinerary model or scheduling authority.

Date-scoped `DayContext` records persist optional provider-grounded Start,
Base, and End locations through `/api/trips/:id/day-contexts`. The planner's
compact day editor requires explicit provider-result selection and keeps this
metadata outside itinerary Undo/Redo. Base remains the POINT-discovery fallback.
Start and End create derived routing edges around scheduled activities, but are
not TripItems, are never synthesized, and do not create a direct route on an
empty day. Boundary durations are informative because DayContext has no time
deadline semantics.

Geoapify transit remains disabled. Transit never falls back to another mode.
Phase 7A defines a separate, provider-independent `TransitJourneyProvider`
contract for schedule-aware journeys, with normalized walk/transit legs,
stops, absolute departure/arrival times, alternatives, provenance, and explicit
no-service/unsupported/unavailable outcomes. It has no production provider or
UI yet, and whole-day planning remains deferred. A future Taiwan implementation
may normalize TDX data for OpenTripPlanner (or an equivalent journey engine)
and adapt its results to this contract; it will not extend Geoapify routes.

Derived travel segments support an optional canonical manual duration in their
`SegmentPreference`. Provider distance, geometry, and estimated duration remain
unchanged; itinerary timing uses the manual duration when present and clearly
labels it as Manual. Overrides are integer minutes from 1 to 1440, apply to
ordinary and DayContext boundary segments, persist outside itinerary Undo/Redo,
and do not change route-cache identity or trigger a provider refetch. Manual
transit duration is only user-budgeted time—not a scheduled transit journey.
It is never automatically converted into `TransitJourney` evidence.

Explicit Transport can remain standalone or replace one currently adjacent
itinerary movement edge, including Day Start/End boundaries. Bound Transport
is canonical user input and takes timing authority over a duration override and
provider route while leaving both lower layers intact. Optional provider-backed
boarding/alighting places remain separate from binding identity and create no
automatic first/last-mile travel. Invalid bindings stay visible but inactive
and never silently retarget. Manual Transport remains distinct from Phase 7A
`TransitJourney` provider evidence.

New manual Flights use provider-backed airports with coordinates, provider
identity, and a valid IANA timezone. Departure is interpreted in the origin
airport timezone and arrival in the destination airport timezone before both
are stored as absolute instants; exact minutes are preserved. Legacy text-only
Flight endpoints continue to load and edit without silent grounding.

Airport search accepts IATA codes, airport names, localized names, and cities.
An exact three-letter IATA query is resolved from the public OurAirports index,
then verified against Geoapify airport details before it can be selected; names
and cities remain bounded Geoapify searches. Search results always require an
explicit user selection. The Schedule/Calendar uses compact code routes such as
`TPE → FUK` when codes are available and falls back to readable endpoint names.

Airport grounding does not verify airline, flight number, schedule, gate,
terminal, booking, or live status. A manual Flight remains canonical user data,
not `TransitJourney` or flight-provider evidence, and aircraft are never routed
through Geoapify.

Selecting a grounded Flight in Planner shows a dashed, approximate great-circle
preview with airport markers on the existing map. It uses stored airport
coordinates, handles Date Line wrapping, and never claims to represent the
airline's actual flown route. The preview is ephemeral and does not change the
Flight, routing evidence, or TravelSegments.

## Local setup

```sh
npm install
npm run db:setup
npm run dev
```

`db:setup` creates the SQLite directory, applies every committed Drizzle
migration, and seeds the Okinawa development trip (`okinawa-2026`). Set
`DATABASE_URL` to use another SQLite file.

## Database workflow

- Change `src/db/schema.ts` only; it is the schema source of truth.
- Run `npm run db:generate` after a schema change and commit the generated SQL.
- Run `npm run db:migrate` to apply pending migrations.
- Run `npm run db:seed` to restore the development trip.
- Run `npm run db:setup` for a fresh clone.

The seed command is intentionally repeatable: it replaces the demo trip's
items and candidates through the repository boundary.

Copy `.env.example` to `.env` and provide `GEOAPIFY_API_KEY` to enable place
search. The MapLibre/OpenFreeMap map does not require a key. See
`PROVIDERS.md` for the provider decision and credential restrictions.
The same server-only key enables routing. Normalized route results are cached
in SQLite for 30 days.

## Scheduling data

TripItems canonically store fixed/flexible status, optional start/end windows,
and one optional structured reservation. Segment travel-mode preferences are
also canonical, while TravelSegments and day feasibility issues are derived.
Expired route-cache rows are removed on the next route request; no background
worker is required.

## Deterministic planning proposals

Timeflow issues expose **Suggest fix**, and Candidate cards expose **Find time**
for the selected day. Both analyze an immutable day snapshot and show ranked
proposals before changing canonical data. Dashed ghost cards show proposed
positions. **Apply changes** commits the whole proposal as one undoable and
persisted operation; canceling discards it.

The Phase 5 solver does not use AI. Fixed items are hard anchors, malformed
constraints are rejected, and scheduling windows retain warning semantics.
Search uses 15-minute steps with limits of eight flexible repair items, a
12-hour horizon, 2,500 states, five proposals, and ten unique hypothetical route
estimates. Missing optional route data is shown as limited confidence.

Phase 5.5 prepares Candidate route edges through the existing server routing
boundary and normalized route cache before solving. Find time lets the user
choose day, temporary duration, and driving/walking/cycling mode. The UI shows
separate “Checking travel times…” and “Finding schedule…” states and supports
cancellation without changing itinerary data.

Schedule repair now uses a bounded deterministic beam search capable of moving
multiple flexible activities between fixed anchors. Proposal metrics include
travel before/after, travel delta, minimum buffer, idle time, movement totals,
and confidence. Map previews highlight affected items and insertion neighbors,
and draw known hypothetical geometries as dashed lines.

Guardrails: eight flexible repair items, 32-wide beam, 5,000 evaluated states,
five proposals, 15-minute grid, and ten unique missing route lookups per solve.
The main planner code is split from MapLibre, the item editor, and proposal
preview so the initial planner chunk does not include the full map renderer.

## Planning assistant

For configured Ollama or OpenAI providers, the model performs semantic intent
interpretation first. TripFlow then validates the bounded schema, dates,
canonical IDs, geographic shape, and capability arguments. The deterministic
parser remains the Mock provider implementation and does not overwrite valid
Ollama/OpenAI interpretations. Invalid structured output gets at most one
model-based schema repair before safe rejection.

The model has no direct mutation authority. Its capability plan can resolve
locations, discover grounded places, calculate supported routes, inspect
itinerary facts, or request deterministic schedule proposals. Canonical changes
still require proposal preview and explicit user Apply.

**Ask TripFlow** supports day repair, Candidate insertion, issue explanation,
and proposal explanation. It is not a general chatbot. AI interpretation never
changes itinerary data: validated intents invoke the deterministic planner,
proposal preview remains mandatory, and only explicit **Apply** commits.

Production configuration:

```sh
PLANNING_AI_PROVIDER=openai
OPENAI_API_KEY=your_server_only_key
OPENAI_PLANNING_MODEL=gpt-4o-mini
```

Local Ollama alternative:

```sh
PLANNING_AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_PLANNING_MODEL=qwen3.5:9b
OLLAMA_PLANNING_TIMEOUT_MS=60000
```

Provider-grounded discovery can optionally add a bounded second model pass:

```ini
PLANNING_AI_RERANK_ENABLED=true
PLANNING_AI_RERANK_TIMEOUT_MS=12000
PLANNING_AI_RERANK_MAX_CANDIDATES=12
```

The reranker can only reorder supplied provider-backed place IDs. Geographic and category eligibility remain deterministic, its short explanations are assessments rather than provider facts, and timeout, malformed output, or provider failure keeps the existing deterministic order.

Start Ollama and pull the configured model before running TripFlow. Ollama uses
its structured JSON-schema response format through `/api/chat`; the result still
passes the same TripFlow runtime and entity validation as OpenAI. Selecting
Ollama does not require `OPENAI_API_KEY`, and failures never fall back to OpenAI.
Geoapify remains independently responsible for real Places and Routing data.
The local-only timeout defaults to 60 seconds so a cold model can load without
changing the 15-second OpenAI timeout. Change `OLLAMA_PLANNING_MODEL` (for
example to `qwen3.8:27b`) to switch installed models without code changes.

Local development defaults to a deterministic mock when the provider setting
is omitted. The OpenAI adapter uses Responses Structured Outputs, a 15-second
timeout, 500-character messages, and at most 50 context records. It makes one
interpretation call per submission and stores no conversation or raw prompt.
Latency is expected to be network-bound (typically a few seconds), and cost is
kept low by the compact context, short structured response, and single-call
limit; actual latency and price depend on the configured model and provider
pricing.
Ambiguous entities return clarification options. Direct movement/deletion,
arbitrary timestamps, fixed-state, reservation, constraint, and automatic
Apply requests are unsupported.

### Development AI debug trace

Set `TRIPFLOW_AI_DEBUG=true` and restart the development server to expose the
small **Debug** button and inline **Execution Trace** disclosure in Ask TripFlow. It shows the latest request's actual
preprocessing, minimized context, provider payload/schema, raw response,
validation, normalization, entity-resolution, routing, ranking, solver, and
frontend-rendering stages. The typed timeline identifies each decision's
producer, validator, provider/model, status, duration, and fallback reason. Each
section or the complete sanitized JSON trace can be copied for a bug report.

Traces are server-memory-only, bounded to 15 requests, and disappear on restart.
The endpoint returns 404 and the client hides the button unless both development
mode and the setting are active. Authorization, cookies, API keys, secrets, and
tokens are recursively redacted. Prompt-like content is omitted by default;
`TRIPFLOW_AI_DEBUG_INCLUDE_CONTENT=true` opts into it for local debugging only,
and is effective only when `TRIPFLOW_AI_DEBUG=true` in a development server.
Each Ollama interpretation or structured-repair call then exposes the exact
credential-free outbound JSON body and raw/parsed response in its own expandable
Execution Trace event. These payloads remain process-memory-only and are never
returned by the production-safe trace endpoint.
Raw traces are never written to SQLite. Production exposes only the bounded,
sanitized timeline needed by source badges, never detailed stage payloads.

Every visible Ask TripFlow response also carries a source badge independently
of developer mode. The badge is based on provenance attached where the message
was created—not on the currently selected AI provider—and distinguishes model
interpretation/repair, TripFlow validation or error handling, Geoapify-backed
discovery, deterministic rendering, and unknown origin. Opening it shows the
correlated request/event and offers a safe **Copy Diagnostic** payload.

## Grounded place discovery

Ask TripFlow also accepts bounded discovery requests such as “Oct 24 afternoon
I want somewhere by the ocean.” AI produces preferences only; the server derives
the geographic anchor and retrieves actual places through `PlaceProvider`.
Deterministic ranking returns ephemeral `PlaceSuggestion` cards and temporary map
markers. No provider result means no suggestion—AI never fills the gap.

Named discovery keeps its explicit scope. City-area searches use the grounded
provider area rather than pretending its centroid is a nearby point; nearby
searches rank around the accepted provider-backed point. Corridor searches use
the real drive/walk/bicycle route geometry with bounded windows across the
route. Requested categories and maximum detours are hard constraints: TripFlow
returns fewer or no suggestions instead of padding with unrelated places or
treating unknown detour evidence as acceptable. A failed explicit reference is
never silently replaced with the trip destination.

When a request contains no named geography, canonical provider-backed fallback
context is reused directly. Trip Destination and DayContext Base coordinates
and provider identities are not converted back into ambiguous global geocoder
text queries.

**Add to trip** is the first canonical action and reuses `placeToCandidate` plus
normal planner persistence. The place is still not scheduled: drag it manually
or use **Find time**, review the deterministic proposal, and explicitly Apply.

## Editing the itinerary

Use **+ Add** in Explore to create an activity, meal, accommodation, explicit
transport leg, flight, or note. Ordinary activities use the trip timezone and
15-minute grid. Transport preserves exact minutes; grounded Flight wall clocks
use their respective airport timezones. These items may cross midnight while
their applicable local dates remain inside the trip.

Every Timeflow card has a **⋯** menu for Edit, Move to Want to go, and Delete.
Moving back is offered only when a flexible provider-backed place can be safely
reconstructed as a Candidate. Delete asks for confirmation and never creates a
Candidate. Both actions are single undoable, persisted planner operations.

Located activities that are consecutive on a day show a derived travel
connector in Timeflow. Use its Driving, Walking, or Cycling selector to persist
the segment preference and recalculate the route. Loading, unavailable-route,
retry, distance, duration, and insufficient-gap states are shown directly.
Selecting a connector highlights its cached route geometry on the map. These
connectors are derived data and remain distinct from explicit Transport items.

## Interactive map planning

Click an existing marker to inspect its grounded place and add it to **Want to
go** or open **Add to Timeflow**. Existing Candidates and scheduled items adapt
the popup to prevent duplicates. Find best time reuses route preparation, the
deterministic solver, proposal preview, and explicit Apply; manual placement
requires a date, 15-minute time, and duration.

A labeled basemap POI is verified through Geoapify before canonical actions are
shown. An unverified feature or empty coordinate offers **Search around here**,
returning only provider-backed nearby places. Clicking, panning, zooming, or
closing a popup never mutates the itinerary. Destination stays a trip-level
anchor and is never treated as an ordinary Candidate.

## Verification

```sh
npm test
npm run check
npm run build
```

Ask TripFlow resolves saved-place titles and deterministic Want to go collection
references before place-discovery classification. A multi-place scheduling
request creates one preview and one Apply/undo transaction. “Afternoon” is
bounded to 12:00–18:00, and explicit time windows are hard insertion limits.

Named discovery areas such as “near Yufuin” are passed only as location text,
resolved server-side through Geoapify, and used as an ephemeral search anchor.
They never modify the trip destination or allow AI-authored coordinates.
## Manual addresses and map pins

When adding a Place, Meal, or Accommodation manually, enter an address or business/location name and explicitly choose one of the provider-backed matches. TripFlow stores the original input plus the confirmed address and coordinates; routing uses the confirmed coordinates. You can also click an unlabelled point on the planner map, choose **Use pin for manual item**, and provide a custom display name. Map pins do not claim provider identity or fabricate an address.

Nearby map search supports a bounded radius and never falls back to the trip destination when explicit map coordinates were clicked.
