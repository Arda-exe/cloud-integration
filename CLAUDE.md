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

Two-person team, split by area. The two areas are **separately owned** — work within your own
area and coordinate across the line rather than silently editing the other side.

- **Frontend** — the freestyle SAPUI5 app under `app/dashboard/webapp/` (XML views, JS
  controllers, client-side aggregation, manifest routing, i18n).
- **Backend** — the SAP CAP layer: `srv/` (CAP services proxying TripPin + the user service),
  `db/` (CAP data model), `xs-security.json` (XSUAA roles/scopes), and `mta.yaml` + `approuter/`
  (BTP Cloud Foundry deploy).

The frontend does **not** make backend changes on its own. Anything the UI needs from the CAP
layer is written down under **"What the frontend wants from the backend"** and handed to the
backend side (e.g. the dropped per-employee company/team store needed a backend table that was
never built).

## Tech stack

- **Backend:** SAP CAP, Node.js (`@sap/cds` v9) — proxies TripPin + a small CAP DB.
- **Frontend:** **Freestyle SAPUI5** — XML views + JS controllers. NOT Fiori Elements, NOT React.
  Tab dashboard (Overview · Employees · Airports) with heavy cross-navigation. UI5 **1.136** from
  the CDN (`https://ui5.sap.com/1.136/`), theme `sap_fiori_3`. Follow Fiori guidelines (sap.m /
  sap.f controls) so it looks like an SAP app.
- **UI5 libraries used** (`manifest.json` deps): `sap.ui.core`, `sap.m`, `sap.f`. (The Overview
  Top Airlines/Routes charts are plain `sap.m.ProgressIndicator` bars, so `sap.suite.ui.microchart`
  is no longer a dependency.) **Leaflet/OpenStreetMap** (loaded from CDN in
  `index.html`) is used for the airport map because `sap.ui.vbm`/GeoMap is not in the 1.136 CDN.
- **Local DB:** SQLite · **Prod DB:** SAP HANA Cloud.
- **External data:** TripPin — `https://services.odata.org/V4/TripPinService`.
- **Deploy target:** BTP Cloud Foundry (approuter + XSUAA + Destination Service).

> A Figma mockup exists (`primepath_analyse.pdf` / Figma Make React code). It is **reference
> only** — match layout/intent with SAPUI5 controls, never reuse the code or the exact pixels.

## Repo layout

### Frontend — `app/dashboard/webapp/`
- `Component.js` — app-wide data cache + derived-data accessors + role context.
- `manifest.json` — 4 named OData V4 models (`people`/`trips`/`airlines`/`airports` → the
  backend services `/people/`, `/trips/`, `/airlines/`, `/airports/`), routes, library deps.
- `index.html` — UI5 bootstrap + Leaflet (deferred).
- `controller/` — `BaseController.js` + one controller per view.
- `view/` — XML views + fragments (`SearchResults.fragment.xml`, `LocationPopover.fragment.xml`).
- `util/` — `constants.js`, `formatters.js`, `searchFilter.js`, `Aggregate.js`, `datePresets.js`.
- `i18n/i18n.properties` — all UI texts (bind with `{i18n>key}`; in controllers
  `this.getResourceBundle().getText("key")`).

### Backend — `srv/`, `db/`, security, deploy
- `srv/*-service.cds` + `*-service.js` — CAP services. `people` / `airports` / `airlines` /
  `trips` proxy the TripPin OData V4 service; `user-service` exposes `/user/whoami()` for
  role-gating. (Behaviour detailed under "Backend services (CAP)".)
- `srv/external/TripPin.{cds,xml}` — imported TripPin metadata; the reference for TripPin
  field/relation names.
- `db/schema.cds` — the CAP data model: `TripExtension` (key `tripId` + `personUserName`;
  `approvalStatus` + audit fields; the `company`/`team`/`notes` columns still exist but are
  **unused by the current UI**).
- `xs-security.json` — XSUAA role templates / scopes (TravelCoordinator, TeamLead, HR).
- `mta.yaml`, `approuter/` — BTP Cloud Foundry deploy (approuter + XSUAA + Destination Service).

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
ShellBar (global-search `SearchManager`, `secondaryTitle` = active role, a **"Switch role"**
`ShellBarItem` → launchpad) + `IconTabHeader` (Overview · Employees · Airports) + a `NavContainer`
(id `content`) inside a `VBox height="100vh"` + `FlexItemData` (percentage heights break here — UI5
inserts unstyled wrapper divs, so the shell uses `100vh` + flex). The IconTabHeader binds
`visible="{app>/showChrome}"` — hidden on the launchpad, shown inside the app (`App.controller`
sets `/showChrome` in `onRouteMatched`). Routes (route name = tab key; detail routes map to their
parent tab; the launchpad has no tab and is handled by an early return):
- `""` → **Launchpad** (role picker, default) · `overview` → Overview · `employees` → Employees
- `employees/{userName}` → EmployeeDetail · `employees/{userName}/trips/{tripId}` → TripDetail
- `airports` → Airports · `airports/{iata}` → Airports (`airportFocus`, focuses one airport)

`controller/BaseController.js` — base for all controllers: `getRouter()`, `getResourceBundle()`.

### Models & app-wide cache (`Component.js`)
Four named OData V4 models (`people`, `trips`, `airlines`, `airports`; `autoExpandSelect`,
`operationMode: Server`, **`earlyRequests: false`** — deferred so the launchpad renders with no
authenticated request / Basic-auth dialog before a role is picked). Bind with the prefix,
e.g. `{people>/People}`.
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
- `getPersonExtensions()` — `personUserName` → `{team,company,department,status}` map
  (`/people/PersonExtensions`), memoised. Joined client-side on `UserName` for team/company.
- `_loadCurrentUser()` — `GET /user/whoami()` → the `app` JSON model
  `{ showChrome, user: { id, roles, isCoordinator, roleLabel } }`. Sends the `Authorization`
  header set by `_applyLocalAuth` (local); on BTP relies on the forwarded XSUAA session. **Not
  called on the BTP public launchpad** — that route is unauthenticated, so a `whoami` XHR would be
  302'd to login.
- `_applyLocalAuth(role)` — local mock-auth only: injects `Authorization: Basic
  <coordinator|teamlead|hr>:test` into the 4 OData models via `ODataModel.changeHttpHeaders(...)`
  and sets the role context. Shared by `loginAs` (tile click) and `init` (restore after refresh).
- `loginAs(role)` — **real per-role login** (see "Launchpad"). Local: `_applyLocalAuth(role)` +
  remembers the role in `sessionStorage` `primepath.role`, then navigates to the landing tab. BTP
  public launchpad: stores the landing tab in `sessionStorage` `primepath.landing`, then a
  full-page `window.location.assign("/secure/index.html")` so the approuter forces the XSUAA login
  (a `#hash` would not survive the redirect — hence `sessionStorage`).
- `logout()` (the "Switch role" action) — local: clears `primepath.role` + the auth/user context →
  back to the launchpad; BTP: `window.location.assign("/logout")` (approuter logout → public
  launchpad).
- `init` has **three boot modes** and reads `window.location.hash` **before** `router.initialize()`
  so a **refresh keeps the current page** (it only auto-routes to a landing when there is no
  deep-link): **local** (`localhost`) restores any saved `primepath.role` then shows the launchpad
  picker; **BTP secure** (path under `/secure/`) behaves as logged-in and routes by the saved
  landing or the real whoami role; **BTP public** (`/dashboard/webapp/`) shows only the launchpad,
  no whoami. Role maps live at the top of `Component.js` (`ROLES`, `ROLE_LANDING`, `ROLE_USER`).

**Cache-safety rule (the #1 regression risk):** cached arrays/objects are shared. **Never mutate
them** — always `.slice()` before `.sort()`, and build augmented copies (`Object.assign({}, x,
{…})`) before adding fields. `TripExtensions` (approval status) is memoised by
`Component.getTripExtensions()` (the `personUserName|tripId → status` map used for approved-only
counting), but **evicted on every approval mutation** (`_pTripExt`/`_pFlightAgg` are cleared in
the AllTrips approve/reject/submit/own-trip handlers) so approve/reject/submit reflect
immediately. Own-trip `approvalStatus` lives in the trip cache itself, not in this map.

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
- `util/datePresets.js` — `rangeFor(key)` → `{from,to}` (or `null` = all-time) for the
  period quick-select buttons; relative to today, shared by Overview + Employee detail.
- `util/tripGroups.js` — `groupTrips(perPerson, extMap)`: pure, model-free grouping of trip copies
  into one group per real trip (`ShareId || user|tripId`) with a `members` array (per traveller:
  budget + `statusKey` + `canSubmit`/`canAct`), `totalBudget`, and `repUserName`/`repTripId`.
  Cache-safe (emits fresh objects). Shared by **All Trips** (grouped list) + **Trip detail**
  (combined + per-user budget).

### Cross-cutting gotchas
- **`layoutData` aggregation namespace must match its parent's** in XML views: `<core:layoutData>`
  under `<core:HTML>`, `<f:layoutData>` under `<f:Card>`, plain `<layoutData>` under a `sap.m`
  control. A namespace mismatch makes the whole view fail to instantiate.
- **Leaflet:** map div lives in a `sap.ui.core.HTML` control; GeoJSON is `[lon, lat]` → flip to
  `[lat, lon]`. Call `map.invalidateSize()` (next tick) when the tab is re-shown after being
  hidden, else tiles render grey.
- **Overview bar charts** are `sap.m.ProgressIndicator` rows (one per airline/route, `percentValue`
  = share of the busiest) inside a fixed-height `sap.f.Card` wrapped in a `ScrollContainer`, so the
  full (uncapped) airline/route lists scroll. Airlines with 0 flights show an empty bar.
- **Responsive cards/tiles** fill wide screens via `FlexItemData growFactor` + `baseSize`.
- **Role gating:** coordinator-only UI binds `visible="{app>/user/isCoordinator}"`.

## Implemented features (current state)

**Launchpad / role login** (`Launchpad.view/controller`, `Component.loginAs`) — the default
screen (`""`). Three `GenericTile` panels (TravelCoordinator · TeamLead · HR; role carried via
`app:` customData). Clicking a panel performs a **real per-role login** and routes to that role's
landing tab: **Coordinator & TeamLead → Employees, HR → Overview**. Locally (`cds watch`, mocked
Basic auth) it injects the matching mock-user credentials so the backend genuinely enforces the
role (only Coordinator can approve/reject), and the chosen role is kept in `sessionStorage` so a
**refresh stays on the current page** instead of bouncing back here. The tab bar + Switch-role
button are hidden here (`app>/showChrome`); the ShellBar's **Switch role** action calls
`Component.logout()`. On BTP the launchpad is served **publicly** (no login yet); clicking a tile
does a full-page jump to the xsuaa-protected `/secure/` route, which makes the approuter present
the **real XSUAA login**, after which the app opens under `/secure/` with the role/permissions from
the XSUAA user (the tile only picks the landing tab, carried via `sessionStorage`). The approuter
wiring lives in `approuter/xs-app.json` — see "Backend services".

**Overview** (`Overview.view/controller`) — landing page.
- Period `DateRangeSelection` + quick-preset buttons (All time · Last month · Last 3 months ·
  Last year, via `util/datePresets.js`): Trips, Budget, Top Travellers, Top Airlines, Top Routes
  recompute for the chosen range (from cached data, no network); entity counts stay constant;
  empty = all-time. The active preset is highlighted (`view>/preset`); editing the range manually
  clears it. NB: TripPin dates are ~2014, so the *relative* presets are usually empty on the demo
  data — **All time** is what shows everything.
- 5 KPI tiles (`GenericTile`/`NumericContent`, grow to fill the row): employees, trips, total
  budget, airports, airlines.
- Top Travellers (`sap.f.Card` list) + Top Airlines and Top Routes as **`sap.m.ProgressIndicator`
  bars** (horizontal bar charts; **all** airlines/routes, scrollable, equal-height cards; airlines
  with 0 flights are listed too). All three cards grow responsively. Progressive load: tiles +
  travellers first, charts after the flight burst (own busy indicator).

**Employees** (`Employees.view/controller`).
- Searchable table (name/username/email, client-side) + a **Status filter** (`Select`) and a
  **Status badge** column (`ObjectStatus`): *Traveling / Upcoming / Available*, derived from each
  person's trips vs today (built on augmented copies — never mutating the cache). Click → detail.
- **Team & Company** columns + two `Select` filters (distinct values, "All" sentinel prepended in
  JS), from `Component.getPersonExtensions()` (`/people/PersonExtensions`) joined on `UserName`.
- An **"All trips"** button (toolbar) → the All Trips view (`onAllTrips` → `navTo("allTrips")`).

**Employee detail** (`EmployeeDetail.view/controller`).
- Large name header (`sap.m.Title titleStyle="H1"`) + email/city (no username) + **Team/Company**
  (loaded into `detail>/team` + `/company` via `getPersonExtensions()`, shown when present).
- Three trip-counter tiles: Total / Upcoming / Completed (over the person's full trip set).
- Trips table with a period `DateRangeSelection` + the same quick-preset buttons as Overview
  (`util/datePresets.js`, active preset in `detail>/preset`); a **"Locate on date"** button opens
  `LocationPopover.fragment.xml` (a `DatePicker` → where the person was that day: on a trip / at
  home). (Trip creation lives in **All Trips**, not here.)

**All trips** (`AllTrips.view/controller`) — route `allTrips` (pattern `alltrips`), reached via the
Employees toolbar button (Emphasized); **not** a top-level tab (honors *"No Trips landing tab"*) —
its route maps to the Employees tab. **One row per REAL trip:** copies of the same shared trip are
grouped by `ShareId` via `util/tripGroups.js` `groupTrips(perPerson, extMap)` (one group per
`ShareId || user|tripId`; own trips stay singletons). Columns **Trip | Travellers & approvals |
Total budget**.
- **Per-traveller** budget + approval: the Travellers cell nests a `VBox items="{view>members}"`
  (each member = one employee's copy) showing their own budget, status badge, and (coordinator-only)
  **Submit / Approve / Reject** — the action handlers read the bound **member** and are unchanged.
  Status is **dual-sourced**: own trips carry `approvalStatus`; TripPin trips look up a **live
  (uncached)** `/TripExtensions` map (absent = "not submitted"). Actions branch on `isOwn`: own →
  PATCH `/trips/OwnTrips('uuid')`; TripPin → `TripExtensions.create` (submit) or bound
  `TripsService.approve`/`rejectTrip`. Own-trip writes evict `_mTripsCache[user]` + `_pTripData`.
- **Total budget** column = sum of the members' budgets. Search matches trip name + any traveller;
  the approval `Select` keeps a group when **any** member matches.
- **Create trip** (coordinator): `CreateTripDialog.fragment.xml` (employee `ComboBox`, single
  employee) → POST `/trips/OwnTrips`. Created own-trips have no `ShareId` → not grouped.

**Trip detail** (`TripDetail.view/controller`) — reached via a trip row (incl. All Trips). Content
is **identical from any traveller's copy** (it aggregates by `ShareId`), so no per-copy routing.
- The **flight-route block** and a **"Travellers & budgets"** panel sit side by side (`FlexBox`).
- **Combined budget:** the `ObjectHeader` number is the **sum across travellers** (`trip>/totalBudget`,
  seeded from the entered copy then overwritten by the group sum). The **Travellers & budgets** table
  (`trip>/members`, built by `tripGroups.groupTrips` + a live `/TripExtensions` map) lists each
  employee with **their own budget + status** (Link → their detail). Approval is **read-only** here
  (actions live in All Trips).
- **Shared-trip flights:** if the current copy has **no flights**, they are **borrowed** from a
  co-traveller's copy (same `ShareId`) that has them, so every copy shows the same route.
- Flights table (`PlanItems`): flight no.+airline, From/To (Links → airport focus), departure/
  arrival, seat. Trip details panel (description).

**Airports** (`Airports.view/controller`).
- **Leaflet map** (marker per airport) on the left + an **always-on right `NavContainer`
  sidebar**: a **list page** (search + all airports) and a **detail page** (airport facts, a
  relative *traffic level*, and "trips via this airport" **grouped by trip** with a traveller
  count). Clicking a list item **or a map pin** opens the detail page; the page's back button
  returns to the list. Trips-via rows → trip detail.
- Cross-nav: a flight's From/To Link → `airports/{iata}` focuses the map and opens that detail.

**Global search** (`App.controller` + `SearchResults.fragment.xml`).
- ShellBar `SearchManager` → a grouped results dialog across **employees and airports**
  (client-side over cached data). Click: employee → detail, airport → focus. Airlines are
  **not** searchable — there is no airline detail page to navigate to.

## Data caveats (TripPin reality — worth stating in the demo)

- **TripPin is a public, writable demo service and is polluted** by other people's test accounts
  (`Jdbc*`, sometimes with **duplicate keys**). Duplicate keys make the UI5 OData V4 model reject
  the whole `/People` collection ("data not loading"). The People proxy sanitises this (see
  "What the frontend wants from the backend").
- **Trip dates are mostly historical (~2014)**, so employee Status and the trip counters skew to
  *Available / Completed*, and the Overview period filter needs a **wide** range to show data.
- **Flights (`PlanItems`) exist only on some trip copies.** Shared trips reconcile this via the
  `ShareId` flight-borrow above.
- Aggregates (top airlines/routes, airport stats) reflect the **loaded** set.

## Backend services (CAP)

Owned by the backend side; the frontend consumes these as four named OData V4 models. Four proxy
services (people/airports/airlines/trips) forward to TripPin, plus:
- `srv/user-service.{cds,js}` — `/user/whoami()` returning `{ id, roles[] }`; the frontend reads
  it for role-gating.
- `TripExtension` (CAP DB, key `personUserName + tripId`) — the frontend uses only
  `approvalStatus`; `TripsService.approve` / `rejectTrip` actions update it.
- `srv/trips-service.js` — a `PlanItems` handler returning flattened flight rows
  (`fromIata/Name/City`, `toIata/Name/City`, airline, times, seat).
- `srv/people-service.js` — the `/People` READ dedupes by `UserName` and drops `Jdbc*` junk so
  TripPin's duplicate keys don't crash the UI5 V4 model (see the next section).
- `approuter/xs-app.json` — the BTP entry point that wires the login flow: serves the
  launchpad/static app **publicly** (`/dashboard/webapp/**` + `/`, auth `none`) and an
  xsuaa-protected **`/secure/**` mirror** (rewrites `/secure/X` → `/dashboard/webapp/X`) plus the
  protected data routes (`/user`, `/people`, `/trips`, `/airlines`, `/airports`). Hitting `/secure/`
  with no session makes the approuter force the XSUAA login (a full-page nav, so the redirect
  works); a `logout` endpoint drops the session back to the public launchpad. The UI5 files
  themselves are served by CAP (`server.js`, Express static at `/dashboard/webapp`), so there is a
  single source of truth (`app/dashboard/webapp/`).

## What the frontend wants from the backend

The handoff list — things the UI needs (or would need) from the CAP layer that the frontend
cannot do on its own. The frontend does not edit `srv/`, `db/`, or `xs-security.json` itself;
it raises items here.

- **People de-duplication (live; required).** TripPin is polluted with third-party test accounts
  (`Jdbc*`) and sometimes **duplicate `UserName` keys**, which makes the UI5 OData V4 model reject
  the entire `/People` collection ("data not loading"). The fix lives in `srv/people-service.js`
  (filter `Jdbc*` + dedupe by `UserName`). **Keep it** — without it the dashboard cannot load
  people. This stays an owned backend behaviour.
- **Per-employee Company/Team store (delivered).** Backed by `PersonExtension` (CAP DB, key
  `personUserName`; fields `team`/`company`/`department`/`status`), exposed at
  `/people/PersonExtensions`. The frontend reads it via `Component.getPersonExtensions()` (memoised
  `personUserName → ext` map) and joins client-side on `UserName`: team/company show as columns +
  filters in Employees and on the EmployeeDetail header.
- **Persisting coordinator-created trips ("Add trip") (delivered).** Backed by `OwnTrip` (CAP DB,
  key `tripId` UUID), exposed `/trips/OwnTrips` (Coordinator WRITE). The **All Trips** view (route
  `allTrips`, reached via a button in Employees) hosts the create dialog (employee picker + name,
  destination, dates, budget, description) and POSTs to `/trips/OwnTrips`.
- **Flight (PlanItem) entry on created trips (parked).** Created `OwnTrip`s are trip-level only —
  there is **no backend store for flights** on our own trips, so they show the "No flights recorded"
  state in TripDetail. Capturing origin/destination airports, airline, times and seat would need a
  backend PlanItem store keyed on the trip; not built.

## Out of scope / decisions

- Writing to TripPin; Events / unused TripPin data; real-time updates; a Trips landing tab;
  mobile-first (desktop primary, but stay responsive).
- **Company/Team on trips** — removed. Approval is the only trip metadata. Company/team were
  considered as *per-employee* fields but that needs a backend store that is **not built** (see
  "What the frontend wants from the backend").
- **"Add trip"** (a coordinator creating a trip in our own DB) — not built; needs a backend store
  (same section).
- BTP UI serving / login flow — **now wired**: CAP serves the UI5 app (`server.js` Express static)
  fronted by the approuter (public launchpad → `/secure/` XSUAA login → app). See
  `approuter/xs-app.json` + "Launchpad / role login". (Originally a deferred html5/static-module
  idea — not used.)

## Working style

- One feature at a time; verify in the browser; pause for a manual commit between features.
- Prefer standard SAPUI5/Fiori patterns (sap.m/sap.f, OData V4 model, manifest routing) over
  hacks — grading tests SAP-stack understanding.
- The frontend team is new to SAPUI5 — when introducing a concept (bindings, routing, fragments),
  add a 2–3 line explanation, not an essay.
- When unsure about a TripPin field/relation, inspect the live service at port 4004 (or
  `srv/external/TripPin.cds` for reference).
