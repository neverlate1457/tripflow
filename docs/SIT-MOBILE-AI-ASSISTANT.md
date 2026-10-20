# TripFlow Mobile AI Assistant SIT Matrix

Target: real iPhone Safari. Automated desktop rendering or responsive emulation does not qualify as device acceptance.

## Device matrix

Run on at least one current iPhone/Safari combination at portrait and landscape orientation. Record device, iOS, Safari version, trip ID, date, and tester.

| Area | Collapsed | Half | Full | Current status |
| --- | --- | --- | --- | --- |
| Sheet height and transition | Header remains reachable above bottom navigation | Interactive map remains visible above sheet | Content remains scrollable without page overflow | MANUAL PENDING |
| Safe area / browser chrome | Does not overlap home indicator or bottom navigation | Stable while Safari address bar expands/collapses | Top remains below status/browser safe area | MANUAL PENDING |
| Virtual keyboard | Re-expansion controls remain reachable | Input remains visible and map is not trapped | Input and latest message remain reachable | MANUAL PENDING |
| Rotation | State survives portrait ↔ landscape | Map calls resize and remains interactive | No clipped input or horizontal overflow | MANUAL PENDING |
| Touch / keyboard | All controls at least 44×44; VoiceOver labels announced | Drag handle moves one state per gesture | Tab/Enter activates controls and close | MANUAL PENDING |

## Functional scenarios

| ID | Steps | Expected result | Status |
| --- | --- | --- | --- |
| M-A1 | Open Ask TripFlow from Planner | Mobile Map opens with sheet half-expanded; map gestures work above sheet | MANUAL PENDING |
| M-A2 | Drag handle down/up through all states | Collapsed → Half → Full and reverse; no accidental map gesture | MANUAL PENDING |
| M-A3 | Focus input, show keyboard, collapse browser toolbar | Input is not covered; sheet uses visible viewport; no nested scroll trap | MANUAL PENDING |
| M-A4 | Rotate in each state | Current state and content survive; MapLibre resizes | MANUAL PENDING |
| M-A5 | Search `找宮崎市景點`, choose View on map | Grounded Miyazaki POI centers and blue suggestion marker highlights; no Add to trip | MANUAL PENDING |
| M-A6 | Search `福岡到小倉沿途咖啡廳`, choose View on map | POI centers while the corridor route remains visible | MANUAL PENDING |
| M-B1 | Successful request | Exact user prompt and matching requestId remain beside assistant result | MANUAL PENDING |
| M-B2 | Provider/runtime failure | User prompt and requestId remain; source badge and failure trace agree | MANUAL PENDING |
| M-B3 | Cancel an in-flight request | Prompt remains; cancelled response never replaces newer state | MANUAL PENDING |
| M-B4 | Submit two requests quickly | Only the newest interpretation, suggestions, trace and requestId render | MANUAL PENDING |
| M-B5 | Switch Planner/Explore/Map/Candidates and return | Current prompt, suggestions and trace remain; no canonical mutation | MANUAL PENDING |
| M-C1 | Ishigaki trip: `找宮崎市景點` | `city_area`, `宮崎市`, `attraction`; no Ishigaki fallback | MANUAL PENDING |
| M-C2 | Inspect Execution Trace | Initial and repair events correlate to visible requestId; no raw secrets | MANUAL PENDING |

## Acceptance rule

SIT is GO only after every MANUAL PENDING row is executed on real iPhone Safari with no open severity-1/2 defect. Automated checks support the decision but cannot replace this matrix.
