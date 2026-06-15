sap.ui.define([
    "primepath/dashboard/util/constants"
], function (constants) {
    "use strict";

    // Zuivere, model-vrije aggregatie over de ruwe trip/vlucht-data. Geen UI5-afhankelijkheid
    // → makkelijk te testen en gedeeld door Overview (KPI's + charts + periodefilter),
    // TripDetail (airport-cards) en Airports (zijpaneel).
    //
    // oRange (optioneel) = { from: Date, to: Date } of null/undefined voor "all-time".
    // Tellingen zijn NUMERIEK (charts hebben een measure nodig); i18n-formatting gebeurt
    // bij de consument.

    function toMs(sIso) {
        return sIso ? new Date(sIso).getTime() : NaN;
    }

    function rangeBounds(oRange) {
        return {
            from: oRange.from.getTime(),
            // einddatum inclusief tot einde van de dag (zelfde conventie als EmployeeDetail)
            to: oRange.to.getTime() + constants.MS_PER_DAY - 1
        };
    }

    // een trip telt mee zodra hij de periode OVERLAPT
    function tripInRange(oTrip, oRange) {
        if (!oRange) {
            return true;
        }
        var b = rangeBounds(oRange);
        return toMs(oTrip.EndsAt) >= b.from && toMs(oTrip.StartsAt) <= b.to;
    }

    // een vlucht telt mee als zijn vertrek (StartsAt) BINNEN de periode valt
    function flightInRange(oFlight, oRange) {
        if (!oRange) {
            return true;
        }
        var b = rangeBounds(oRange);
        var iDep = toMs(oFlight.StartsAt);
        return iDep >= b.from && iDep <= b.to;
    }

    function topN(mMap, fnMap) {
        return Object.keys(mMap)
            .map(function (sK) { return mMap[sK]; })
            .sort(function (a, b) { return b.count - a.count; })
            .slice(0, constants.TOP_N)
            .map(fnMap);
    }

    function addAirport(mAirport, sIata, bDeparture, oPair) {
        if (!sIata) {
            return;
        }
        var o = mAirport[sIata] || (mAirport[sIata] =
            { departures: 0, arrivals: 0, trips: {} });
        if (bDeparture) {
            o.departures++;
        } else {
            o.arrivals++;
        }
        // groepeer op ShareId (dezelfde trip over meerdere personen) → één entry per trip,
        // niet per kopie. De eerste kopie (heeft vluchten) is de representatieve user/tripId.
        var sKey = oPair.shareId || (oPair.user + "|" + oPair.tripId);
        o.trips[sKey] || (o.trips[sKey] = {
            tripName: oPair.tripName,
            user: oPair.user,      // representatieve kopie: heeft vluchten (we zitten in de
            tripId: oPair.tripId,  // vluchten-loop) → trip-detail laadt direct, geen lege kopie
            shareId: oPair.shareId
        });
    }

    // trip-gecentreerde metrics: aantal trips, totaal budget, top reizigers (op trip-aantal)
    function aggregateTrips(aPerPerson, oRange) {
        var iTrips = 0;
        var fBudget = 0;
        var aTravellers = [];
        (aPerPerson || []).forEach(function (oEntry) {
            var aTrips = oEntry.trips.filter(function (oTrip) {
                return tripInRange(oTrip, oRange);
            });
            iTrips += aTrips.length;
            fBudget += aTrips.reduce(function (f, oTrip) {
                return f + (oTrip.Budget || 0);
            }, 0);
            if (aTrips.length) {
                aTravellers.push({
                    name: (oEntry.person.FirstName || "") + " " + (oEntry.person.LastName || ""),
                    count: aTrips.length
                });
            }
        });
        aTravellers.sort(function (a, b) { return b.count - a.count; });
        return {
            trips: iTrips,
            budget: fBudget,
            topTravellers: aTravellers.slice(0, constants.TOP_N)
        };
    }

    // volledige aggregatie: trip-metrics + vlucht-gebaseerde top airlines/routes + byAirport
    // oRaw = { perPerson: [{person, trips}], pairs: [{user, tripId, tripName, flights:[]}] }
    function aggregate(oRaw, oRange) {
        var oTrip = aggregateTrips(oRaw.perPerson, oRange);
        var mAir = {};
        var mRoute = {};
        var mAirport = {};

        // alle reizigers per gedeelde trip (ShareId) — zodat de "trips via deze luchthaven"-
        // teller hetzelfde betekent als de co-travellers op de trip-detail (iedereen op de trip,
        // ook kopieën zonder vluchten), niet enkel wie via deze luchthaven vloog
        var mShareMembers = {};
        (oRaw.perPerson || []).forEach(function (oEntry) {
            oEntry.trips.forEach(function (oT) {
                if (oT.ShareId) {
                    (mShareMembers[oT.ShareId] || (mShareMembers[oT.ShareId] = {}))[oEntry.person.UserName] = true;
                }
            });
        });

        (oRaw.pairs || []).forEach(function (oPair) {
            (oPair.flights || []).forEach(function (oFlight) {
                if (!flightInRange(oFlight, oRange)) {
                    return;
                }
                if (oFlight.airlineCode) {
                    var oA = mAir[oFlight.airlineCode] || (mAir[oFlight.airlineCode] =
                        { name: oFlight.airlineName || oFlight.airlineCode, count: 0 });
                    oA.count++;
                }
                if (oFlight.fromIata && oFlight.toIata) {
                    var sRk = oFlight.fromIata + "->" + oFlight.toIata;
                    var oR = mRoute[sRk] || (mRoute[sRk] = {
                        label: oFlight.fromIata + " → " + oFlight.toIata,
                        sub: (oFlight.fromName || oFlight.fromIata) + " – "
                            + (oFlight.toName || oFlight.toIata),
                        count: 0
                    });
                    oR.count++;
                }
                addAirport(mAirport, oFlight.fromIata, true, oPair);
                addAirport(mAirport, oFlight.toIata, false, oPair);
            });
        });

        var byAirport = {};
        Object.keys(mAirport).forEach(function (sIata) {
            var o = mAirport[sIata];
            byAirport[sIata] = {
                departures: o.departures,
                arrivals: o.arrivals,
                total: o.departures + o.arrivals,
                trips: Object.keys(o.trips).map(function (sK) {
                    var t = o.trips[sK];
                    return {
                        tripName: t.tripName,
                        user: t.user,
                        tripId: t.tripId,
                        travellers: (t.shareId && mShareMembers[t.shareId])
                            ? Object.keys(mShareMembers[t.shareId]).length
                            : 1
                    };
                })
            };
        });

        return {
            kpis: { trips: oTrip.trips, budget: oTrip.budget },
            topTravellers: oTrip.topTravellers,
            topAirlines: topN(mAir, function (o) {
                return { name: o.name, count: o.count };
            }),
            topRoutes: topN(mRoute, function (o) {
                return { label: o.label, sub: o.sub, count: o.count };
            }),
            byAirport: byAirport
        };
    }

    return {
        aggregateTrips: aggregateTrips,
        aggregate: aggregate
    };
});
