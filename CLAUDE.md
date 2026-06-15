# CLAUDE.md — PrimePath Travel: Exploratory Travel Dashboard

Project context for Claude Code. Read this before making changes.

## What this project is

A **full-stack SAP CAP application** for the (fictional) customer *PrimePath Travel*, deployed
on **SAP BTP (Cloud Foundry)**. School assignment (Erasmushogeschool Brussel + Flexso), built by
a two-person team. Final demo: **19 June**.

It is an **exploratory dashboard**: users browse, filter and click through to answer questions —
NOT an operational booking tool. Core objects: **Employees (People), Trips, Airlines, Airports**,
sourced from the public **TripPin OData V4** service (read-only). Our own persistable fields live
in a CAP-managed database (`TripExtension`).

Three roles via XSUAA: **TravelCoordinator** (read/write, approve/reject), **TeamLead** (read),
**HR** (read, reporting).

## Scope & team split

- **This is the frontend team's machine — work on the frontend only**: the SAPUI5 app under
  `app/dashboard/webapp/`.
- **Decision: do NOT change the backend.** Do not modify `srv/`, `db/`, or `xs-security.json`.
  The backend (CAP services, data model, XSUAA, BTP deploy) is the other team's area. The
  previously-considered backend rework (per-employee company/team store) is **dropped**.
- See "Backend (other team's area)" for the one historical exception and what currently exists.

## Tech stack

- **Backend:** SAP CAP, Node.js (`@sap/cds` v9) — proxies TripPin + a small CAP DB.
- **Frontend:** **Freestyle SAPUI5** — XML views + JS controllers. NOT Fiori Elements, NOT React.
  Tab dashboard (Overview · Employees · Airports) with heavy cross-navigation. UI5 **1.136** from
  the CDN (`https://ui5.sap.com/1.136/`), theme `sap_fiori_3`. Follow Fiori guidelines (sap.m /
  sap.f controls) so it looks like an SAP app.
- **UI5 libraries used** (`manifest.json` deps): `sap.ui.core`, `sap.m`, `sap.f`,
  `sap.suite.ui.microchart` (Overview charts). **Leaflet/OpenStreetMap** (loaded from CDN in
  `index.html`) is used for the airport map because `sap.ui.vbm`/GeoMap is not in the 1.136 CDN.
- **Local DB:** SQLite · **Prod DB:** SAP HANA Cloud.
- **External data:** TripPin — `https://services.odata.org/V4/TripPinService`.
- **Deploy target:** BTP Cloud Foundry (approuter + XSUAA + Destination Service).

> A Figma mockup exists (`primepath_analyse.pdf` / Figma Make React code). It is **reference
> only** — match layout/intent with SAPUI5 controls, never reuse the code or the exact pixels.

## Repo layout (frontend)

`app/dashboard/webapp/`
- `Component.js` — app-wide data cache + derived-data accessors + role context.
- `manifest.json` — 4 named OData V4 models, routes, library deps.
- `index.html` — UI5 bootstrap + Leaflet (deferred).
- `controller/` — `BaseController.js` + one controller per view.
- `view/` — XML views + fragments (`SearchResults.fragment.xml`, `LocationPopover.fragment.xml`).
- `util/` — `constants.js`, `formatters.js`, `searchFilter.js`, `Aggregate.js`.
- `i18n/i18n.properties` — all UI texts (bind with `{i18n>key}`; in controllers
  `this.getResourceBundle().getText("key")`).

`srv/`, `db/`, `xs-security.json`, `mta.yaml`, `approuter/` — **backend team's area; do not edit.**

## Commands & local run

- `npm install`, then `cds watch` (port **4004**, mocked auth). Arda runs the server and commits
  himself — **do not auto-start `cds watch`**; pause for a manual commit between features.
- Local test users (in `package.json` `cds.requires.auth.users`): `coordinator` / `teamlead` /
  `hr`, password `test`. Browsers cache basic auth — use an incognito window to switch users.
- Verify edits: `node --check <file>.js` for controllers/util, and check views are well-formed
  XML (e.g. PowerShell `[xml](Get-Content …)`). Manual browser testing for behaviour. (No
  Playwright/headless harness is installed.)

## Hard domain rules

- **Never write to TripPin.** The only mutation is approval status, stored in `TripExtension`
  (CAP DB) — never touches TripPin.
- **`TripId` is unique only within a person.** TripPin has no flat Trips collection — trips are
  containment under `People('user')/Trips`. Any trip navigation carries **`personUserName` +
  `tripId`** together. This is why the app is **employee-centric**.
- **Shared trips:** the same real trip can belong to several people. Each person has their **own
  copy** with a different `TripId` but a **shared `ShareId`** (GUID). TripPin only populates
  flights (`PlanItems`) on *some* copies — the app reconciles this (see Trip detail).
- **No Trips landing tab** — trips are reached via Employees and Airports. Do not add one.

## Frontend architecture & key patterns

### Shell & routing (`view/App.view.xml`, `controller/App.controller.js`)
ShellBar (with the global-search `SearchManager`) + `IconTabHeader` (Overview · Employees ·
Airports) + a `NavContainer` (id `content`) inside a `VBox height="100vh"` + `FlexItemData`
(percentage heights break here — UI5 inserts unstyled wrapper divs, so the shell uses `100vh` +
flex). Routes (route name = tab key; detail routes map to their parent tab in `App.controller`):
- `""` → Overview · `employees` → Employees · `employees/{userName}` → EmployeeDetail
- `employees/{userName}/trips/{tripId}` → TripDetail · `airports` → Airports
- `airports/{iata}` → Airports (`airportFocus`, focuses the map on one airport)

`controller/BaseController.js` — base for all controllers: `getRouter()`, `getResourceBundle()`.

### Models & app-wide cache (`Component.js`)
Four named OData V4 models (`people`, `trips`, `airlines`, `airports`; `autoExpandSelect`,
`operationMode: Server`, `earlyRequests`). Bind with the prefix, e.g. `{people>/People}`.
TripPin is slow, so the Component memoises everything (each accessor stores a **Promise**, so
concurrent first-callers share one request; **rejected promises are evicted** so retries work):
- `getCachedList(model, path)` — `/People`, `/Airports`, `/Airlines`.
- `getCachedTrips(user)` — `/PersonTrips` filtered by `personUserName`.
- `getCachedFlights(user, tripId)` — `/PlanItems` filtered by `personUserName` + `tripId`
  (`$select` includes from/to IATA+name+city, airline, times, seat).
- `getTripData()` — `[{ person, trips }]` (people + a per-person trips burst). Used by Overview,
  Employees (status), and TripDetail (co-travellers).
- `getFlightData()` — `{ perPerson, pairs }`, each pair `{ user, tripId, tripName, shareId,
  flights }`. The flight burst coalesces into one `$batch` under `$auto`.
- `getFlightAggregate()` — all-time aggregate (top airlines/routes + `byAirport`), memoised.
- `getAirportsByIata()` — IATA → airport-object map (O(1) lookup), memoised.
- `_loadCurrentUser()` — `GET /user/whoami()` → an `app` JSON model
  `{ user: { id, roles, isCoordinator } }` for role-gating.

**Cache-safety rule (the #1 regression risk):** cached arrays/objects are shared. **Never mutate
them** — always `.slice()` before `.sort()`, and build augmented copies (`Object.assign({}, x,
{…})`) before adding fields. `TripExtensions` is **not** cached (it's writable) — TripDetail reads
it live so approve/reject/submit reflect immediately.

### Aggregation (`util/Aggregate.js`, pure / model-free)
- `aggregateTrips(perPerson, range?)` → `{ trips, budget, topTravellers }`.
- `aggregate(rawData, range?)` → `{ kpis, topTravellers, topAirlines, topRoutes, byAirport }`.
  **Numeric counts** (charts need a measure). Trip metrics use *trip-overlaps-range*; flight
  metrics use *flight-departs-in-range*.
- `byAirport[iata] = { departures, arrivals, total, trips: [{ tripName, user, tripId,
  travellers }] }`. **Trips are grouped by `ShareId`** (one entry per real trip, not per copy);
  the representative `{user,tripId}` is a copy that has flights; `travellers` = all people on
  that trip.

### Utilities
- `util/constants.js` — page sizes, `TOP_N`, Leaflet view/zoom, `MS_PER_DAY`.
- `util/formatters.js` — `formatEmails`, `formatCity`, `formatPeriod` (assigned as controller
  methods so XML `formatter: '.formatEmails'` bindings resolve).
- `util/searchFilter.js` — one client-side contains-filter (Employees, Airports, global search).
  Filtering is client-side over the cached sets.

### Cross-cutting gotchas
- **`layoutData` aggregation namespace must match its parent's** in XML views: `<core:layoutData>`
  under `<core:HTML>`, `<f:layoutData>` under `<f:Card>`, plain `<layoutData>` under a `sap.m`
  control. A namespace mismatch makes the whole view fail to instantiate.
- **Leaflet:** map div lives in a `sap.ui.core.HTML` control; GeoJSON is `[lon, lat]` → flip to
  `[lat, lon]`. Call `map.invalidateSize()` (next tick) when the tab is re-shown after being
  hidden, else tiles render grey.
- **ComparisonMicroChart** needs a container with a definite height (`size="Responsive"`).
- **Responsive cards/tiles** fill wide screens via `FlexItemData growFactor` + `baseSize`.
- **Role gating:** coordinator-only UI binds `visible="{app>/user/isCoordinator}"`.

## Implemented features (current state)

**Overview** (`Overview.view/controller`) — landing page.
- Period `DateRangeSelection`: Trips, Budget, Top Travellers, Top Airlines, Top Routes recompute
  for the chosen range (from cached data, no network); entity counts stay constant; empty =
  all-time.
- 5 KPI tiles (`GenericTile`/`NumericContent`, grow to fill the row): employees, trips, total
  budget, airports, airlines.
- Top Travellers (`sap.f.Card` list) + Top Airlines and Top Routes as **`ComparisonMicroChart`**
  (horizontal bar charts). All three cards grow responsively. Progressive load: tiles + travellers
  first, charts after the flight burst (own busy indicator).

**Employees** (`Employees.view/controller`).
- Searchable table (name/username/email, client-side) + a **Status filter** (`Select`) and a
  **Status badge** column (`ObjectStatus`): *Traveling / Upcoming / Available*, derived from each
  person's trips vs today (built on augmented copies — never mutating the cache). Click → detail.

**Employee detail** (`EmployeeDetail.view/controller`).
- Large name header (`sap.m.Title titleStyle="H1"`) + email/city (no username).
- Three trip-counter tiles: Total / Upcoming / Completed (over the person's full trip set).
- Trips table with a period `DateRangeSelection`; a **"Locate on date"** button opens
  `LocationPopover.fragment.xml` (a `DatePicker` → where the person was that day: on a trip / at
  home).

**Trip detail** (`TripDetail.view/controller`) — reached via a trip row.
- The **flight-route block** (origin→destination, departure/arrival airport cards with
  coordinates and "trips via airport") and the **"Travellers on this trip"** panel sit **side by
  side** (`FlexBox`). The route is hidden when there are no flights.
- **Shared-trip handling:** co-travellers = everyone sharing the `ShareId` (including the current
  person), click → their detail. If the current person's copy has **no flights**, flights are
  **borrowed from a co-traveller's copy** that has them, so every copy shows the same route.
- Flights table (`PlanItems`): flight no.+airline, From/To (Links → airport focus), departure/
  arrival, seat. Trip details panel (description). Approval panel = **status only** (`ObjectStatus`).
- Coordinator-only footer: **Submit** (a confirm dialog → creates a pending `TripExtension`),
  **Approve**, **Reject** (bound `TripsService.approve` / `rejectTrip` actions, then reload).

**Airports** (`Airports.view/controller`).
- **Leaflet map** (marker per airport) on the left + an **always-on right `NavContainer`
  sidebar**: a **list page** (search + all airports) and a **detail page** (airport facts, a
  relative *traffic level*, and "trips via this airport" **grouped by trip** with a traveller
  count). Clicking a list item **or a map pin** opens the detail page; the page's back button
  returns to the list. Trips-via rows → trip detail.
- Cross-nav: a flight's From/To Link → `airports/{iata}` focuses the map and opens that detail.

**Global search** (`App.controller` + `SearchResults.fragment.xml`).
- ShellBar `SearchManager` → a grouped results dialog across employees/airports/airlines
  (client-side over cached data). Click: employee → detail, airport → focus, airline → toast.

## Data caveats (TripPin reality — worth stating in the demo)

- **TripPin is a public, writable demo service and is polluted** by other people's test accounts
  (`Jdbc*`, sometimes with **duplicate keys**). Duplicate keys make the UI5 OData V4 model reject
  the whole `/People` collection ("data not loading"). The People proxy sanitises this (see
  Backend note).
- **Trip dates are mostly historical (~2014)**, so employee Status and the trip counters skew to
  *Available / Completed*, and the Overview period filter needs a **wide** range to show data.
- **Flights (`PlanItems`) exist only on some trip copies.** Shared trips reconcile this via the
  `ShareId` flight-borrow above.
- Aggregates (top airlines/routes, airport stats) reflect the **loaded** set.

## Backend (other team's area — context only; do not modify)

Four proxy services (people/airports/airlines/trips) forwarding to TripPin, plus:
- `srv/user-service.{cds,js}` — `/user/whoami()` returning `{ id, roles[] }`; the frontend reads
  it for role-gating.
- `TripExtension` (CAP DB, key `personUserName + tripId`) — holds `approvalStatus` (the frontend
  uses only this now); `TripsService.approve` / `rejectTrip` actions update it.
- `srv/trips-service.js` — a `PlanItems` handler returning flattened flight rows.
- **One historical exception (flagged for the backend team):** `srv/people-service.js` dedupes
  `/People` by `UserName` and drops `Jdbc*` junk, because TripPin's duplicate keys otherwise crash
  the UI5 model. This is the only backend change; **no further backend changes are planned.**

## Out of scope / decisions

- Writing to TripPin; Events / unused TripPin data; real-time updates; a Trips landing tab;
  mobile-first (desktop primary, but stay responsive).
- **Company/Team on trips** — removed. Approval is the only trip metadata. Company/team were
  considered as *per-employee* fields but that needs a backend store, which is **not built**
  (no more backend work).
- **"Add trip"** (a coordinator creating a trip in our own DB) — not built (needs backend).
- BTP serving of the UI (approuter html5/static module) — backend/deploy team's concern.

## Working style

- One feature at a time; verify in the browser; pause for a manual commit between features.
- Prefer standard SAPUI5/Fiori patterns (sap.m/sap.f, OData V4 model, manifest routing) over
  hacks — grading tests SAP-stack understanding.
- The frontend team is new to SAPUI5 — when introducing a concept (bindings, routing, fragments),
  add a 2–3 line explanation, not an essay.
- When unsure about a TripPin field/relation, inspect the live service at port 4004 (or
  `srv/external/TripPin.cds` for reference).
