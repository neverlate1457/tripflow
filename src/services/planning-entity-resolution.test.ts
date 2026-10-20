import { describe, expect, it } from "vitest";
import { validClarificationSelectionCount, type AITripContext } from "@/domain/ai-planning";
import { implicitDiscoveryIntent } from "./planning-ai-provider";
import { normalizeCandidateTitle, resolvePlanningEntities } from "./planning-entity-resolution";

const candidates = [
  { id: "sea", title: "エメラルドの海を見る展望台", type: "place", estimatedDuration: 90 },
  { id: "cafe", title: "Blue Café", type: "place", estimatedDuration: 60 },
  { id: "place", title: "Interesting Place", type: "place", estimatedDuration: 60 },
];
const context: AITripContext = { trip: { id: "trip", name: "Ishigaki", timezone: "Asia/Tokyo", startDate: "2026-10-06", endDate: "2026-10-06" }, selectedDate: "2026-10-06", items: [], candidates, issues: [], proposalIds: [] };
const resolve = (message: string, value = context) => resolvePlanningEntities({ message, context: value });

describe("canonical planning entity resolution", () => {
  it.each([
    "幫エメラルドの海を見る展望台找一個今天下午的時間。",
    "把エメラルドの海を見る展望台安排到今天下午。",
  ])("resolves the canonical title before discovery semantics: %s", (message) => {
    const result = resolve(message);
    expect(result.resolvedCandidateIds).toEqual(["sea"]);
    expect(result.deterministicInterpretation).toMatchObject({ status: "resolved", intent: { type: "insert_candidate", candidateId: "sea", timeWindow: { start: "12:00", end: "18:00" } } });
  });
  it("normalizes Unicode, whitespace, case, and punctuation without fuzzy matching", () => {
    expect(normalizeCandidateTitle("  BLUE café！ ")).toBe(normalizeCandidateTitle("Blue Café"));
    expect(resolve("幫 BLUE café！ 安排到下午").resolvedCandidateIds).toEqual(["cafe"]);
  });
  it("does not reinterpret discovery words inside matched Candidate titles", () => {
    expect(resolve("幫エメラルドの海を見る展望台找時間").deterministicInterpretation).toMatchObject({ status: "resolved", intent: { type: "insert_candidate" } });
    expect(resolve("schedule Blue Café this afternoon").deterministicInterpretation).toMatchObject({ status: "resolved", intent: { candidateId: "cafe" } });
    expect(resolve("find a time for Interesting Place").deterministicInterpretation).toMatchObject({ status: "resolved", intent: { candidateId: "place" } });
  });
  it("returns ambiguity for duplicate normalized titles", () => {
    const duplicate = { ...context, candidates: [...candidates, { ...candidates[1], id: "cafe-2", title: "BLUE CAFÉ!" }] };
    expect(resolve("安排 Blue Café 到下午", duplicate)).toMatchObject({ resolvedCandidateIds: [], ambiguityReason: expect.any(String), deterministicInterpretation: { status: "clarification_required" } });
  });
  it("resolves counted and whole Want to go references only when deterministic", () => {
    expect(resolve("幫我把這三個想去的地方安排進今天下午 12 點到 6 點，盡量減少移動時間。")).toMatchObject({ pluralResolution: "count_exact", resolvedCandidateIds: ["sea", "cafe", "place"], deterministicInterpretation: { status: "resolved", intent: { type: "insert_candidates", timeWindow: { start: "12:00", end: "18:00" } } } });
    expect(resolve("schedule these three places")).toMatchObject({ pluralResolution: "count_exact", resolvedCandidateIds: ["sea", "cafe", "place"] });
    expect(resolve("schedule these places in Want to go")).toMatchObject({ pluralResolution: "all", resolvedCandidateIds: ["sea", "cafe", "place"] });
    const five = { ...context, candidates: [...candidates, { ...candidates[0], id: "four", title: "Four" }, { ...candidates[0], id: "five", title: "Five" }] };
    expect(resolve("schedule these three places", five)).toMatchObject({ pluralResolution: "ambiguous", resolvedCandidateIds: [], deterministicInterpretation: { status: "clarification_required" } });
  });
  it("uses bounded multi-select clarification for an unidentified plural collection",()=>{
    const five = { ...context, candidates: [...candidates, { ...candidates[0], id: "four", title: "Four" }, { ...candidates[0], id: "five", title: "Five" }] };
    const result=resolve("幫我安排幾個 Want to go 的地方到下午",five);
    expect(result).toMatchObject({resolvedCandidateIds:[],pluralResolution:"ambiguous",deterministicInterpretation:{status:"clarification_required",selectionMode:"multiple",minSelections:2,maxSelections:5,candidateScheduling:{timeWindow:{start:"12:00",end:"18:00"}}}});
    expect(result.deterministicInterpretation?.status==="clarification_required"?result.deterministicInterpretation.options?.map((x)=>x.candidateId):[]).toEqual(["sea","cafe","place","four","five"]);
  });
  it.each([["幫我安排三個 Want to go 的地方到下午",3],["幫我安排兩個 Want to go 的地方到下午",2]])("requires the exact requested Candidate count for %s",(message,count)=>{
    const five = { ...context, candidates: [...candidates, { ...candidates[0], id: "four", title: "Four" }, { ...candidates[0], id: "five", title: "Five" }] };
    expect(resolve(message,five).deterministicInterpretation).toMatchObject({status:"clarification_required",selectionMode:"multiple",minSelections:count,maxSelections:count});
    expect(validClarificationSelectionCount(count-1,count,count)).toBe(false);
    expect(validClarificationSelectionCount(count,count,count)).toBe(true);
    expect(validClarificationSelectionCount(count+1,count,count)).toBe(false);
  });
  it("keeps singular canonical Candidate scheduling unchanged",()=>{
    const single={...context,candidates:[{id:"iwor",title:"IWOR-UN-PASE-KAMUY",type:"place",estimatedDuration:60}]};
    expect(resolve("幫 IWOR-UN-PASE-KAMUY 找時間",single)).toMatchObject({resolvedCandidateIds:["iwor"],deterministicInterpretation:{status:"resolved",intent:{type:"insert_candidate",candidateId:"iwor"}}});
  });
  it("keeps unresolved scheduling out of discovery and leaves explicit discovery intact", () => {
    expect(resolve("安排不存在的景點到下午")).toMatchObject({ scheduling: true, resolvedCandidateIds: [], ambiguityReason: expect.any(String) });
    for (const message of ["下午可以去哪？", "下午想找可以看海的地方", "附近有什麼咖啡廳？"]) {
      expect(resolve(message).scheduling).toBe(false);
      expect(implicitDiscoveryIntent(message, context)).toMatchObject({ type: "discover_places" });
    }
  });
});
