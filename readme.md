# PrimePath Travel — Exploratory Travel Dashboard

A full-stack **SAP CAP** application with a **freestyle SAPUI5** frontend for the
(fictional) customer *PrimePath Travel*. The dashboard lets travel coordinators, team
leads and HR explore employees, their trips, airlines and airports — browse, filter and
click through to find answers.

Built as a school assignment (Erasmushogeschool Brussel, in collaboration with Flexso)
by a two-person team: **Arda** (frontend) and **Simon** (backend). Deployment target is
**SAP BTP (Cloud Foundry)**.

## Architecture

| Layer | Technology |
|---|---|
| Backend | SAP CAP (Node.js, `@sap/cds` v9) with five OData V4 services: people, trips, airlines, airports, and user (whoami / role-gating) |
| External data | Public [TripPin OData V4 service](https://services.odata.org/V4/TripPinService), consumed read-only via a CAP remote service binding (resolved through a BTP Destination in production) |
| Own data | CAP-managed tables: `TripExtension` (approval status for TripPin trips), `OwnTrip` / `OwnFlight` (coordinator-created trips and their flights), `PersonExtension` (team / company) — SQLite locally, SAP HANA Cloud in production |
| Frontend | Freestyle SAPUI5 1.136 (XML views + JS controllers), theme `sap_fiori_3`, OData V4 models |
| Map | Leaflet + OpenStreetMap |
| Security | XSUAA with three roles: TravelCoordinator (read/write, approve/reject), TeamLead (read, own team), HR (read, reporting) |

The app is **employee-centric**: trips exist in TripPin only as containment under a
person (`People('user')/Trips`), and a trip id is only unique within that person. Trips
are therefore reached via Employees, not via a separate landing tab. All writes go to
CAP-managed tables — approvals to `TripExtension`, coordinator-created trips to
`OwnTrip` / `OwnFlight` — so TripPin itself is never modified.

## Getting started

```bash
npm install
cds watch
```

Then open **http://localhost:4004/dashboard/webapp/index.html**.

Local login uses mocked basic auth. Test users (password `test` for all):

| User | Role |
|---|---|
| `coordinator` | TravelCoordinator |
| `teamlead` | TeamLead |
| `hr` | HR |
| `super` | TravelCoordinator + TeamLead + HR (to test active-role scoping) |

> Tip: browsers cache basic-auth credentials for the whole session — use an incognito
> window (or `http://coordinator@localhost:4004/...`) to switch users.

## Features

- **Launchpad / role login** — pick a role (TravelCoordinator · TeamLead · HR) to enter
  the dashboard. Locally each tile logs in as the matching mock user; on BTP the active
  role is enforced end-to-end (XSUAA + an `X-Active-Role` header), so a user who holds
  several role collections is scoped to the single role they are currently playing.
- **Overview tab** — a period filter with quick presets, KPI tiles (employees, trips,
  total trip budget, airports, airlines), a "Top travellers" card and Top airlines /
  Top routes bar charts.
- **Employees tab** — searchable employee list with status / team / company filters and
  click-through to a detail page: profile (name, emails, home city), trip counters,
  chronological trips with a period filter, and a "location lookup" that shows where the
  employee was on a chosen date (on a trip, or at home).
- **All trips** — one row per real trip, with copies of a shared trip grouped together;
  per-traveller budget and approval status. Coordinators can **create a trip for one or
  several employees at once** (a shared budget or one per traveller, with optional
  flights) and submit / approve / reject each traveller's copy.
- **Trip detail** — flight-level route (legs, airlines, connecting airports with
  cross-navigation to the airport map), each traveller's own budget and approval status,
  and a combined budget. A shared trip shows the same flights on every traveller's copy.
- **Airports tab** — world map with a marker per airport plus a searchable list
  (name, IATA/ICAO codes, city, country) and a detail panel listing the trips routed via
  that airport.
- **Global search** — ShellBar search across employees and airports.
- **BTP deployment** — `mta.yaml` + approuter descriptors wire the public launchpad and
  the XSUAA-protected app (CAP serves the UI; the approuter fronts the XSUAA login).

## Repository layout

```
app/dashboard/webapp/   SAPUI5 frontend (Component, manifest, views, controllers, i18n)
db/schema.cds           CAP data model: TripExtension, OwnTrip, OwnFlight, PersonExtension (namespace primepath)
srv/                    CAP services + handlers (people, trips, airlines, airports, user)
srv/external/           Imported TripPin EDMX metadata
server.js               Express static serving of the UI under /dashboard/webapp
approuter/              BTP approuter (xs-app.json: public launchpad + XSUAA-protected app)
mta.yaml                BTP Cloud Foundry deployment descriptor
xs-security.json        XSUAA scopes & role templates
```
