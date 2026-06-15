sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/format/NumberFormat",
    "sap/m/MessageToast",
    "sap/base/Log"
], function (Controller, JSONModel, NumberFormat, MessageToast, Log) {
    "use strict";

    return Controller.extend("primepath.dashboard.controller.Overview", {

        onInit: function () {
            this.getView().setModel(new JSONModel({
                busy: true,
                flightsBusy: true,
                kpi: { employees: "", trips: "", budget: "", airports: "", airlines: "" },
                topTravellers: [],
                topAirlines: [],
                topRoutes: []
            }), "view");
            this._loadKpis();
        },

        _loadKpis: function () {
            var that = this;
            var oComponent = this.getOwnerComponent();
            var oViewModel = this.getView().getModel("view");
            var oBundle = oComponent.getModel("i18n").getResourceBundle();

            Promise.all([
                oComponent.getCachedList("people", "/People"),
                oComponent.getCachedList("airports", "/Airports"),
                oComponent.getCachedList("airlines", "/Airlines")
            ]).then(function (aResults) {
                var aPeople = aResults[0];
                oViewModel.setProperty("/kpi/employees", String(aPeople.length));
                oViewModel.setProperty("/kpi/airports", String(aResults[1].length));
                oViewModel.setProperty("/kpi/airlines", String(aResults[2].length));

                // trips per persoon uit de gedeelde cache (containment in TripPin)
                return Promise.all(aPeople.map(function (oPerson) {
                    return oComponent.getCachedTrips(oPerson.UserName).then(function (aTrips) {
                        return { person: oPerson, trips: aTrips };
                    });
                }));
            }).then(function (aPerPerson) {
                // hergebruikt door fase 2 (top airlines/routes) zodat PersonTrips
                // niet opnieuw wordt opgehaald
                that._aPerPerson = aPerPerson;
                var iTrips = 0;
                var fBudget = 0;
                aPerPerson.forEach(function (oEntry) {
                    iTrips += oEntry.trips.length;
                    fBudget += oEntry.trips.reduce(function (fSum, oTrip) {
                        return fSum + (oTrip.Budget || 0);
                    }, 0);
                });

                var oShortFormat = NumberFormat.getFloatInstance({ style: "short", maxFractionDigits: 1 });
                // NumericContent toont max ~4 tekens; de K/M-suffix hoort in 'scale'
                var aBudgetParts = oShortFormat.format(fBudget).match(/^([\d.,]+)\s*(.*)$/) || [];
                oViewModel.setProperty("/kpi/trips", String(iTrips));
                oViewModel.setProperty("/kpi/budget", aBudgetParts[1] || "");
                oViewModel.setProperty("/kpi/budgetScale", aBudgetParts[2] || "");

                var aTop = aPerPerson
                    .filter(function (oEntry) { return oEntry.trips.length > 0; })
                    .sort(function (a, b) { return b.trips.length - a.trips.length; })
                    .slice(0, 5)
                    .map(function (oEntry) {
                        return {
                            name: oEntry.person.FirstName + " " + oEntry.person.LastName,
                            tripsLabel: oBundle.getText("topTravellersTrips", [oEntry.trips.length])
                        };
                    });
                oViewModel.setProperty("/topTravellers", aTop);
                oViewModel.setProperty("/busy", false);
                // fase 2: vlucht-aggregaten progressief bijladen (eigen busy-indicator)
                that._loadFlightAggregates();
            }).catch(function (oError) {
                Log.error("Loading overview KPIs failed", oError);
                oViewModel.setProperty("/busy", false);
                oViewModel.setProperty("/flightsBusy", false);
                MessageToast.show(oBundle.getText("kpiLoadError"));
            });
        },

        // Top airlines (op aantal vluchten) en top routes (op from→to paar) over ALLE
        // (persoon, trip) paren via de gedeelde vlucht-cache. Het resultaat wordt op de
        // Component gememoïseerd (Variant C): de zware berekening gebeurt één keer per
        // sessie, revisits zijn direct.
        _loadFlightAggregates: function () {
            var that = this;
            var oVM = this.getView().getModel("view");
            var oComponent = this.getOwnerComponent();

            if (oComponent._oFlightAgg) {
                oVM.setProperty("/topAirlines", oComponent._oFlightAgg.topAirlines);
                oVM.setProperty("/topRoutes", oComponent._oFlightAgg.topRoutes);
                oVM.setProperty("/flightsBusy", false);
                return;
            }

            var aPairs = [];
            (this._aPerPerson || []).forEach(function (oEntry) {
                oEntry.trips.forEach(function (oTrip) {
                    aPairs.push({ user: oEntry.person.UserName, tripId: oTrip.TripId });
                });
            });
            if (!aPairs.length) {
                oVM.setProperty("/flightsBusy", false);
                return;
            }

            // synchrone burst → coalesceert onder $auto tot één $batch; de per-paar
            // soft-fail zit in getCachedFlights
            Promise.all(aPairs.map(function (oPair) {
                return oComponent.getCachedFlights(oPair.user, oPair.tripId);
            })).then(function (aPerPair) {
                var oAgg = that._buildAggregate(aPerPair);
                oComponent._oFlightAgg = oAgg;
                oVM.setProperty("/topAirlines", oAgg.topAirlines);
                oVM.setProperty("/topRoutes", oAgg.topRoutes);
                oVM.setProperty("/flightsBusy", false);
            }).catch(function (oError) {
                Log.error("Loading flight aggregates failed", oError);
                oVM.setProperty("/flightsBusy", false);
            });
        },

        // Telt vluchten per airline en per from→to route; geeft de top 5 van elk terug
        // als gelokaliseerde lijst-items. Gedeeld door alle aggregatie-aanroepen.
        _buildAggregate: function (aPerPair) {
            var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            var mAir = {};
            var mRoute = {};
            aPerPair.forEach(function (aFlights) {
                aFlights.forEach(function (oFlight) {
                    if (oFlight.airlineCode) {
                        var oA = mAir[oFlight.airlineCode] || (mAir[oFlight.airlineCode] =
                            { name: oFlight.airlineName || oFlight.airlineCode, count: 0 });
                        oA.count++;
                    }
                    if (oFlight.fromIata && oFlight.toIata) {
                        var sKey = oFlight.fromIata + "->" + oFlight.toIata;
                        var oR = mRoute[sKey] || (mRoute[sKey] = {
                            label: oFlight.fromIata + " → " + oFlight.toIata,
                            sub: (oFlight.fromName || oFlight.fromIata) + " – "
                                + (oFlight.toName || oFlight.toIata),
                            count: 0
                        });
                        oR.count++;
                    }
                });
            });
            var fnTop = function (mMap, fnMap) {
                return Object.keys(mMap)
                    .map(function (sK) { return mMap[sK]; })
                    .sort(function (a, b) { return b.count - a.count; })
                    .slice(0, 5)
                    .map(fnMap);
            };
            return {
                topAirlines: fnTop(mAir, function (o) {
                    return { name: o.name, info: oBundle.getText("topFlightsCount", [o.count]) };
                }),
                topRoutes: fnTop(mRoute, function (o) {
                    return { name: o.label, sub: o.sub, info: oBundle.getText("topRoutesCount", [o.count]) };
                })
            };
        }

    });
});
