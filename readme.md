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
| Backend | SAP CAP (Node.js, `@sap/cds` v9) with four OData V4 services: people, trips, airlines, airports |
| External data | Public [TripPin OData V4 service](https://services.odata.org/V4/TripPinService) (read-only) |
| Own data | `TripExtension` entity (approval status, company, team, notes), keyed on `personUserName + tripId` — SQLite locally, SAP HANA Cloud in production |
| Frontend | Freestyle SAPUI5 1.136 (XML views + JS controllers), theme `sap_fiori_3`, OData V4 models |
| Map | Leaflet + OpenStreetMap |
| Security | XSUAA with three roles: TravelCoordinator (read/write, approve/reject), TeamLead (read, own team), HR (read, reporting) |

The app is **employee-centric**: trips exist in TripPin only as containment under a
person (`People('user')/Trips`), and a trip id is only unique within that person. Trips
are therefore reached via Employees, not via a separate landing tab. All write
operations (approvals, notes, …) go to the CAP-managed `TripExtension` entity — TripPin
itself is never modified.

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

> Tip: browsers cache basic-auth credentials for the whole session — use an incognito
> window (or `http://coordinator@localhost:4004/...`) to switch users.

## Features

- **Overview tab** — KPI tiles (employees, trips, total trip budget, airports,
  airlines) and a "Top travellers" card.
- **Employees tab** — searchable employee list with click-through to a detail page:
  profile (name, emails, home city), chronological trips with a period filter, and a
  "location lookup" that shows where the employee was on a chosen date (on a trip, or
  at home).
- **Trip detail** — click any trip to open a detail page showing the trip facts
  (period, budget, description, tags) and its approval metadata (status, company, team,
  notes).
- **Airports tab** — world map with a marker per airport plus a searchable list
  (name, IATA/ICAO codes, city, country).

### Planned

- Flight-level trip details (legs, airlines, connecting airports) and cross-navigation
  from a trip to its airports and airlines
- Top airlines & top routes on the Overview tab
- Global search across employees, airports and airlines
- Coordinator actions in the UI (add trip, approve/reject)
- Deployment descriptors for BTP (mta.yaml, approuter)

## Repository layout

```
app/dashboard/webapp/   SAPUI5 frontend (Component, manifest, views, controllers, i18n)
db/schema.cds           TripExtension data model (namespace primepath)
srv/                    CAP services + handlers
srv/external/           Imported TripPin EDMX metadata
xs-security.json        XSUAA scopes & role templates
```
