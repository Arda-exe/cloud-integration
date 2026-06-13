sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/format/NumberFormat",
    "sap/base/Log"
], function (Controller, JSONModel, Filter, FilterOperator, NumberFormat, Log) {
    "use strict";

    return Controller.extend("primepath.dashboard.controller.Overview", {

        onInit: function () {
            this.getView().setModel(new JSONModel({
                busy: true,
                kpi: { employees: "", trips: "", budget: "", airports: "", airlines: "" },
                topTravellers: []
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
                        [new Filter("Name", FilterOperator.EQ, oPerson.UserName)])
                        .then(function (aTrips) {
                            return { person: oPerson, trips: aTrips };
                        });
                }));
            }).then(function (aPerPerson) {
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
            }).catch(function (oError) {
                Log.error("Loading overview KPIs failed", oError);
                oViewModel.setProperty("/busy", false);
            });
        }

    });
});
