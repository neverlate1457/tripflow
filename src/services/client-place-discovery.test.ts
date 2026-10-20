import { describe, expect, it, vi } from "vitest";
import { HttpPlaceDiscoveryClient } from "./client-place-discovery";

describe("HttpPlaceDiscoveryClient clarification", () => {
  it("resumes with only the opaque token and selected candidate id", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ status: "ready", suggestions: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new HttpPlaceDiscoveryClient(fetcher as typeof fetch);
    await client.resume("opaque-token", "opaque-candidate");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe("/api/places/discover");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ clarificationToken: "opaque-token", selectedCandidateId: "opaque-candidate" });
  });

  it("surfaces an expired-session code without invoking an AI endpoint", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ error: "expired", code: "expired" }), { status: 410, headers: { "content-type": "application/json" } }));
    const client = new HttpPlaceDiscoveryClient(fetcher as typeof fetch);
    await expect(client.resume("old", "candidate")).rejects.toMatchObject({ code: "expired" });
    expect(fetcher.mock.calls.every(([url]) => String(url) === "/api/places/discover")).toBe(true);
  });
});
