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

    // eigen trips/vluchten hebben een UUID-sleutel; TripPin-trips een numerieke id
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
            this._pPersonExt = null;
            this._pTripExt = null;

            this._bLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
            this._sAuthHeader = null;

            this.setModel(new JSONModel({
                showChrome: false,
                user: { id: "", initials: "", roles: [], isCoordinator: false, roleLabel: "" }
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
                                TripId:         o.tripId,
                                Name:           o.name,
                                StartsAt:       o.startsAt,
                                EndsAt:         o.endsAt,
                                Budget:         o.budget,
                                Description:    o.description || o.destination || "",
                                approvalStatus: o.approvalStatus,
                                _isOwn:         true
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

        // Vluchten per (user, trip). Eigen trips (UUID) komen uit /trips/OwnFlights; TripPin-trips
        // (numerieke id) uit de /PlanItems-proxy. Beide branches leveren dezelfde "ruwe" vorm op,
        // zodat trip-detail én de aggregaten ze identiek verwerken.
        getCachedFlights: function (sUserName, iTripId) {
            var sKey = sUserName + "|" + iTripId;
            if (!this._mFlightCache[sKey]) {
                this._mFlightCache[sKey] = UUID_RE.test(String(iTripId))
                    ? this._loadOwnFlights(iTripId, sKey)
                    : this._loadTripPinFlights(sUserName, iTripId, sKey);
            }
            return this._mFlightCache[sKey];
        },

        _loadTripPinFlights: function (sUserName, iTripId, sKey) {
            var that = this;
            return this.getModel("trips")
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
        },

        // OwnFlight (UUID-trip) plat ophalen en mappen naar de /PlanItems-vorm. OwnFlight heeft
        // geen airlineCode → afgeleid uit de /Airlines-lijst (Name → code), anders valt de vlucht
        // weg uit "Top airlines" (dat groepeert op airlineCode). V4 GUID-literal: GEEN quotes.
        _loadOwnFlights: function (sTripId, sKey) {
            var that = this;
            var mHeaders = { Accept: "application/json" };
            if (this._sAuthHeader) { mHeaders.Authorization = this._sAuthHeader; }
            return Promise.all([
                fetch("/trips/OwnFlights?$filter=tripId eq " + sTripId + "&$top=" + constants.PAGE_SIZE_FLIGHTS,
                    { headers: mHeaders })
                    .then(function (r) { return r.ok ? r.json() : { value: [] }; }),
                this.getCachedList("airlines", "/Airlines")
            ]).then(function (aResults) {
                var aFlights = aResults[0].value || [];
                var mNameToCode = {};
                (aResults[1] || []).forEach(function (oAir) {
                    if (oAir.Name) { mNameToCode[oAir.Name.trim().toUpperCase()] = oAir.AirlineCode; }
                });
                return aFlights.map(function (o) {
                    var sName = o.airlineName || "";
                    return {
                        PlanItemId:   o.flightId,
                        FlightNumber: o.flightNumber || "",
                        SeatNumber:   o.seatNumber || "",
                        StartsAt:     o.startsAt,
                        EndsAt:       o.endsAt,
                        fromIata:     o.fromIata || "",
                        fromName:     o.fromName || "",
                        fromCity:     "",
                        toIata:       o.toIata || "",
                        toName:       o.toName || "",
                        toCity:       "",
                        airlineName:  sName,
                        // echte code als de naam matcht, anders de naam zelf als synthetische code
                        airlineCode:  mNameToCode[sName.trim().toUpperCase()] || sName
                    };
                });
            }).catch(function () {
                delete that._mFlightCache[sKey];
                return [];
            });
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
                            // eigen trips tellen nu mee: hun vluchten komen via getCachedFlights
                            // (UUID → OwnFlights). Geen ShareId → byAirport groepeert op user|tripId.
                            aPairs.push({
                                user: oEntry.person.UserName,
                                tripId: oTrip.TripId,
                                tripName: oTrip.Name,
                                shareId: oTrip.ShareId,
                                // goedkeuring per kopie → de aggregatie telt enkel goedgekeurde
                                // vluchten (eigen trip draagt approvalStatus; TripPin via ext-map)
                                isOwn: !!oTrip._isOwn,
                                approvalStatus: oTrip.approvalStatus
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
                // airlines-lijst meenemen zodat de Overview ook airlines zónder vluchten toont;
                // de TripExtensions-map → enkel goedgekeurde trips tellen in de aggregaten
                this._pFlightAgg = Promise.all([
                    this.getFlightData(),
                    this.getCachedList("airlines", "/Airlines"),
                    this.getTripExtensions()
                ]).then(function (aResults) {
                    return Aggregate.aggregate(aResults[0], null, aResults[1], aResults[2]);
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

        // PersonExtension (team/company/department/status per medewerker) → map op personUserName.
        // Aparte CAP-entiteit, niet op /People — client-side joinen op UserName. Gememoïseerd
        // zoals getAirportsByIata; hergebruikt getCachedList zodat de auth-header al gezet is.
        getPersonExtensions: function () {
            if (!this._pPersonExt) {
                var that = this;
                this._pPersonExt = this.getCachedList("people", "/PersonExtensions")
                    .then(function (aExt) {
                        var mByUser = {};
                        aExt.forEach(function (oExt) {
                            mByUser[oExt.personUserName] = oExt;
                        });
                        return mByUser;
                    })
                    .catch(function (oError) {
                        that._pPersonExt = null;
                        throw oError;
                    });
            }
            return this._pPersonExt;
        },

        // TripExtension (goedkeuringsstatus per TripPin-trip) → map "personUserName|tripId" → status.
        // Gememoïseerd zoals getPersonExtensions, maar GEËVICT bij elke goedkeurings-mutatie
        // (approve/reject/submit in AllTrips) zodat de tellende views meteen kloppen. Eigen trips
        // staan hier NIET in — die dragen approvalStatus in de trip-cache zelf.
        getTripExtensions: function () {
            if (!this._pTripExt) {
                var that = this;
                this._pTripExt = this.getModel("trips").bindList("/TripExtensions")
                    .requestContexts(0, 1000)
                    .then(function (aContexts) {
                        var mExt = {};
                        aContexts.forEach(function (oCtx) {
                            var o = oCtx.getObject();
                            mExt[o.personUserName + "|" + o.tripId] = o.approvalStatus;
                        });
                        return mExt;
                    })
                    .catch(function (oError) {
                        that._pTripExt = null;
                        throw oError;
                    });
            }
            return this._pTripExt;
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
                    var sId = oData.id || "";
                    oModel.setProperty("/user/id", sId);
                    oModel.setProperty("/user/initials", sId.slice(0, 2).toUpperCase());
                    oModel.setProperty("/user/roles", aRoles);
                    oModel.setProperty("/user/isCoordinator", aRoles.indexOf("TravelCoordinator") !== -1);
                    oModel.setProperty("/user/roleLabel", that._roleLabel(aRoles));
                    return aRoles;
                })
                .catch(function () { return null; });
        }
    });
});