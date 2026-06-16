sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "primepath/dashboard/util/constants",
    "primepath/dashboard/util/Aggregate"
], function (UIComponent, JSONModel, Filter, FilterOperator, constants, Aggregate) {
    "use strict";

    var ROLES = ["TravelCoordinator", "TeamLead", "HR"];
    var ROLE_LANDING = { TravelCoordinator: "employees", TeamLead: "employees", HR: "overview" };
    var ROLE_USER = { TravelCoordinator: "coordinator", TeamLead: "teamlead", HR: "hr" };

    return UIComponent.extend("primepath.dashboard.Component", {
        metadata: {
            manifest: "json",
            interfaces: ["sap.ui.core.IAsyncContentCreation"]
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);

            this._mListCache = {};
            this._mTripsCache = {};
            this._mFlightCache = {};
            this._pTripData = null;
            this._pFlightData = null;
            this._pFlightAgg = null;
            this._pAirportsByIata = null;

            this._bLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
            this._sAuthHeader = null;

            this.setModel(new JSONModel({
                showChrome: false,
                user: { id: "", roles: [], isCoordinator: false, roleLabel: "" }
            }), "app");

            this.getRouter().initialize();

            if (!this._bLocal) {
                var that = this;
                this._loadCurrentUser().then(function (aRoles) {
                    that._routeToRoleLanding(aRoles || []);
                });
            }
        },

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
                        delete that._mListCache[sKey];
                        throw oError;
                    });
            }
            return this._mListCache[sKey];
        },

        getCachedTrips: function (sUserName) {
            var that = this;
            if (!this._mTripsCache[sUserName]) {
                var pTripPin = this.getModel("trips")
                    .bindList("/PersonTrips", undefined, undefined,
                        [new Filter("personUserName", FilterOperator.EQ, sUserName)])
                    .requestContexts(0, constants.PAGE_SIZE_TRIPS)
                    .then(function (aContexts) {
                        return aContexts.map(function (oCtx) {
                            var o = oCtx.getObject();
                            o._isOwn = false;
                            return o;
                        });
                    });

                var mHeaders = { Accept: "application/json" };
                if (this._sAuthHeader) { mHeaders.Authorization = this._sAuthHeader; }
                var pOwn = fetch(
                    "/trips/OwnTrips?$filter=personUserName eq '" + encodeURIComponent(sUserName) + "'",
                    { headers: mHeaders }
                )
                    .then(function (r) { return r.ok ? r.json() : { value: [] }; })
                    .then(function (json) {
                        return (json.value || []).map(function (o) {
                            return {
                                TripId:      o.tripId,
                                Name:        o.name,
                                StartsAt:    o.startsAt,
                                EndsAt:      o.endsAt,
                                Budget:      o.budget,
                                Description: o.description || o.destination || "",
                                _isOwn:      true
                            };
                        });
                    })
                    .catch(function () { return []; });

                this._mTripsCache[sUserName] = Promise.all([pTripPin, pOwn])
                    .then(function (aResults) {
                        return aResults[0].concat(aResults[1]);
                    })
                    .catch(function (oError) {
                        delete that._mTripsCache[sUserName];
                        throw oError;
                    });
            }
            return this._mTripsCache[sUserName];
        },

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
                        return [];
                    });
            }
            return this._mFlightCache[sKey];
        },

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
                    that._pTripData = null;
                    throw oError;
                });
            }
            return this._pTripData;
        },

        getFlightData: function () {
            var that = this;
            if (!this._pFlightData) {
                this._pFlightData = this.getTripData().then(function (aPerPerson) {
                    var aPairs = [];
                    aPerPerson.forEach(function (oEntry) {
                        oEntry.trips.forEach(function (oTrip) {
                            if (oTrip._isOwn) { return; }
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
                        that._pAirportsByIata = null;
                        throw oError;
                    });
            }
            return this._pAirportsByIata;
        },

        needsLogin: function () {
            return this._bLocal && !this._sAuthHeader;
        },

        loginAs: function (sRole) {
            var that = this;
            if (this._bLocal && ROLE_USER[sRole]) {
                this._sAuthHeader = "Basic " + btoa(ROLE_USER[sRole] + ":test");
                ["people", "trips", "airlines", "airports"].forEach(function (sName) {
                    try {
                        that.getModel(sName).changeHttpHeaders({ Authorization: that._sAuthHeader });
                    } catch (e) {}
                });
                var oApp = this.getModel("app");
                oApp.setProperty("/user/roles", [sRole]);
                oApp.setProperty("/user/isCoordinator", sRole === "TravelCoordinator");
                oApp.setProperty("/user/roleLabel", this._roleLabel([sRole]));
                this._loadCurrentUser();
            }
            this.getRouter().navTo(ROLE_LANDING[sRole] || "overview");
        },

        _roleLabel: function (aRoles) {
            var oBundle = this.getModel("i18n").getResourceBundle();
            for (var i = 0; i < ROLES.length; i++) {
                if (aRoles.indexOf(ROLES[i]) !== -1) {
                    return oBundle.getText("role" + ROLES[i] + "Title");
                }
            }
            return "";
        },

        _routeToRoleLanding: function (aRoles) {
            var sLanding = "overview";
            for (var i = 0; i < ROLES.length; i++) {
                if (aRoles.indexOf(ROLES[i]) !== -1) {
                    sLanding = ROLE_LANDING[ROLES[i]];
                    break;
                }
            }
            this.getRouter().navTo(sLanding);
        },

        _loadCurrentUser: function () {
            var that = this;
            var oModel = this.getModel("app");
            var mHeaders = { Accept: "application/json" };
            if (this._sAuthHeader) { mHeaders.Authorization = this._sAuthHeader; }
            return fetch("/user/whoami()", { headers: mHeaders })
                .then(function (oResponse) {
                    return oResponse.ok ? oResponse.json() : null;
                })
                .then(function (oJson) {
                    if (!oJson) { return null; }
                    var oData = oJson.value || oJson;
                    var aRoles = oData.roles || [];
                    oModel.setProperty("/user/id", oData.id || "");
                    oModel.setProperty("/user/roles", aRoles);
                    oModel.setProperty("/user/isCoordinator", aRoles.indexOf("TravelCoordinator") !== -1);
                    oModel.setProperty("/user/roleLabel", that._roleLabel(aRoles));
                    return aRoles;
                })
                .catch(function () { return null; });
        }
    });
});