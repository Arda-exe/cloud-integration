sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "primepath/dashboard/util/constants",
    "primepath/dashboard/util/Aggregate"
], function (UIComponent, JSONModel, Filter, FilterOperator, constants, Aggregate) {
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
            this._mListCache = {};        // "model|path"      -> Promise<Array>
            this._mTripsCache = {};       // userName          -> Promise<Array>
            this._mFlightCache = {};      // "userName|tripId" -> Promise<Array>
            this._pTripData = null;       // gememoïseerde [{person, trips}]
            this._pFlightData = null;     // gememoïseerde {perPerson, pairs(+flights)}
            this._pFlightAgg = null;      // gememoïseerde all-time aggregate
            this._pAirportsByIata = null; // gememoïseerde IATA -> airport index

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
                    .requestContexts(0, constants.PAGE_SIZE_LIST)
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
                    .requestContexts(0, constants.PAGE_SIZE_TRIPS)
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
                        "fromIata,fromName,fromCity,toIata,toName,toCity,airlineCode,airlineName" })
                    .requestContexts(0, constants.PAGE_SIZE_FLIGHTS)
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

        // Alle personen met hun trips, één keer per sessie geladen (people + trips-burst).
        // Basis voor de trip-KPI's, top travellers en (via getFlightData) de vlucht-aggregaten.
        getTripData: function () {
            var that = this;
            if (!this._pTripData) {
                this._pTripData = this.getCachedList("people", "/People").then(function (aPeople) {
                    return Promise.all(aPeople.map(function (oPerson) {
                        return that.getCachedTrips(oPerson.UserName).then(function (aTrips) {
                            return { person: oPerson, trips: aTrips };
                        });
                    }));
                }).catch(function (oError) {
                    that._pTripData = null;   // reject niet cachen → retry mogelijk
                    throw oError;
                });
            }
            return this._pTripData;
        },

        // Ruwe data voor de vlucht-aggregatie: per (persoon, trip) paar de vluchten.
        // De burst deelt de getCachedFlights-cache en coalesceert onder $auto tot één $batch.
        getFlightData: function () {
            var that = this;
            if (!this._pFlightData) {
                this._pFlightData = this.getTripData().then(function (aPerPerson) {
                    var aPairs = [];
                    aPerPerson.forEach(function (oEntry) {
                        oEntry.trips.forEach(function (oTrip) {
                            aPairs.push({
                                user: oEntry.person.UserName,
                                tripId: oTrip.TripId,
                                tripName: oTrip.Name,
                                shareId: oTrip.ShareId
                            });
                        });
                    });
                    return Promise.all(aPairs.map(function (oPair) {
                        return that.getCachedFlights(oPair.user, oPair.tripId).then(function (aFlights) {
                            oPair.flights = aFlights;
                            return oPair;
                        });
                    })).then(function (aPairsWithFlights) {
                        return { perPerson: aPerPerson, pairs: aPairsWithFlights };
                    });
                }).catch(function (oError) {
                    that._pFlightData = null;
                    throw oError;
                });
            }
            return this._pFlightData;
        },

        // All-time aggregaat (top airlines/routes + byAirport), gememoïseerd: de zware
        // berekening gebeurt één keer per sessie, revisits zijn direct. Het periodefilter
        // (Overview) herberekent met een range rechtstreeks uit getFlightData (geen netwerk).
        getFlightAggregate: function () {
            var that = this;
            if (!this._pFlightAgg) {
                this._pFlightAgg = this.getFlightData().then(function (oRaw) {
                    return Aggregate.aggregate(oRaw, null);
                }).catch(function (oError) {
                    that._pFlightAgg = null;
                    throw oError;
                });
            }
            return this._pFlightAgg;
        },

        // IATA -> airport-object, O(1) en gememoïseerd (uit de gecachte /Airports-lijst).
        // PlanItems leveren alleen IATA; deze index brugt naar het volledige airport-object
        // (coördinaten, stad) voor de Trip-detail airport-cards en het Airports-zijpaneel.
        getAirportsByIata: function () {
            if (!this._pAirportsByIata) {
                var that = this;
                this._pAirportsByIata = this.getCachedList("airports", "/Airports")
                    .then(function (aAirports) {
                        var mByIata = {};
                        aAirports.forEach(function (oAirport) {
                            if (oAirport.IataCode) {
                                mByIata[oAirport.IataCode.toUpperCase()] = oAirport;
                            }
                        });
                        return mByIata;
                    })
                    .catch(function (oError) {
                        that._pAirportsByIata = null;   // reject niet cachen → retry mogelijk
                        throw oError;
                    });
            }
            return this._pAirportsByIata;
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
