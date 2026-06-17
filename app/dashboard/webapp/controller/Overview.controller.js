sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/format/NumberFormat",
    "sap/m/MessageToast",
    "sap/base/Log",
    "primepath/dashboard/util/Aggregate",
    "primepath/dashboard/util/datePresets"
], function (BaseController, JSONModel, NumberFormat, MessageToast, Log, Aggregate, datePresets) {
    "use strict";

    return BaseController.extend("primepath.dashboard.controller.Overview", {

        onInit: function () {
            this.getView().setModel(new JSONModel({
                busy: true,
                flightsBusy: true,
                preset: "all",   // actieve snelkeuze ("" = handmatig bereik)
                travellersRankBy: "trips",   // top reizigers op trip-aantal of op budget
                kpi: { employees: "", trips: "", budget: "", budgetScale: "", airports: "", airlines: "" },
                topTravellers: [],
                topAirlines: [],
                topRoutes: []
            }), "view");
            this._aAirlines = [];      // volledige airline-lijst → ook airlines met 0 vluchten tonen
            this._aTravellers = [];    // volledige reizigerslijst (count + budget) voor de toggle
            this._loadKpis();
        },

        _loadKpis: function () {
            var that = this;
            var oComponent = this.getOwnerComponent();
            var oVM = this.getView().getModel("view");

            // fase 1: entiteit-counts + trip-gebaseerde KPI's (trips, budget, top travellers).
            // De vlucht-burst (fase 2) komt erna zodat de tegels meteen renderen.
            Promise.all([
                oComponent.getCachedList("people", "/People"),
                oComponent.getCachedList("airports", "/Airports"),
                oComponent.getCachedList("airlines", "/Airlines"),
                oComponent.getTripData()
            ]).then(function (aResults) {
                oVM.setProperty("/kpi/employees", String(aResults[0].length));
                oVM.setProperty("/kpi/airports", String(aResults[1].length));
                oVM.setProperty("/kpi/airlines", String(aResults[2].length));
                that._aAirlines = aResults[2];

                that._applyTripMetrics(Aggregate.aggregateTrips(aResults[3], null));
                oVM.setProperty("/busy", false);

                that._loadFlightAggregates();
            }).catch(function (oError) {
                Log.error("Loading overview KPIs failed", oError);
                oVM.setProperty("/busy", false);
                oVM.setProperty("/flightsBusy", false);
                MessageToast.show(that.getResourceBundle().getText("kpiLoadError"));
            });
        },

        // fase 2: top airlines / top routes uit het gememoïseerde all-time aggregaat
        _loadFlightAggregates: function () {
            var that = this;
            var oVM = this.getView().getModel("view");
            this.getOwnerComponent().getFlightAggregate().then(function (oAgg) {
                that._applyFlightMetrics(oAgg);
                oVM.setProperty("/flightsBusy", false);
            }).catch(function (oError) {
                Log.error("Loading flight aggregates failed", oError);
                oVM.setProperty("/flightsBusy", false);
            });
        },

        // periodefilter: trips, budget, top travellers en top airlines/routes weerspiegelen
        // de gekozen periode. Entiteit-counts (employees/airports/airlines) blijven constant.
        // Leeg bereik = all-time. Herberekent uit de gecachte ruwe data — geen netwerk.
        onPeriodChange: function (oEvent) {
            // handmatig bereik → geen snelkeuze meer actief
            this.getView().getModel("view").setProperty("/preset", "");
            var oFrom = oEvent.getSource().getDateValue();
            var oTo = oEvent.getSource().getSecondDateValue();
            this._applyPeriod((oFrom && oTo) ? { from: oFrom, to: oTo } : null);
        },

        // snelkeuze-knop: vult de DateRangeSelection (programmatisch → vuurt geen change)
        // en herberekent meteen. "all" wist het bereik.
        onPresetPress: function (oEvent) {
            var sKey = oEvent.getSource().data("period");
            var oRange = datePresets.rangeFor(sKey);
            this.getView().getModel("view").setProperty("/preset", sKey);
            var oPicker = this.byId("overviewPeriod");
            oPicker.setDateValue(oRange ? oRange.from : null);
            oPicker.setSecondDateValue(oRange ? oRange.to : null);
            this._applyPeriod(oRange);
        },

        _applyPeriod: function (oRange) {
            var that = this;
            var oVM = this.getView().getModel("view");
            oVM.setProperty("/flightsBusy", true);
            this.getOwnerComponent().getFlightData().then(function (oRaw) {
                var oAgg = Aggregate.aggregate(oRaw, oRange, that._aAirlines);
                that._applyTripMetrics({
                    trips: oAgg.kpis.trips,
                    budget: oAgg.kpis.budget,
                    topTravellers: oAgg.topTravellers
                });
                that._applyFlightMetrics(oAgg);
                oVM.setProperty("/flightsBusy", false);
            }).catch(function (oError) {
                Log.error("Recomputing overview for period failed", oError);
                oVM.setProperty("/flightsBusy", false);
                MessageToast.show(that.getResourceBundle().getText("kpiLoadError"));
            });
        },

        // ---- aggregaat → view-model (numerieke count voor charts + gelokaliseerd label) ----

        _applyTripMetrics: function (oTrip) {
            var oVM = this.getView().getModel("view");
            var oBundle = this.getResourceBundle();

            oVM.setProperty("/kpi/trips", String(oTrip.trips));

            // NumericContent toont max ~4 tekens; de K/M-suffix hoort in 'scale'
            var oShort = NumberFormat.getFloatInstance({ style: "short", maxFractionDigits: 1 });
            var aParts = oShort.format(oTrip.budget).match(/^([\d.,]+)\s*(.*)$/) || [];
            oVM.setProperty("/kpi/budget", aParts[1] || "");
            oVM.setProperty("/kpi/budgetScale", aParts[2] || "");

            this._aTravellers = oTrip.topTravellers;   // volledige lijst met count + budget
            this._renderTravellers();
        },

        // sorteert ALLE reizigers op de gekozen maatstaf (trips of budget) en bouwt het juiste
        // label. Geen Top-N-cap meer → de volledige lijst is scrollbaar, net als de andere
        // kaarten. Wordt herbruikt door de toggle (geen netwerk/herberekening).
        _renderTravellers: function () {
            var oVM = this.getView().getModel("view");
            var oBundle = this.getResourceBundle();
            var sBy = oVM.getProperty("/travellersRankBy");
            var oNum = NumberFormat.getFloatInstance({ maxFractionDigits: 0 });
            var aTop = this._aTravellers.slice().sort(function (a, b) {
                return sBy === "budget" ? (b.budget - a.budget) : (b.count - a.count);
            });
            oVM.setProperty("/topTravellers", aTop.map(function (o) {
                return {
                    name: o.name,
                    valueLabel: sBy === "budget"
                        ? oBundle.getText("topTravellersBudget", [oNum.format(o.budget)])
                        : oBundle.getText("topTravellersTrips", [o.count])
                };
            }));
        },

        onTravellersRankChange: function (oEvent) {
            this.getView().getModel("view").setProperty(
                "/travellersRankBy", oEvent.getParameter("item").getKey());
            this._renderTravellers();
        },

        _applyFlightMetrics: function (oAgg) {
            var oVM = this.getView().getModel("view");
            var oBundle = this.getResourceBundle();

            // percent = aandeel t.o.v. de drukste airline/route → balklengte van de ProgressIndicator
            var iAirlineMax = oAgg.topAirlines.reduce(function (m, o) { return Math.max(m, o.count); }, 0);
            oVM.setProperty("/topAirlines", oAgg.topAirlines.map(function (o) {
                return {
                    name: o.name,
                    count: o.count,
                    percent: iAirlineMax ? Math.round(o.count / iAirlineMax * 100) : 0,
                    info: oBundle.getText("topFlightsCount", [o.count])
                };
            }));

            var iRouteMax = oAgg.topRoutes.reduce(function (m, o) { return Math.max(m, o.count); }, 0);
            oVM.setProperty("/topRoutes", oAgg.topRoutes.map(function (o) {
                return {
                    name: o.label,
                    sub: o.sub,
                    count: o.count,
                    percent: iRouteMax ? Math.round(o.count / iRouteMax * 100) : 0,
                    info: oBundle.getText("topRoutesCount", [o.count])
                };
            }));
        }

    });
});
