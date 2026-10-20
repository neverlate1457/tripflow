# Dependency security audit — 2026-10-04

Commands used: `npm audit --json`, `npm audit --omit=dev --json`, and `npm ls`.
No forced audit remediation was used.

## Applied update

| Package | Previous | Current | Finding | Assessment |
| --- | --- | --- | --- | --- |
| `drizzle-orm` | 0.44.x | 0.45.3 | SQL injection through improperly escaped dynamic identifiers (GHSA-gpj5-g38j-94v9) | Runtime dependency. The app uses static schema identifiers, but the compatible minor update removes the finding without an architectural change. |

## Remaining runtime findings

| Affected package and path | Vulnerability | Relevance | Patched version / upgrade impact |
| --- | --- | --- | --- |
| `tripflow > astro@5.18.2` | Several XSS/SSRF/base-boundary advisories plus critical AVIF optimization RCE (GHSA-26w7-cxv4-gfx2) | Astro is runtime. TripFlow does not use `define:vars`, view transitions, server islands, spread attribute names from users, or Astro image optimization/AVIF, so the vulnerable feature paths are not currently exercised. Host/error-route issues remain potentially relevant when publicly deployed. | npm recommends Astro 7.3.5. This is a two-major framework migration and was not applied automatically. |
| `tripflow > @astrojs/node@9.5.5` | Server-island body DoS, malformed cache header behavior, redirect handling, and malformed Host crash | Runtime adapter. Server islands are unused, but malformed Host handling could affect a directly exposed server. | npm recommends 11.1.6, a breaking major upgrade tied to the Astro upgrade. |
| `tripflow > astro > sharp@0.34.5` | inherited libvips/libheif memory-safety findings | Runtime transitive dependency, but TripFlow currently performs no image optimization or user image processing. | A fixed compatible transitive version is not available through the current Astro line; npm points to Astro 7.3.5. |
| `tripflow > astro > esbuild@0.27.7` | Windows development-server arbitrary file read | Bundled under a runtime dependency but relevant only to local development on Windows, not the production server bundle. Development server should remain bound to localhost. | Fixed in esbuild 0.28.1; npm resolves it through the breaking Astro 7 upgrade. |

## Remaining development-only findings

| Dependency path | Vulnerability | Relevance | Patched version / upgrade impact |
| --- | --- | --- | --- |
| `drizzle-kit > @esbuild-kit/esm-loader > @esbuild-kit/core-utils > esbuild@0.18.20` | development-server cross-origin request/read advisory | Migration CLI only; it does not serve the application. | npm's proposed downgrade to drizzle-kit 0.18.1 is breaking and inappropriate. Await upstream removal of the deprecated loader. |
| `vitest@3.2.7 > @vitest/mocker@3.2.7` | redirect-mock path traversal/arbitrary file read | Test runner only; tests do not load untrusted mock redirects. | Patched in Vitest 4.1.11; upgrading from 3 is a major test-tool migration. |
| `tailwindcss@3.4.19 > chokidar/micromatch > braces@3.0.3` | deeply nested glob stack-exhaustion DoS | Build/watch tooling only; glob patterns are repository-controlled. | npm recommends Tailwind 4.3.3, a breaking configuration/CSS migration. |

## Decision

The compatible Drizzle patch was applied. Remaining findings are accepted for
Phase 1.5 because their patched dependency trees require major framework/tooling
migrations and the high-risk feature paths are currently unused. Before public
deployment, prioritize a planned Astro 7 + Node adapter 11 upgrade and re-run
the complete build/browser regression suite.
