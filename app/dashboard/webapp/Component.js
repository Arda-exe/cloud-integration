sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (UIComponent, JSONModel, Filter, FilterOperator) {
    "use strict";

    return UIComponent.extend("primepath.dashboard.Component", {
        metadata: {
            manifest: "json",
            interfaces: ["sap.ui.core.IAsyncContentCreation"]
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);

            // App-brede response-cache (sessieduur). Slaat Promises op zodat gelijktijdige
            // eerste-aanroepers één lopende request delen; TripPin is read-only → geen TTL.
            // TripExtensions (schrijfbaar) gaat hier NOOIT doorheen.
            this._mListCache = {};    // "model|path"     -> Promise<Array>
            this._mTripsCache = {};   // userName         -> Promise<Array>
            this._mFlightCache = {};  // "userName|tripId" -> Promise<Array>
            this._oFlightAgg = null;  // gememoïseerde Overview top airlines/routes

            // app-brede gebruikerscontext voor rol-gating (feature 8): tot whoami
            // antwoordt is niemand coordinator, dus coordinator-only UI blijft verborgen
            this.setModel(new JSONModel({
                user: { id: "", roles: [], isCoordinator: false }
            }), "app");
            this._loadCurrentUser();

            this.getRouter().initialize();
        },

        // Volledige collectie (/People, /Airports, /Airlines), één keer per sessie geladen
        // en gedeeld door alle views (Overview, Employees, Airports, global search).
        getCachedList: function (sModelName, sPath) {
            var that = this;
            var sKey = sModelName + "|" + sPath;
            if (!this._mListCache[sKey]) {
                this._mListCache[sKey] = this.getModel(sModelName)
                    .bindList(sPath)
                    .requestContexts(0, 500)
                    .then(function (aContexts) {
                        return aContexts.map(function (oCtx) { return oCtx.getObject(); });
                    })
                    .catch(function (oError) {
                        delete that._mListCache[sKey];   // reject niet cachen → retry mogelijk
                        throw oError;
                    });
            }
            return this._mListCache[sKey];
        },

        // PersonTrips voor één persoon (Overview + EmployeeDetail + TripDetail).
        getCachedTrips: function (sUserName) {
            var that = this;
            if (!this._mTripsCache[sUserName]) {
                this._mTripsCache[sUserName] = this.getModel("trips")
                    .bindList("/PersonTrips", undefined, undefined,
                        [new Filter("personUserName", FilterOperator.EQ, sUserName)])
                    .requestContexts(0, 200)
                    .then(function (aContexts) {
                        return aContexts.map(function (oCtx) { return oCtx.getObject(); });
                    })
                    .catch(function (oError) {
                        delete that._mTripsCache[sUserName];
                        throw oError;
                    });
            }
            return this._mTripsCache[sUserName];
        },

        // PlanItems (vluchten) voor één (persoon, trip) paar (Overview + TripDetail).
        // Superset-$select zodat beide consumenten dezelfde snapshot kunnen delen.
        getCachedFlights: function (sUserName, iTripId) {
            var that = this;
            var sKey = sUserName + "|" + iTripId;
            if (!this._mFlightCache[sKey]) {
                this._mFlightCache[sKey] = this.getModel("trips")
                    .bindList("/PlanItems", undefined, undefined, [
                        new Filter("personUserName", FilterOperator.EQ, sUserName),
                        new Filter("tripId", FilterOperator.EQ, iTripId)
                    ], { $select: "PlanItemId,FlightNumber,SeatNumber,StartsAt,EndsAt," +
                        "fromIata,fromName,toIata,toName,airlineCode,airlineName" })
                    .requestContexts(0, 200)
                    .then(function (aContexts) {
                        return aContexts.map(function (oCtx) { return oCtx.getObject(); });
                    })
                    .catch(function () {
                        delete that._mFlightCache[sKey];
                        return [];   // soft-fail per paar (zoals de huidige Overview)
                    });
            }
            return this._mFlightCache[sKey];
        },

        // Haalt de rollen op via het (geïsoleerde) /user/whoami() endpoint. Same-origin,
        // werkt lokaal (cds watch) en via de BTP approuter.
        _loadCurrentUser: function () {
            var oModel = this.getModel("app");
            fetch("/user/whoami()", { headers: { Accept: "application/json" } })
                .then(function (oResponse) {
                    return oResponse.ok ? oResponse.json() : null;
                })
                .then(function (oJson) {
                    if (!oJson) {
                        return;
                    }
                    var oData = oJson.value || oJson;
                    var aRoles = oData.roles || [];
                    oModel.setProperty("/user/id", oData.id || "");
                    oModel.setProperty("/user/roles", aRoles);
                    oModel.setProperty("/user/isCoordinator", aRoles.indexOf("TravelCoordinator") !== -1);
                })
                .catch(function () {
                    // geen gebruiker / endpoint niet beschikbaar → geen coordinator-UI
                });
        }
    });
});
