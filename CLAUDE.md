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

- **Arda (this machine): frontend only.** SAPUI5 app under `app/`, plus frontend-related
  config. By default, do **not** modify files under `srv/`, `db/`, or `xs-security.json`.
- **Simon: backend.** CAP services, data model, XSUAA, deployment to BTP.
- Exception: if a frontend feature is blocked by a backend issue, explain the problem and
  the suggested backend fix in chat (so Arda can pass it to Simon), but do not silently
  change backend code. If explicitly asked to prepare a backend fix, put it in a separate
  branch or clearly isolated commit so Simon can review it.

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
- `srv/` — CAP services + handlers (Simon's area).
  - `srv/external/TripPin.{cds,xml}` — imported TripPin EDMX metadata.
  - Currently four separate services: people, trips, airlines, airports.
- `app/dashboard/webapp/` — the freestyle SAPUI5 app (Arda's area). See "Frontend status".
- `xs-security.json` — XSUAA scopes/role templates (TravelCoordinator, TeamLead, HR).
- No `mta.yaml` yet.

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
  `App.controller.js`). Overview & Airports are still `IllustratedMessage` placeholders
  (use a fixed `illustrationSize` — `Auto` flickers in auto-height containers).
- **Models**: four named OData V4 models in manifest — `people`, `trips`, `airlines`,
  `airports` (autoExpandSelect, operationMode Server, earlyRequests). Bind with prefix:
  `{people>/People}`. No anonymous default model.
- **Feature 1 done — Employees**: searchable table (`Employees.view.xml`) with
  click-through to `EmployeeDetail.view.xml` (element binding on `/People('user')` via
  route parameter). Search sends correct `$filter` but the backend ignores it (see
  backend issues). `Emails` is a collection — bind with `targetType: 'any'` + formatter.
- **Feature 2 done — Employee detail**: profile header (name, emails, home city from
  `AddressInfo`), trips table, period filter (`DateRangeSelection`) and a "location on
  date" lookup (`DatePicker` → on a trip / at home). Trips load via the v4 `trips` model
  (`bindList` + `requestContexts`) with a single eq-filter carrying the username — the
  current backend reads the person from the first filter value (issue 4). Sorting,
  period filtering and the location lookup are **client-side** over the loaded set,
  because the backend ignores `$filter`/`$orderby`; swap to server-side binding filters
  once the backend forwards queries. NB: the profile header shows the wrong person until
  backend issue 2 is fixed (keyed reads ignore the key).
- **Local auth**: mocked users in `package.json` — `coordinator`/`teamlead`/`hr`,
  password `test`. Browsers cache basic auth per session; use an incognito window or
  `http://user@localhost:4004/...` to switch users.
- **Verification tooling**: `playwright-core` scripts (headless Chrome with
  `httpCredentials`) were used to verify features end-to-end; ask Claude to re-run or
  extend them when adding features.

## In scope (frontend feature list, build one at a time)

1. ~~Employees tab: searchable list, click-through to employee detail page.~~ ✅ done
2. ~~Employee detail: profile + chronological trips with time filtering; show the person's
   location on a chosen date.~~ ✅ done (header shows wrong person until backend issue 2 is fixed)
3. Trip detail page (reached from an employee): flights, airports, involved people,
   plus the extension fields (approval status, company, team, notes).
4. Cross-navigation: employee → trip → airport/airline → back to people.
5. Overview tab: KPI cards (totals, top airlines, top routes).
6. Airports tab: list + map visualization.
7. Global search across employees, airports, airlines.
8. Coordinator-only: add trip, approve/reject (UI side of the actions).

## Out of scope

- Writing to TripPin; Events and other unused TripPin domain data.
- Real-time updates, notifications, live feeds.
- A Trips tab as landing page.
- Mobile-first design (desktop primary; stay responsive).

## Known backend issues (context only — do NOT fix unprompted; flag to Simon)

Verified on 12 June against the running service (all four `srv/*.js` impls share the same
raw-`fetch()` pattern):

1. **All four services use raw `fetch()`** to the TripPin URL instead of
   `cds.connect.to('TripPin')` + `srv.run(req.query)`. This bypasses the Destination
   Service and **will break on BTP**.
2. **All OData query options are ignored** (`$filter`, `$top`, `$skip`, `$select`,
   `$orderby`, `$count`) **and keyed reads ignore the key**: the on-READ handlers always
   return the full first page from TripPin. Verified: `People?$filter=FirstName eq
   'Russell'` and `?$top=3` both return all 8 records, and `People('scottketchum')`
   returns **Russell** (CAP picks the first row of the returned array). Concrete impact:
   the Employees search never shrinks, and the employee detail header shows Russell for
   every person. Forwarding `req.query` (fix 1) solves this.
3. **Server-driven paging is not followed**: TripPin pages People at 8 per page
   (`@odata.nextLink`); the raw fetch returns only page 1, so the app shows 8 of ±20
   employees.
4. `trips-service.js` parses the person filter via `req.query.SELECT?.where?.[2]?.val`
   — brittle (breaks when the UI sends different/extra filters) and silently falls back
   to `'russellwhyte'`. Relevant for the employee detail page (feature 2).
5. **`approve()` / `reject()` are declared in `trips-service.cds` but have no handler**
   in `trips-service.js` — calling them fails. Needed for frontend feature 8.
6. `cds watch` warns that the custom action **`reject()`** shadows the equally named
   method of the `ApplicationService` base class — CAP cannot generate the typed
   convenience method. Suggest renaming the action (e.g. `rejectTrip`).
7. The **projection/mashup pattern** from the analysis (TripPin `Trip` joined with
   `TripExtension` so the UI sees one entity) is not implemented yet — extension fields
   are a separate entity for now.
8. **Recommendation to discuss:** consolidate the four services into one
   `DashboardService` with associations between entities. Four services mean four OData
   models in the UI5 app and no `$expand` across entities, which complicates
   cross-navigation — the core of this app.
9. Raw passthrough of TripPin JSON leaks foreign metadata into our responses:
   absolute `@odata.id`/`@odata.editLink` pointing at services.odata.org, `Concurrency`
   (Int64) serialized as a JSON number even when the client requests
   `IEEE754Compatible=true`, and `Gender` returned as a string while the CDS model
   declares an Integer enum. Works today, but fragile with strict OData V4 clients —
   `srv.run(req.query)` (fix 1) makes CAP do the serialization properly.

## Working style

- Work **one feature at a time**; run it, verify in the browser, then move on.
- Prefer standard SAPUI5/Fiori patterns (sap.m, sap.f, OData V4 model, routing via
  manifest.json) over custom hacks — grading partly tests understanding of the SAP stack.
- Keep explanations short; Arda is new to SAPUI5, so when introducing a new concept
  (e.g. bindings, manifest routing), add a 2–3 line explanation, not an essay.
- When unsure about a TripPin field or relation, inspect `srv/external/TripPin.cds` or the
  live service at port 4004.
