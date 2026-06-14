sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/format/NumberFormat",
    "sap/m/MessageToast",
    "sap/base/Log"
], function (Controller, JSONModel, Filter, FilterOperator, NumberFormat, MessageToast, Log) {
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

            var fnList = function (sModel, sPath, aFilters) {
                return oComponent.getModel(sModel)
                    .bindList(sPath, undefined, undefined, aFilters)
                    .requestContexts(0, 200)
                    .then(function (aContexts) {
                        return aContexts.map(function (oContext) {
                            return oContext.getObject();
                        });
                    });
            };

            Promise.all([
                fnList("people", "/People"),
                fnList("airports", "/Airports"),
                fnList("airlines", "/Airlines")
            ]).then(function (aResults) {
                var aPeople = aResults[0];
                oViewModel.setProperty("/kpi/employees", String(aPeople.length));
                oViewModel.setProperty("/kpi/airports", String(aResults[1].length));
                oViewModel.setProperty("/kpi/airlines", String(aResults[2].length));

                // trips zijn alleen per persoon opvraagbaar (containment in TripPin)
                return Promise.all(aPeople.map(function (oPerson) {
                    return fnList("trips", "/PersonTrips",
                        [new Filter("personUserName", FilterOperator.EQ, oPerson.UserName)])
                        .then(function (aTrips) {
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

        // Top airlines (op aantal vluchten) en top routes (op from→to paar), berekend
        // over alle (persoon, trip) paren via /trips/PlanItems. Veel requests, dus één
        // Promise.all met per-request soft-fail.
        _loadFlightAggregates: function () {
            var oVM = this.getView().getModel("view");
            var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            var oTrips = this.getOwnerComponent().getModel("trips");

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

            Promise.all(aPairs.map(function (oPair) {
                return oTrips.bindList("/PlanItems", undefined, undefined, [
                    new Filter("personUserName", FilterOperator.EQ, oPair.user),
                    new Filter("tripId", FilterOperator.EQ, oPair.tripId)
                ], { $select: "airlineCode,airlineName,fromIata,fromName,toIata,toName" })
                .requestContexts(0, 200)
                .then(function (aContexts) {
                    return aContexts.map(function (oContext) { return oContext.getObject(); });
                })
                .catch(function () { return []; });
            })).then(function (aPerPair) {
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
                oVM.setProperty("/topAirlines", fnTop(mAir, function (o) {
                    return { name: o.name, info: oBundle.getText("topFlightsCount", [o.count]) };
                }));
                oVM.setProperty("/topRoutes", fnTop(mRoute, function (o) {
                    return { name: o.label, sub: o.sub, info: oBundle.getText("topRoutesCount", [o.count]) };
                }));
                oVM.setProperty("/flightsBusy", false);
            }).catch(function (oError) {
                Log.error("Loading flight aggregates failed", oError);
                oVM.setProperty("/flightsBusy", false);
            });
        }

    });
});
