# CLAUDE.md — PrimePath Travel: Exploratory Travel Dashboard

Project context for Claude Code. Read this before making changes.

## What this project is

A **full-stack SAP CAP application** for the (fictional) customer *PrimePath Travel*,
deployed on **SAP BTP (Cloud Foundry)**. School assignment (Erasmushogeschool Brussel +
Flexso), built by a two-person team. Final demo: **19 June**.

The app is an **exploratory dashboard**: users browse, filter and click through to find
answers — it is NOT an operational booking tool. Core objects: **Employees (People),
Trips, Airlines, Airports**, sourced from the public **TripPin OData V4** service.
TripPin is read-only; our own persistable fields live in a CAP-managed database
(`TripExtension`).

Three user roles enforced via XSUAA: **TravelCoordinator** (read/write, approve/reject),
**TeamLead** (read, own team), **HR** (read, reporting).

## Team split — IMPORTANT for scope

- **Frontend team (this machine): frontend only.** SAPUI5 app under `app/`, plus
  frontend-related config. By default, do **not** modify files under `srv/`, `db/`, or
  `xs-security.json`.
- **Backend team:** CAP services, data model, XSUAA, deployment to BTP.
- Exception: if a frontend feature is blocked by a backend issue, explain the problem and
  the suggested backend fix in chat (so the frontend team can pass it to the backend team), but do not silently
  change backend code. If explicitly asked to prepare a backend fix, put it in a separate
  branch or clearly isolated commit so the backend team can review it.

## Tech stack

- **Backend:** SAP CAP, Node.js (`@sap/cds` v9), CDS models
- **Frontend:** **Freestyle SAPUI5** (XML views + JS controllers). NOT Fiori Elements,
  NOT React. The UI is a tab-based dashboard (Overview · Employees · Airports) with
  cross-navigation, which needs freestyle control. Follow Fiori design guidelines
  (sap.m, sap.f controls, Fiori 3 theme) so it still looks like an SAP app.
- **Local DB:** SQLite (`@cap-js/sqlite`) · **Prod DB:** SAP HANA Cloud
- **External data:** TripPin OData V4 — `https://services.odata.org/V4/TripPinService`
- **Deploy target:** BTP Cloud Foundry (approuter + XSUAA + Destination Service)

> A visual mockup exists in Figma Make (React/Tailwind code). That code is **reference
> only** — never reuse or port it. Screenshots will be shared in chat per feature; match
> the layout and intent using SAPUI5 controls, not the exact pixels.

## Repo layout

- `db/schema.cds` — own `TripExtension` entity (namespace `primepath`),
  keyed on `personUserName + tripId`.
- `srv/` — CAP services + handlers (the backend team's area).
  - `srv/external/TripPin.{cds,xml}` — imported TripPin EDMX metadata.
  - Currently four separate services: people, trips, airlines, airports.
  - `srv/user-service.{cds,js}` — `/user/whoami()` role endpoint, added by the frontend team
    for feature 8 gating (see "Frontend-team backend additions").
- `app/dashboard/webapp/` — the freestyle SAPUI5 app (the frontend team's area). See "Frontend status".
- `xs-security.json` — XSUAA scopes/role templates (TravelCoordinator, TeamLead, HR).
- `mta.yaml` + `approuter/` — BTP deployment descriptor and approuter (added in `efbb74a`).
  Topology: CAP `srv` (Node.js) + approuter + XSUAA + Destination Service for TripPin.
  ⚠️ **Gap:** the approuter has **no html5/static module** for the UI5 app — `xs-app.json`
  routes everything (incl. the catch-all `^(.*)$`) to `srv-api`, so the frontend is not
  served on BTP yet. Flagged to the backend team (see "Post-merge audit (13 June 2026)").

## Commands

- `npm install` — install dependencies
- `cds watch` — run locally with live reload (port 4004)
- Local login uses **mocked auth**. Test users with roles should be defined under
  `cds.requires.auth.users` in `package.json` (e.g. `coordinator`/`teamlead`/`hr`,
  password `test`). Without that config, default users like `alice` (empty password)
  work but have no app roles.

## Hard rules / domain constraints

- **Never write to TripPin.** All mutations (approval status, company, team, notes) go to
  `TripExtension` in the CAP layer.
- **TripId is only unique within a person**, not globally. Any join or navigation involving
  trips must carry `personUserName + tripId` together. This is also why the app is
  **employee-centric**: TripPin has no flat top-level Trips collection — trips exist only
  as containment under `People('user')/Trips`.
- There is intentionally **no Trips landing tab**; trips are reached via Employees (and
  Airports). Do not add one.
- The approval flow is **internal metadata** on top of booking facts — it never changes
  TripPin data.

## Frontend status (implemented so far)

- **Scaffold**: freestyle UI5 app under `app/dashboard/webapp/`, UI5 1.136 from CDN,
  theme `sap_fiori_3`. Shell = `App.view.xml` (ShellBar + IconTabHeader + NavContainer,
  `height="100vh"` — percentage heights break because UI5 renders unstyled wrapper divs).
  Manifest routing: `""`→Overview, `employees`, `employees/{userName}`→EmployeeDetail,
  `airports`; route names double as tab keys (detail routes map to their list tab in
  `App.controller.js`). NB: `IllustratedMessage` needs a fixed `illustrationSize` —
  `Auto` flickers in auto-height containers.
- **Models**: four named OData V4 models in manifest — `people`, `trips`, `airlines`,
  `airports` (autoExpandSelect, operationMode Server, earlyRequests). Bind with prefix:
  `{people>/People}`. No anonymous default model.
- **Feature 1 done — Employees**: searchable table (`Employees.view.xml`) with
  click-through to `EmployeeDetail.view.xml` (element binding on `/People('user')` via
  route parameter). The list loads once into a JSON `view` model (`bindList` +
  `requestContexts`) and **search filters client-side** (contains on
  FirstName/LastName/UserName) with a live count in the title — same pattern as Airports.
  This dates from when the backend ignored `$filter` (issue 2); **as of the 13 June
  re-check the people/airports proxy now forwards `$filter`**, so the client-side filter is
  **redundant but still works** — it can move to a server-side `binding.filter()` on
  `{people>/People}` (paging issue 3 still caps results at one page either way). `Emails` is
  a collection — bind with `targetType: 'any'` + formatter.
- **Feature 2 done — Employee detail**: profile header (name, emails, home city from
  `AddressInfo`), trips table, period filter (`DateRangeSelection`) and a "location on
  date" lookup (`DatePicker` → on a trip / at home). Trips load via the v4 `trips` model
  (`bindList` + `requestContexts`) with a single eq-filter on **`personUserName`** carrying
  the username — `trips-service.js` extracts it with a regex on `personUserName eq '…'`
  (issue 4), so the filter field name must be exactly that. Sorting, period filtering and
  the location lookup are **client-side** over the loaded set. The profile header now shows
  the **correct** person: the people proxy forwards keyed reads (`People('user')`) since the
  13 June backend re-check, so the old "shows Russell for everyone" bug is gone.
  ⚠️ **Post-merge repair (13 June):** the PR #4 merge had left this page broken — the
  controller had a duplicate `_loadTrips`, a leftover `formatDate`, and a missing comma
  (JS syntax error → the whole module failed to parse), and the view had an orphaned
  `<List>` with a duplicate `</content>`. Both were cleaned up; the trips filter was
  changed from the dummy field `Name` to `personUserName` so the backend regex matches.
- **Feature 3 done (partially) — Trip detail**: reached by clicking a trip row on the
  employee detail (route `employees/{userName}/trips/{tripId}` — tripId is only unique
  within a person, so both live in the path; `TripDetail.view.xml`). Shows trip facts
  (name, period, budget, description, tags) from `PersonTrips` — the trip is matched
  **client-side by `TripId`** because keyed trip-reads return the wrong row (issue 2) —
  plus the **extension fields** (approval status as a coloured `ObjectStatus`, company,
  team, notes) read from `/trips/TripExtensions` via a composite-key filter
  (`personUserName`+`tripId`) with an explicit `$select` (the table is empty today, so it
  shows "Not submitted" / —). **Flights table done (14 June)** — loads `/trips/PlanItems`
  (flight no. + airline, from/to airports, departure/arrival, seat) via a two-part
  `personUserName`+`tripId` filter; `PlanItems` is now reachable (issue 9 resolved for
  flights). The From/To cells are `Link`s that cross-navigate to the Airports map
  (feature 4). A coordinator-only approve/reject/submit footer was added — see feature 8.
- **Feature 5 done (partially) — Overview**: KPI tiles (`GenericTile`/`NumericContent`:
  employees, trips, total budget, airports, airlines) + "Top travellers" `sap.f.Card`.
  Counts are computed client-side over the loaded sets (so they reflect TripPin's first
  page until backend issue 3 is fixed); trips are aggregated with one `PersonTrips`
  request per person. **Top airlines / top routes done (14 June)** — a second progressive
  phase aggregates `/trips/PlanItems` across every (person, trip) pair into two `sap.f.Card`
  lists, each with its own busy indicator so the KPI tiles render first.
- **Feature 6 done — Airports**: table (name, IATA, ICAO, city, country) with
  client-side search + **Leaflet/OpenStreetMap map** with a marker per airport
  (coordinates from `Location.Loc`, GeoJSON `[lon, lat]` — flip to `[lat, lon]` for
  Leaflet). Leaflet is loaded from CDN in `index.html` because `sap.ui.vbm`/GeoMap is
  not in the SAPUI5 CDN distribution (404 on 1.136). The map div lives in a
  `sap.ui.core.HTML` control; the controller guards double-init and calls
  `invalidateSize()` on re-entry of the tab. Table rows are clickable
  (`onAirportPress` → `_focusAirport` pans/zooms the map to that marker and opens its
  popup; markers are kept in `_mMarkers` keyed by ICAO).
- **Feature 4 done (14 June) — Cross-navigation**: employee → trip → airport. Flight From/To
  `Link`s navigate to a new `airports/{iata}` route (`airportFocus`) that focuses the Leaflet
  map on that airport (IATA→ICAO resolved from the loaded set; `_sPendingIata` deferred-focus
  guard for cold deep-links). Airlines are surfaced inline (flight rows, Overview cards,
  global search) — no Airlines tab (kept the 3-tab structure). "Back to people" is via the
  nav buttons / tabs / global search.
- **Feature 7 done (14 June) — Global search**: `sap.f.SearchManager` in the ShellBar searches
  across employees/airports/airlines (client-side over a cached set) and shows grouped results
  in a `Dialog` (`SearchResults.fragment.xml` — the app's **first fragment**, cached +
  `addDependent`). Click-through: employee → detail, airport → `airportFocus`, airline →
  informational toast. Zero matches → toast instead of an empty dialog.
- **Feature 8 done (14 June) — Coordinator actions**: a footer on `TripDetail` (visible only to
  `TravelCoordinator`) with **Submit / Approve / Reject**. Submit creates a `TripExtension`
  (pending) via `ApprovalForm.fragment.xml` (`bindList("/TripExtensions").create(...)`);
  Approve/Reject invoke the bound `TripsService.approve` / `TripsService.rejectTrip` actions
  (`bindContext("TripsService.approve(...)", ctx).execute()`), then reload the snapshot. Role
  gating uses a Component-level `app` JSON model populated from **`GET /user/whoami()`** (see
  "Frontend-team backend additions"). Approve/Reject are disabled until a record exists
  (Submit first); the whole footer is hidden for TeamLead/HR.
- **Bug fix (14 June)**: `TripDetail` and `Overview` filtered `PersonTrips` on the trip-title
  field `Name` instead of `personUserName`; the backend regex no longer matched (no fallback),
  so Trip Detail failed to load and Overview trip-counts/budget were silently zero. Both now
  use `personUserName` (same as `EmployeeDetail`).
- **Polish**: `EmployeeDetail` trips table and `Overview` show a busy indicator while
  loading and a `MessageToast` on load failure; `Employees`/`Airports` have empty-state
  `noDataText`.
- **Local auth**: mocked users in `package.json` — `coordinator`/`teamlead`/`hr`,
  password `test`. Browsers cache basic auth per session; use an incognito window or
  `http://user@localhost:4004/...` to switch users.
- **Verification tooling**: `playwright-core` scripts (headless Chrome with
  `httpCredentials`) were used to verify features end-to-end; ask Claude to re-run or
  extend them when adding features.

## In scope (frontend feature list, build one at a time)

1. ~~Employees tab: searchable list, click-through to employee detail page.~~ ✅ done
2. ~~Employee detail: profile + chronological trips with time filtering; show the person's
   location on a chosen date.~~ ✅ done (header now correct; merge damage repaired 13 June)
3. ~~Trip detail page (reached from an employee): plus the extension fields (approval
   status, company, team, notes).~~ ✅ done — facts + extension fields + **flights table**
   (`PlanItems`).
4. ~~Cross-navigation: employee → trip → airport/airline → back to people.~~ ✅ done —
   employee → trip → airport (map focus). Airlines surfaced inline (no Airlines tab);
   "back to people" via nav buttons / tabs / global search.
5. ~~Overview tab: KPI cards (totals).~~ ✅ done — incl. **top airlines / top routes**.
6. ~~Airports tab: list + map visualization.~~ ✅ done (Leaflet/OSM)
7. ~~Global search across employees, airports, airlines.~~ ✅ done
8. Coordinator-only: **approve/reject + submit approval record** ✅ done; **add trip (to our
   own DB)** ⏳ deferred — needs backend (see "Backend needed: Add Trip (DB)").

## Out of scope

- Writing to TripPin; Events and other unused TripPin domain data.
- Real-time updates, notifications, live feeds.
- A Trips tab as landing page.
- Mobile-first design (desktop primary; stay responsive).

## Known backend issues (context only — do NOT fix unprompted)

First verified 12 June; re-checked 13 June; **re-checked 14 June 2026** — the backend's
`83289f3`/`5adfa93`/`3d38f5a` commits changed several statuses. Current verdict per issue:

- #1 **still broken** · #2 **partially fixed** (people/airports/airlines forward query
  options + keyed reads; `trips-service.js` uses a regex, not the proxy) · #3 **still
  broken** · #4 **degraded** (brittle regex) · #5 **FIXED [14 June]** — `approve` /
  `rejectTrip` handlers are now present in `trips-service.js` · #6 **fixed** (`rejectTrip`
  rename) · #7 still open · #8 still a recommendation · #9 **FIXED for flights [14 June]** —
  `/trips/PlanItems` returns flattened flight rows (`$expand=From,To,Airline`); composition
  navigation paths may still 501 · #10 **still applies**.

Original descriptions below (changed ones carry a **[13 June: …]** status tag):

1. **All four services use raw `fetch()`** to the TripPin URL instead of
   `cds.connect.to('TripPin')` + `srv.run(req.query)`. This bypasses the Destination
   Service and **will break on BTP**.
2. **All OData query options are ignored** (`$filter`, `$top`, `$skip`, `$select`,
   `$orderby`, `$count`) **and keyed reads ignore the key**: the on-READ handlers always
   return the full first page from TripPin. Verified: `People?$filter=FirstName eq
   'Russell'` and `?$top=3` both return all 8 records, and `People('scottketchum')`
   returns **Russell** (CAP picks the first row of the returned array). Concrete impact:
   the Employees search never shrinks, and the employee detail header shows Russell for
   every person. Forwarding `req.query` (fix 1) solves this. **[13 June: PARTIALLY FIXED —
   `people/airports/airlines-service.js` now forward the raw request path+querystring to
   TripPin via a `proxy()`, so `$filter`/`$select`/`$orderby` and keyed reads work for
   those three. `trips-service.js` was NOT given the proxy (regex-based, see #4). Paging
   (#3) is still unfixed, so result sets are still capped at one page.]**
3. **Server-driven paging is not followed**: TripPin pages People at 8 per page
   (`@odata.nextLink`); the raw fetch returns only page 1, so the app shows 8 of ±20
   employees.
4. `trips-service.js` parses the person filter via `req.query.SELECT?.where?.[2]?.val`
   — brittle (breaks when the UI sends different/extra filters) and silently falls back
   to `'russellwhyte'`. Relevant for the employee detail page (feature 2). **[13 June:
   DEGRADED — `a7e5f5b` replaced this with a regex `/personUserName eq '([^']+)'/` and
   now returns `[]` (no russellwhyte fallback) when it doesn't match. The frontend was
   updated to filter on the `personUserName` field so the regex matches. Still brittle,
   and no `encodeURIComponent` on the value before interpolating it into the fetch URL.]**
5. **`approve()` / `reject()` are declared in `trips-service.cds` but have no handler**
   in `trips-service.js` — calling them fails. Needed for frontend feature 8. **[13 June:
   REGRESSED and still broken — the actions are now named `approve()`/`rejectTrip()` in
   the CDS but still have **zero handlers** in `trips-service.js`. Handlers existed at
   `fb1a563`/`efbb74a` but were dropped when `a7e5f5b` rewrote the file. Calling → 501.]**
   **[14 June: FIXED — `trips-service.js` now has `on('approve','TripExtensions')` and
   `on('rejectTrip','TripExtensions')` handlers doing `UPDATE(req.subject).set({approvalStatus})`.
   Frontend feature 8 calls them as bound actions `TripsService.approve`/`rejectTrip`.]**
6. `cds watch` warns that the custom action **`reject()`** shadows the equally named
   method of the `ApplicationService` base class — CAP cannot generate the typed
   convenience method. Suggest renaming the action (e.g. `rejectTrip`). **[13 June: FIXED
   — the action is renamed `rejectTrip` in `trips-service.cds`.]**
7. The **projection/mashup pattern** from the analysis (TripPin `Trip` joined with
   `TripExtension` so the UI sees one entity) is not implemented yet — extension fields
   are a separate entity for now.
8. **Recommendation to discuss:** consolidate the four services into one
   `DashboardService` with associations between entities. Four services mean four OData
   models in the UI5 app and no `$expand` across entities, which complicates
   cross-navigation — the core of this app.
9. **Navigation paths return 501**: `People('x')/Trips` and `PersonTrips(...)/PlanItems`
   fail with "cannot be served generically" — the on-READ handlers only cover the entity
   sets themselves, and the auto-exposed composition targets have `@cds.persistence.skip`.
   This blocks flight data (`PlanItems` → `Flight` → airline/from/to), which the frontend
   needs for the trip detail page (feature 3) and the top-airlines/top-routes KPIs
   (feature 5). Query forwarding (fix 1) plus exposing `PlanItems` solves this. **[14 June:
   FIXED for flights — a dedicated `PlanItems` entity + on-READ handler (`83289f3`) fetches
   `People('x')/Trips(n)/PlanItems/…Flight?$expand=From,To,Airline` and returns flattened
   rows (airline, from/to IATA+name+city, times, seat); filter on `personUserName`+`tripId`,
   both required. Features 3/4/5 consume it. Other composition paths may still 501.]**
10. Raw passthrough of TripPin JSON leaks foreign metadata into our responses:
   absolute `@odata.id`/`@odata.editLink` pointing at services.odata.org, `Concurrency`
   (Int64) serialized as a JSON number even when the client requests
   `IEEE754Compatible=true`, and `Gender` returned as a string while the CDS model
   declares an Integer enum. Works today, but fragile with strict OData V4 clients —
   `srv.run(req.query)` (fix 1) makes CAP do the serialization properly.

## Post-merge audit (13 June 2026)

Triggered by the PR #4 merge (`063143e`) and the "Merge main into frontend" (`45eaf4e`),
which naively kept **both** the frontend team's and the backend team's versions of the Employee Detail page side by
side instead of resolving them. Full front+back audit; verified with `node --check` and git
forensics. (No leftover `<<<<<<<` conflict markers; `main..frontend` is empty, so nothing
important is stranded on the dangling `frontend` branch.)

**Frontend repairs — DONE (the frontend team's area):**
- `EmployeeDetail.controller.js`: removed the duplicate raw-`fetch` `_loadTrips`, the unused
  `formatDate`, and the stray `this._loadTrips(sUserName)` call in `onTripPress` — this also
  fixed the missing-comma JS **syntax error** that made the whole module fail to parse (so
  the page, plus the trip click-through, was fully dead). Changed the trips filter field
  `Name` → `personUserName` so the backend regex matches. `node --check` passes.
- `EmployeeDetail.view.xml`: removed the orphaned `<List>` (bound to a dead `tripData`
  model) and the duplicate `</content>` tag that made the XML invalid.

**Flag to the backend team — backend/deploy regressions (NOT edited, per the team split):**
- **approve/rejectTrip handlers dropped** (issue 5) — restore from `fb1a563`/`efbb74a`;
  lost when frontend commit `a7e5f5b` rewrote `trips-service.js` from scratch.
- **trips filter parser is a brittle regex** (issue 4) — prefer the structured
  `req.query.SELECT.where` parse; accept the value regardless of field; `encodeURIComponent`
  it. The FE now sends `personUserName eq '…'`, so the current regex *does* match today.
- **`PersonTrips.personUserName` is projected as `''`** (always empty) — populate it from
  the requested user so a real server-side filter / column display works.
- **raw `fetch()` instead of `cds.connect.to('TripPin')`** (issue 1) — bypasses the
  Destination Service; BTP risk; also keeps the metadata leak (issue 10).
- **paging not followed** (issue 3) — `proxy()` returns page 1 only (~8 of ~20 employees).
- **`PlanItems` unreachable** (issue 9) — still blocks flights / top-airlines / top-routes.
- **BTP deploy gap (HIGH):** the approuter has no html5/static module for the UI5 app, so
  the frontend is not served on BTP. The backend team is reportedly already working on it.
- Cleanup: `trips-service.js` has leftover `console.log` debug lines.

**Merge hygiene:** backend files under `srv/` were rewritten on the *frontend* branch
(`a7e5f5b`), which is how the backend team's fixes got lost. Keep backend work on backend branches and
the frontend out of `srv/` per the team split.

## Frontend-team backend additions (for backend review)

- **`/user/whoami()`** (`srv/user-service.cds` + `.js`, added 14 June): a small isolated
  `UserService @(path:'/user')` exposing `function whoami() returns { id; roles[] }`, where
  `roles = ['TravelCoordinator','TeamLead','HR'].filter(r => req.user.is(r))`. The frontend
  reads it once (Component → `app` JSON model) to show/hide coordinator-only UI (feature 8).
  Works under mocked auth and XSUAA. Kept in its **own files + own commit** so the backend
  team can review or relocate it. (The frontend team explicitly approved this cross-team
  addition — it's the only way the client can learn the user's role for gating.)

## Backend needed: Add Trip (DB) — feature 8 "add trip" (NOT yet implemented)

"Add trip" means a coordinator creating a **new trip in our own CAP database** (NOT TripPin —
TripPin stays read-only). The backend for this **does not exist yet**, so the **frontend is
deferred** until it does. Suggested shape for the backend team:

- A persistable entity, e.g. `primepath.LocalTrip` (in `db/schema.cds`): `key ID : UUID`,
  `personUserName : String`, `name`, `description`, `startsAt`/`endsAt : DateTime`,
  `budget : Decimal`, plus audit fields. Keep it **separate** from `TripExtension` (which is
  approval metadata on *TripPin* trips, not a trip itself).
- Expose it in a service with **CREATE restricted to `TravelCoordinator`** and READ for the
  other roles (mirror the `TripExtensions` `@restrict`).
- **Decision needed:** how local DB trips surface on the Employee detail alongside TripPin
  trips — a separate "Company trips" table, or merged into the existing trips list (a union;
  mind the key story: TripPin TripIds are per-person ints, `LocalTrip` uses a UUID).

Once this exists, the frontend adds a coordinator-only "Add trip" dialog and shows the local
trips on the employee detail. **Do not build the frontend part until the entity/service is live.**

## Working style

- Work **one feature at a time**; run it, verify in the browser, then move on.
- Prefer standard SAPUI5/Fiori patterns (sap.m, sap.f, OData V4 model, routing via
  manifest.json) over custom hacks — grading partly tests understanding of the SAP stack.
- Keep explanations short; the frontend team is new to SAPUI5, so when introducing a new concept
  (e.g. bindings, manifest routing), add a 2–3 line explanation, not an essay.
- When unsure about a TripPin field or relation, inspect `srv/external/TripPin.cds` or the
  live service at port 4004.
