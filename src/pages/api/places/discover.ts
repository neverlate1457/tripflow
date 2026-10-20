import type { APIRoute } from "astro";
import { buildAIContext, validateInterpretation } from "@/domain/ai-planning";
import {
  DISCOVERY_LIMITS,
  buildDiscoverySearchStages,
  deduplicateDiscoveryPlaces,
  discoveryPreparationIntent,
  discoveryDiagnostics,
  resolveDiscoveryGeographicContext,
  rankPlaceSuggestions,
  sampleCorridorSearchAnchors,
  type DiscoveryRouteEstimate,
} from "@/domain/discovery";
import { fallbackGeographicQueries, geographicReferenceKind, resolveCorridorGeographicCandidates, resolveGeographicCandidates } from "@/domain/geographic-resolution";
import { SqliteTripRepository } from "@/services/sqlite-trip-repository";
import { GeoapifyPlaceProvider } from "@/services/geoapify-place-provider";
import { routeWithCache } from "@/services/cached-routing";
import { recordPlanningAITraceEvent, updatePlanningAITrace } from "@/services/planning-ai-debug";
import {
  createGeographicClarificationSession,
  relevantClarificationCandidates,
  resolveGeographicClarification,
} from "@/services/geographic-clarification-session";
import type { GeographicCandidate } from "@/services/place-provider";
import { resolvePlanningAIConfiguration } from "@/services/planning-ai-config";
import { createPlanningAIProvider } from "@/services/planning-ai-provider";
import { rerankTravelSuggestions } from "@/services/travel-relevance-reranker";

const repository = new SqliteTripRepository();
export const POST: APIRoute = async ({ request }) => {
  const requestStarted = Date.now();
  let correlatedRequestId: string | undefined;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const resumeRequest = typeof body.clarificationToken === "string" || typeof body.selectedCandidateId === "string";
    let tripId: string, intentInput: unknown, originalRequest = "", requestId: string | undefined, clarificationTripUpdatedAt: string | undefined;
    let selectedClarificationCandidate: GeographicCandidate | undefined,
      clarificationCorridorEndpoint: "origin" | "destination" | undefined;
    if (resumeRequest) {
      if (
        !Object.keys(body).every((key) => ["clarificationToken", "selectedCandidateId"].includes(key)) ||
        typeof body.clarificationToken !== "string" ||
        typeof body.selectedCandidateId !== "string"
      )
        return Response.json({ error: "Invalid clarification request", code: "invalid_request" }, { status: 400 });
      const resolution = resolveGeographicClarification(body.clarificationToken, body.selectedCandidateId);
      if (resolution.status !== "resolved") {
        const expired = resolution.status === "expired" || resolution.status === "not_found";
        if (import.meta.env.DEV)
          console.debug("Geographic clarification rejected", { clarificationExpired: expired, rejectionReason: resolution.status });
        return Response.json(
          {
            error: expired
              ? "This location clarification expired. Retry the original search."
              : resolution.status === "already_used"
                ? "This location clarification has already been used."
                : "The selected location is not part of this clarification.",
            code: resolution.status,
          },
          { status: expired ? 410 : resolution.status === "already_used" ? 409 : 400 },
        );
      }
      tripId = resolution.session.tripId;
      intentInput = resolution.session.intent;
      originalRequest = resolution.session.originalRequest;
      requestId = resolution.session.requestId;
      clarificationTripUpdatedAt = resolution.session.tripUpdatedAt;
      selectedClarificationCandidate = resolution.candidate;
      clarificationCorridorEndpoint = resolution.session.corridorEndpoint;
      if (import.meta.env.DEV)
        console.debug("Geographic clarification resolved", {
          clarificationResolved: true,
          selectedCandidateId: body.selectedCandidateId,
          geographicScope: resolution.session.geographicScope,
          discoveryResumed: true,
        });
      if (requestId)
        updatePlanningAITrace(requestId, "clarificationResolved", {
          clarificationResolved: true,
          selectedCandidateId: body.selectedCandidateId,
          geographicScope: resolution.session.geographicScope,
          discoveryResumed: true,
        });
    } else {
      if (typeof body.tripId !== "string" || !body.intent)
        return Response.json(
          { error: "Invalid discovery request" },
          { status: 400 },
        );
      tripId = body.tripId;
      intentInput = body.intent;
      originalRequest = typeof body.originalRequest === "string" ? body.originalRequest.slice(0, 500) : "";
      requestId = typeof body.requestId === "string" ? body.requestId : undefined;
    }
    const snapshot = await repository.getTrip(tripId);
    if (!snapshot)
      return Response.json({ error: "Trip not found" }, { status: 404 });
    if (resumeRequest && clarificationTripUpdatedAt !== snapshot.trip.updatedAt)
      return Response.json(
        { error: "The trip changed while choosing a location. Retry the original search.", code: "context_changed" },
        { status: 409 },
      );
    const validated = validateInterpretation(
      { status: "resolved", intent: intentInput },
      buildAIContext(
        snapshot.trip,
        snapshot.items,
        snapshot.candidates,
        snapshot.trip.startDate,
      ),
    );
    if (
      validated.status !== "resolved" ||
      validated.intent.type !== "discover_places"
    )
      return Response.json(
        { error: "Invalid discovery intent" },
        { status: 400 },
      );
    const key = import.meta.env.GEOAPIFY_API_KEY;
    if (!key)
      return Response.json(
        { error: "Place discovery is not configured." },
        { status: 503 },
      );
    correlatedRequestId = requestId;
    const provider = new GeoapifyPlaceProvider(key), reference = validated.intent.geographicReference?.text.trim(), corridorReference = validated.intent.corridorReference;
    const groundingStarted = Date.now();
    let explicitAnchor: { latitude: number; longitude: number } | undefined, geographicResolution: Record<string, unknown> | null = null, corridorPairTrace: Record<string, unknown> | null = null;
    const tripRankingContext = snapshot.trip.destination
      ? { tripDestination: snapshot.trip.destination }
      : {};
    const resolveReference = async (text: string, scope: "city_area" | "nearby_point" | "corridor", peers: GeographicCandidate[] = []) => {
      const kind=geographicReferenceKind(text,scope), stem=text.replace(/(?:車站|车站|站|駅|機場|机场|空港|airport|station|市)$/iu,"").trim(), variants=[text];
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) {
        if(kind==="city_area"&&!/[市町村区]$/u.test(text))variants.push(`${text}市`);
        if(scope==="corridor"&&kind==="place"&&!/[市町村区]$/u.test(text))variants.push(`${text}市`);
        if(kind==="station"&&stem){variants.push(`${stem}駅`,`${stem} station`);}
        if(kind==="airport"&&stem){variants.push(`${stem}空港`,`${stem} airport`);}
      }
      const candidateMap=new Map<string,Awaited<ReturnType<typeof provider.searchGeographicCandidates>>[number]>();
      const collect = async (queries: string[], rankOffset = 0) => {
      for(const [queryRank,query] of [...new Set(queries)].slice(0,3).entries()) {
        for(const candidate of await provider.searchGeographicCandidates(query,request.signal)) {
          const ranked={...candidate,providerRank:(rankOffset+queryRank)*8+(candidate.providerRank??0)}, key=`${candidate.provider}:${candidate.providerPlaceId}`, previous=candidateMap.get(key);
          if(!previous||(ranked.providerRank??Infinity)<(previous.providerRank??Infinity))candidateMap.set(key,ranked);
        }
      }
      };
      await collect(variants);
      if (!candidateMap.size)
        await collect(fallbackGeographicQueries(text, kind, scope), variants.length);
      const matches=[...candidateMap.values()];
      const resolution=resolveGeographicCandidates(text,matches,scope,{...tripRankingContext,explicitlyGroundedPeers:peers});
      if(import.meta.env.DEV)console.debug("Geographic resolution",{text,scope,status:resolution.status,candidates:resolution.candidates.map(({candidate,score,reasons})=>({name:candidate.name,address:candidate.formattedAddress,resultType:candidate.resultType,categories:candidate.categories,city:candidate.city,region:candidate.region,country:candidate.country,confidence:candidate.confidence,score,reasons}))});
      return resolution;
    };
    let corridor: Parameters<typeof resolveDiscoveryGeographicContext>[5];
    if (corridorReference) {
      const [origin, destination] = await Promise.all([
        clarificationCorridorEndpoint === "origin" && selectedClarificationCandidate
          ? Promise.resolve({ status: "resolved" as const, selected: selectedClarificationCandidate, candidates: [] })
          : resolveReference(corridorReference.originText.trim(), "corridor"),
        clarificationCorridorEndpoint === "destination" && selectedClarificationCandidate
          ? Promise.resolve({ status: "resolved" as const, selected: selectedClarificationCandidate, candidates: [] })
          : resolveReference(corridorReference.destinationText.trim(), "corridor"),
      ]);
      const originCandidates = clarificationCorridorEndpoint === "origin" && selectedClarificationCandidate
          ? [selectedClarificationCandidate]
          : origin.candidates.map((entry) => entry.candidate),
        destinationCandidates = clarificationCorridorEndpoint === "destination" && selectedClarificationCandidate
          ? [selectedClarificationCandidate]
          : destination.candidates.map((entry) => entry.candidate),
        pairResolution = resolveCorridorGeographicCandidates(
          corridorReference.originText.trim(),
          corridorReference.destinationText.trim(),
          originCandidates,
          destinationCandidates,
          tripRankingContext,
        ),
        pairDiagnostics = pairResolution.pairs.slice(0, 5).map((pair) => ({
          origin: { providerPlaceId: pair.origin.candidate.providerPlaceId, name: pair.origin.candidate.name, latitude: pair.origin.candidate.latitude, longitude: pair.origin.candidate.longitude, city: pair.origin.candidate.city, region: pair.origin.candidate.region, country: pair.origin.candidate.country, score: pair.origin.score },
          destination: { providerPlaceId: pair.destination.candidate.providerPlaceId, name: pair.destination.candidate.name, latitude: pair.destination.candidate.latitude, longitude: pair.destination.candidate.longitude, city: pair.destination.candidate.city, region: pair.destination.candidate.region, country: pair.destination.candidate.country, score: pair.destination.score },
          score: pair.score,
          distanceKm: pair.distanceKm,
          reasons: pair.reasons,
        }));
      corridorPairTrace = {
        originText: corridorReference.originText,
        destinationText: corridorReference.destinationText,
        candidatePairsConsidered: pairDiagnostics,
        status: pairResolution.status,
        ambiguityReason: pairResolution.status === "ambiguous" || pairResolution.status === "not_found" ? pairResolution.reason : null,
        selectedPair: pairResolution.status === "resolved" ? pairDiagnostics[0] ?? null : null,
        clarificationRequired: pairResolution.status === "ambiguous",
      };
      if (requestId) updatePlanningAITrace(requestId, "corridorPairResolution", corridorPairTrace);
      const ambiguousEndpoint = pairResolution.status === "ambiguous"
        ? {
            role: pairResolution.endpoint,
            reference: pairResolution.endpoint === "origin" ? corridorReference.originText.trim() : corridorReference.destinationText.trim(),
            candidates: pairResolution.candidates,
            reason: pairResolution.reason,
          }
        : null;
      if (ambiguousEndpoint) {
        const candidates = relevantClarificationCandidates(ambiguousEndpoint.reference, "corridor", ambiguousEndpoint.candidates);
        if (candidates.length >= 2) {
          const session = createGeographicClarificationSession({
            tripId, tripUpdatedAt: snapshot.trip.updatedAt, date: validated.intent.date,
            originalRequest: originalRequest || `${corridorReference.originText} → ${corridorReference.destinationText}`,
            geographicReference: ambiguousEndpoint.reference, geographicScope: "corridor",
            corridorEndpoint: ambiguousEndpoint.role, intent: validated.intent, candidates, requestId,
          });
          if (requestId) { updatePlanningAITrace(requestId, "clarificationCreated", { clarificationCreated: true, candidateCount: session.candidates.length, geographicScope: "corridor", corridorEndpoint: ambiguousEndpoint.role }); recordPlanningAITraceEvent(requestId, { stage: "geographic_grounding", sourceType: "place_provider", provider: "geoapify", model: null, status: "failed", durationMs: Date.now() - groundingStarted, inputSummary: { scope: "corridor", endpoint: ambiguousEndpoint.role }, outputSummary: { candidateCount: session.candidates.length, candidatePairsConsidered: pairDiagnostics }, errorCode: "AMBIGUOUS_GEOGRAPHY", reason: ambiguousEndpoint.reason }); }
          return Response.json({
            status: "clarification_required", reason: "ambiguous_geography",
            originalRequest: originalRequest || `${corridorReference.originText} → ${corridorReference.destinationText}`,
            geographicReference: ambiguousEndpoint.reference, geographicScope: "corridor",
            corridorEndpoint: ambiguousEndpoint.role, ...session,
          });
        }
      }
      if (pairResolution.status !== "resolved")
        return Response.json({ status: "unsupported", reason: "TripFlow could not resolve both provider-backed corridor endpoints.", suggestions: [] });
      const originPlace = pairResolution.origin, destinationPlace = pairResolution.destination;
      corridor = {
        origin: { id: `corridor-origin:${originPlace.providerPlaceId}`, name: originPlace.name, latitude: originPlace.latitude, longitude: originPlace.longitude },
        destination: { id: `corridor-destination:${destinationPlace.providerPlaceId}`, name: destinationPlace.name, latitude: destinationPlace.latitude, longitude: destinationPlace.longitude },
      };
      geographicResolution = { status: "resolved_corridor", origin: { selected: originPlace, candidates: origin.candidates }, destination: { selected: destinationPlace, candidates: destination.candidates }, candidatePairsConsidered: pairDiagnostics, selectedPair: pairDiagnostics[0] ?? null };
    }
    if (reference) {
      const referenceScope = validated.intent.geographicScope === "city_area" ? "city_area" : "nearby_point";
      const resolution = selectedClarificationCandidate && !clarificationCorridorEndpoint
        ? { status: "resolved" as const, selected: selectedClarificationCandidate, candidates: [] }
        : await resolveReference(reference, referenceScope);
      if (resolution.status !== "resolved") {
        if (resolution.status === "ambiguous") {
          const candidates = relevantClarificationCandidates(
            reference,
            referenceScope,
            resolution.candidates,
          );
          if (candidates.length >= 2) {
            const session = createGeographicClarificationSession({
              tripId,
              tripUpdatedAt: snapshot.trip.updatedAt,
              date: validated.intent.date,
              originalRequest: originalRequest || reference,
              geographicReference: reference,
              geographicScope: referenceScope,
              intent: validated.intent,
              candidates,
              requestId,
            });
            if (import.meta.env.DEV)
              console.debug("Geographic clarification created", {
                clarificationCreated: true,
                candidateCount: session.candidates.length,
                geographicScope: referenceScope,
              });
            if (requestId)
              updatePlanningAITrace(requestId, "clarificationCreated", {
                clarificationCreated: true,
                candidateCount: session.candidates.length,
                geographicScope: validated.intent.geographicScope ?? "nearby_point",
              });
            if (requestId) recordPlanningAITraceEvent(requestId, { stage: "geographic_grounding", sourceType: "place_provider", provider: "geoapify", model: null, status: "failed", durationMs: Date.now() - groundingStarted, inputSummary: { scope: referenceScope, reference }, outputSummary: { candidateCount: session.candidates.length }, errorCode: "AMBIGUOUS_GEOGRAPHY", reason: "User selection required; no candidate silently accepted" });
            return Response.json({
              status: "clarification_required",
              reason: "ambiguous_geography",
              originalRequest: originalRequest || reference,
              geographicReference: reference,
              geographicScope: referenceScope,
              ...session,
            });
          }
        }
        if (requestId) { updatePlanningAITrace(requestId, "geographicReference", { extractedText: reference, source: "validated_discovery_intent", status: "resolved_text" }); updatePlanningAITrace(requestId, "geographicResolution", { inputText: reference, provider: "geoapify", status: "not_found", ambiguity: resolution.status === "ambiguous" ? "insufficient_relevant_candidates" : null }); recordPlanningAITraceEvent(requestId, { stage: "geographic_grounding", sourceType: "place_provider", provider: "geoapify", model: null, status: "failed", durationMs: Date.now() - groundingStarted, inputSummary: { scope: referenceScope, reference }, outputSummary: null, errorCode: resolution.status === "ambiguous" ? "AMBIGUOUS_GEOGRAPHY" : "GEOGRAPHY_NOT_FOUND", reason: "Explicit geography was not replaced by trip context" }); }
        return Response.json({ status: "unsupported", reason: resolution.status === "ambiguous" ? `TripFlow found multiple plausible locations for “${reference}”. Please be more specific.` : `TripFlow could not resolve “${reference}” to a provider-backed location.`, suggestions: [] });
      }
      const resolved = resolution.selected;
      explicitAnchor = { latitude: resolved.latitude, longitude: resolved.longitude };
      geographicResolution = { inputText: reference, provider: resolved.provider, status: "resolved", providerPlaceId: resolved.providerPlaceId, formattedAddress: resolved.formattedAddress, latitude: resolved.latitude, longitude: resolved.longitude, ambiguity: null, candidates: resolution.candidates };
    }
    const context = resolveDiscoveryGeographicContext(
      snapshot.trip,
      snapshot.items,
      validated.intent,
      explicitAnchor,
      reference,
      corridor,
      snapshot.dayContexts ?? [],
      reference && geographicResolution && "providerPlaceId" in geographicResolution ? geographicResolution.providerPlaceId as string : undefined,
    );
    if (!context)
      return Response.json({
        status: "unsupported",
        reason:
          "TripFlow needs a located activity or saved place before it can search nearby places.",
        suggestions: [],
      });
    if (requestId) {
      updatePlanningAITrace(requestId, "geographicReference", { extractedText: reference ?? null, source: reference ? "validated_discovery_intent" : "none", status: reference ? "resolved_text" : "absent" });
      updatePlanningAITrace(requestId, "geographicResolution", geographicResolution ?? { inputText: null, provider: null, status: "not_required", ambiguity: null });
      updatePlanningAITrace(requestId, "discoveryAnchor", { discoveryGeometry: context.geometry, scope: context.scope, geographicSource: context.anchorSource, sourceWasAlreadyGrounded: context.sourceWasAlreadyGrounded ?? false, sourceProvider: context.sourceProvider ?? null, sourceProviderPlaceId: context.sourceProviderPlaceId ?? null, resolverInvoked: Boolean(reference || corridorReference), acceptedName: context.anchorName ?? null, anchorName: context.anchorName ?? null, latitude: context.anchor.latitude, longitude: context.anchor.longitude, origin: context.corridor?.origin ?? null, destination: context.corridor?.destination ?? null, precedenceReason: corridor ? "explicit corridor endpoints" : reference ? "explicit geographic reference overrides itinerary, DayContext, and Trip Destination" : context.anchorSource === "day_context_base" ? "no relevant itinerary location; selected date DayContext base overrides Trip Destination" : context.anchorSource === "trip_destination" ? "canonical provider-grounded Trip Destination reused directly" : "existing contextual anchor precedence", ephemeral: context.anchorSource === "explicit_geographic_reference" });
      recordPlanningAITraceEvent(requestId, { stage: "geographic_grounding", sourceType: reference || corridorReference ? "place_provider" : "tripflow_deterministic", provider: reference || corridorReference ? "geoapify" : "tripflow", model: null, status: "success", durationMs: Date.now() - groundingStarted, inputSummary: { scope: validated.intent.geographicScope, reference: reference ?? null, corridor: corridorReference ?? null }, outputSummary: { anchorName: context.anchorName ?? null, anchorSource: context.anchorSource, geometry: context.geometry, ...(corridorPairTrace ? { corridorPairResolution: corridorPairTrace } : {}) }, errorCode: null, reason: reference || corridorReference ? "Provider-backed geographic identity accepted" : "Canonical fallback precedence selected anchor" });
    }
    const estimates: DiscoveryRouteEstimate[] = [];
    let routeCacheHits = 0, routeProviderCalls = 0;
    const mode = validated.intent.travelMode ?? "driving";
    const route = async (fromId: string, origin: { latitude: number; longitude: number }, toId: string, destination: { latitude: number; longitude: number }) => {
      if (estimates.length >= DISCOVERY_LIMITS.routeLookups || request.signal.aborted) return undefined;
      try {
        const result = await routeWithCache({ origin, destination, mode }, key);
        if (result.cache === "hit") routeCacheHits += 1; else routeProviderCalls += 1;
        estimates.push({ fromId, toId, durationMinutes: Math.ceil(result.durationSeconds / 60) });
        return result;
      } catch { return undefined; }
    };
    const previousId = context.corridor?.origin.id ?? context.previous?.id, nextId = context.corridor?.destination.id ?? context.next?.id;
    const previous = context.corridor ? { latitude: context.corridor.origin.latitude, longitude: context.corridor.origin.longitude } : context.previous?.latitude != null && context.previous.longitude != null ? { latitude: context.previous.latitude, longitude: context.previous.longitude } : null;
    const next = context.corridor ? { latitude: context.corridor.destination.latitude, longitude: context.corridor.destination.longitude } : context.next?.latitude != null && context.next.longitude != null ? { latitude: context.next.latitude, longitude: context.next.longitude } : null;
    if (context.geometry === "corridor" && previous && next && previousId && nextId) {
      const baseline = await route(previousId, previous, nextId, next);
      if (!baseline?.geometry) return Response.json({ status: "unsupported", reason: "TripFlow could not obtain provider-backed corridor geometry.", suggestions: [] });
      context.routeGeometry = baseline.geometry;
    }
    const searchAnchors = context.geometry === "corridor" ? sampleCorridorSearchAnchors(context.routeGeometry) : [{ id: "anchor", ...context.anchor }];
    const stages = buildDiscoverySearchStages(validated.intent),
      merged = new Map<string, Awaited<ReturnType<typeof provider.discover>>[number]>(),
      providerDiagnostics: Array<{
        windowId: string;
        categories: string[];
        queryApplied: boolean;
        status: "ok";
        rawCount: number;
        normalizedCount: number;
      }> = [];
    let providerRequestCount = 0;
    const placesStarted = Date.now();
    for (const stage of stages) for (const searchAnchor of searchAnchors) {
      if (providerRequestCount >= DISCOVERY_LIMITS.providerRequests) break;
      const result = await provider.discoverWithDiagnostics!({
        query: stage.query,
        categories: stage.categories,
        latitude: searchAnchor.latitude,
        longitude: searchAnchor.longitude,
        providerAreaPlaceId: context.scope === "city_area" ? context.areaProviderPlaceId : undefined,
        radiusMeters: context.geometry === "corridor" ? 15_000 : undefined,
        limit: DISCOVERY_LIMITS.providerResults,
        language: "en",
        signal: request.signal,
      });
      providerDiagnostics.push({
        windowId: searchAnchor.id,
        categories: stage.categories,
        queryApplied: Boolean(stage.query),
        status: "ok",
        rawCount: result.rawCount,
        normalizedCount: result.normalizedCount,
      });
      providerRequestCount += 1;
      for (const place of result.places)
        merged.set(`${place.provider}:${place.providerPlaceId}`, place);
    }
    const normalizedPlaces = [...merged.values()],
      deduplicated = deduplicateDiscoveryPlaces(normalizedPlaces),
      places = deduplicated.places;
    const semanticDiagnostics = discoveryDiagnostics(
      places,
      validated.intent,
      context,
    );
    const preliminary = rankPlaceSuggestions(
      places,
      // The detour cap is a final eligibility constraint. Applying it before
      // route preparation would remove every still-unknown candidate and
      // prevent the required route lookups from ever running.
      discoveryPreparationIntent(validated.intent),
      context,
      snapshot.candidates,
      snapshot.items,
    );
    const shortlist = preliminary
      .filter((x) => !x.context.alreadyInTrip)
      .slice(
        0,
        Math.min(
          DISCOVERY_LIMITS.routeShortlist,
          Math.floor((DISCOVERY_LIMITS.routeLookups - estimates.length) / 2),
        ),
      );
    for (const suggestion of shortlist) {
      if (context.geometry === "corridor" && previous && previousId)
        await route(
          previousId,
          previous,
          suggestion.place.providerPlaceId,
          suggestion.place.location,
        );
      if (context.geometry === "corridor" && next && nextId)
        await route(
          suggestion.place.providerPlaceId,
          suggestion.place.location,
          nextId,
          next,
        );
    }
    const rankingStarted = Date.now();
    const deterministicSuggestions = rankPlaceSuggestions(
      places,
      validated.intent,
      context,
      snapshot.candidates,
      snapshot.items,
      estimates,
    );
    const aiConfiguration = resolvePlanningAIConfiguration();
    let rerankProvider;
    try { if (aiConfiguration.rerankEnabled) rerankProvider = createPlanningAIProvider(aiConfiguration); }
    catch { rerankProvider = undefined; }
    const reranked = await rerankTravelSuggestions({
      suggestions: deterministicSuggestions,
      originalRequest: originalRequest || validated.intent.query || "Provider-backed place discovery",
      intent: validated.intent,
      provider: rerankProvider,
      enabled: aiConfiguration.rerankEnabled ?? false,
      timeoutMs: aiConfiguration.rerankTimeoutMs,
      maxCandidates: aiConfiguration.rerankMaxCandidates,
      signal: request.signal,
    });
    const suggestions = reranked.suggestions;
    if (requestId) {
      const traceDiagnostics = discoveryDiagnostics(places, validated.intent, context, estimates);
      updatePlanningAITrace(requestId, "providerDiscovery", { discoveryGeometry: context.geometry, geographicScope: context.scope, anchorSource: context.anchorSource, anchorName: context.anchorName ?? null, anchorCoordinates: context.geometry === "point" ? context.anchor : null, origin: context.corridor?.origin ?? null, destination: context.corridor?.destination ?? null, baselineRoute: context.geometry === "corridor" ? estimates.find((entry) => entry.fromId === previousId && entry.toId === nextId) ?? null : null, corridorStrategy: context.geometry === "corridor" ? "provider route geometry + bounded route-distance search windows" : null, searchWindows: searchAnchors, categories: validated.intent.categories ?? [], themes: validated.intent.preferences?.themes ?? [], maxDetourMinutes: validated.intent.maxDetourMinutes ?? null, radius: context.geometry === "corridor" ? 15000 : "provider_default", filter: stages, bias: context.anchor, rawCount: providerDiagnostics.reduce((sum, entry) => sum + entry.rawCount, 0), normalizedCount: normalizedPlaces.length, deduplicatedCount: places.length, eligibleCount: traceDiagnostics.filter((entry) => entry.accepted).length, rejectedCount: traceDiagnostics.filter((entry) => !entry.accepted).length, finalCount: suggestions.length, routeLogicalRequests: estimates.length, routeCacheHits, routeProviderCalls });
      updatePlanningAITrace(requestId, "ranking", suggestions.map((suggestion) => ({ providerPlaceId: suggestion.place.providerPlaceId, title: suggestion.place.name, distanceMeaning: suggestion.context.distanceMeaning, distanceMeters: suggestion.context.distanceMeters, detourMinutes: suggestion.context.detourMinutes ?? null, detourStatus: suggestion.context.detourStatus, finalScore: suggestion.score, accepted: true })));
      updatePlanningAITrace(requestId, "travelRelevanceReranking", { ...reranked.metadata, candidateCount: deterministicSuggestions.length, originalOrder: deterministicSuggestions.map(({ id }) => id), finalOrder: suggestions.map(({ id }) => id) });
      recordPlanningAITraceEvent(requestId, { stage: "places_discovery", sourceType: "place_provider", provider: "geoapify", model: null, status: "success", durationMs: rankingStarted - placesStarted, inputSummary: { providerRequests: providerRequestCount, searchWindows: searchAnchors.length, categories: validated.intent.categories ?? [] }, outputSummary: { rawCount: providerDiagnostics.reduce((sum, entry) => sum + entry.rawCount, 0), normalizedCount: normalizedPlaces.length, deduplicatedCount: places.length }, errorCode: null, reason: "Provider-backed candidates only" });
      recordPlanningAITraceEvent(requestId, { stage: "route_evidence", sourceType: routeProviderCalls > 0 ? "route_provider" : routeCacheHits > 0 ? "cache" : "tripflow_runtime", provider: routeProviderCalls > 0 ? "geoapify" : routeCacheHits > 0 ? "route_cache" : null, model: null, status: estimates.length ? "success" : "skipped", durationMs: 0, inputSummary: { logicalRequests: estimates.length }, outputSummary: { cacheHits: routeCacheHits, providerCalls: routeProviderCalls }, errorCode: null, reason: estimates.length ? routeProviderCalls > 0 ? "Fresh routing evidence requested; cache hits reported separately" : "Routing evidence reused from normalized cache" : "No route evidence required or available" });
      recordPlanningAITraceEvent(requestId, { stage: "deterministic_discovery_ranking", sourceType: "tripflow_deterministic", provider: "tripflow", model: null, status: "success", durationMs: Date.now() - rankingStarted - (reranked.metadata.latencyMs ?? 0), inputSummary: { eligibleCandidates: places.length }, outputSummary: { suggestionCount: deterministicSuggestions.length }, errorCode: null, reason: "Geographic, semantic, diversity, route, and duplicate rules" });
      recordPlanningAITraceEvent(requestId, { stage: "travel_relevance_reranking", sourceType: reranked.metadata.provider ? "llm" : "tripflow_runtime", provider: reranked.metadata.provider ?? null, model: reranked.metadata.model ?? null, status: reranked.metadata.used ? "success" : reranked.metadata.status === "failed" ? "fallback" : "skipped", durationMs: reranked.metadata.latencyMs ?? 0, inputSummary: { candidateCount: deterministicSuggestions.length }, outputSummary: { used: reranked.metadata.used, suggestionCount: suggestions.length }, errorCode: reranked.metadata.reason ?? null, reason: reranked.metadata.used ? "Validated supplied-ID reranking" : "Deterministic order retained" });
      recordPlanningAITraceEvent(requestId, { stage: "response_provenance", sourceType: reranked.metadata.used ? "llm" : "tripflow_deterministic", provider: reranked.metadata.used ? reranked.metadata.provider ?? null : "tripflow", model: reranked.metadata.used ? reranked.metadata.model ?? null : null, status: "success", durationMs: Date.now() - requestStarted, inputSummary: { requestId }, outputSummary: { producer: reranked.metadata.used ? `${reranked.metadata.provider} travel reranking` : "TripFlow deterministic discovery ranking", validator: "TripFlow geographic/category validation", renderer: "PlanningAssistant suggestion cards" }, errorCode: null, reason: "Discovery response ready" });
      if (selectedClarificationCandidate)
        updatePlanningAITrace(requestId, "discoveryResumed", { discoveryResumed: true, discoveryStatus: suggestions.length ? "ready" : "empty" });
    }
    if (import.meta.env.DEV && selectedClarificationCandidate)
      console.debug("Geographic clarification discovery completed", {
        discoveryResumed: true,
        discoveryStatus: suggestions.length ? "ready" : "empty",
      });
    return Response.json({
      status: "ready",
      suggestions,
      reranking: reranked.metadata,
      relevanceConfidence:
        validated.intent.preferences?.themes?.includes("seaside") ||
        validated.intent.categories?.includes("cafe")
          ? suggestions.length >= 3
            ? "full"
            : "limited"
          : "full",
      routeLookups: estimates.length,
      context: {
        anchor: context.anchor,
        anchorSource: context.anchorSource,
        discoveryGeometry: context.geometry,
        geographicScope: context.scope,
        routeGeometry: context.routeGeometry,
        anchorName: context.anchorName,
        corridor: context.corridor,
        previousItemId: context.previous?.id,
        nextItemId: context.next?.id,
        availableWindowMinutes: context.availableWindowMinutes,
      },
      ...(import.meta.env.DEV
        ? {
            diagnostics: discoveryDiagnostics(
              places,
              validated.intent,
              context,
              estimates,
            ),
            pipelineDiagnostics: {
              providerRequests: providerDiagnostics,
              rawProviderResults: providerDiagnostics.reduce(
                (sum, entry) => sum + entry.rawCount,
                0,
              ),
              normalizedProviderResults: normalizedPlaces.length,
              deduplicatedProviderResults: places.length,
              duplicateProviderResults: deduplicated.duplicates.length,
              semanticEligibleResults: semanticDiagnostics.filter(
                (entry) => entry.semanticEligibility !== "rejected",
              ).length,
              routeShortlistResults: shortlist.length,
              routeLogicalRequests: estimates.length,
              routeCacheHits,
              routeProviderCalls,
              finalResults: suggestions.length,
            },
          }
        : {}),
    });
  } catch (error) {
    if (correlatedRequestId) recordPlanningAITraceEvent(correlatedRequestId, { stage: "discovery_failure", sourceType: "tripflow_runtime", provider: null, model: null, status: "failed", durationMs: Date.now() - requestStarted, inputSummary: null, outputSummary: null, errorCode: error instanceof Error ? error.message : "UNKNOWN_ERROR", reason: "Discovery pipeline did not produce suggestions" });
    if (error instanceof DOMException && error.name === "AbortError")
      return Response.json({ error: "Discovery cancelled." }, { status: 408 });
    return Response.json(
      { error: "Place discovery is temporarily unavailable." },
      { status: 502 },
    );
  }
};
