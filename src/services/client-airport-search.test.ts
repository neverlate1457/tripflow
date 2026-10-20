import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAirportSearchClient } from "./client-airport-search";

afterEach(() => vi.unstubAllGlobals());
describe("airport search client", () => {
  it("uses the dedicated server-side airport endpoint without exposing provider credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal("fetch", fetcher);
    await new HttpAirportSearchClient().search(" tpe ");
    expect(fetcher).toHaveBeenCalledWith("/api/airports/search?q=tpe", expect.objectContaining({ signal: undefined }));
  });
});
