sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "primepath/dashboard/util/constants",
    "primepath/dashboard/util/Aggregate"
], function (UIComponent, JSONModel, Filter, FilterOperator, constants, Aggregate) {
    "use strict";

    // de drie rollen, hun landingstab en (lokaal) de bijhorende mocked-auth demo-user
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

            // lokaal (cds watch) = mocked basic-auth met de 3 demo-users; BTP = XSUAA waar de
            // rol vastligt bij de ingelogde gebruiker. Bepaalt of de launchpad echt kan
            // "inloggen als rol" (lokaal) of de echte rol moet volgen (BTP).
            this._bLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
            this._sAuthHeader = null;   // gezet door loginAs (lokaal) → ook op de whoami-fetch

            // app-brede gebruikerscontext voor rol-gating; showChrome verbergt de tab-balk +
            // switch-role-knop op de launchpad. whoami wordt lokaal NIET vroeg aangeroepen
            // (anders een basic-auth-dialog vóór de launchpad verschijnt) → pas in loginAs.
            this.setModel(new JSONModel({
                showChrome: false,
                user: { id: "", roles: [], isCoordinator: false, roleLabel: "" }
            }), "app");

            this.getRouter().initialize();

            // BTP: een rol kan niet geklikt worden → launchpad overslaan en meteen naar de
            // landingstab van de echte rol (whoami via de doorgestuurde XSUAA-sessie).
            if (!this._bLocal) {
                var that = this;
                this._loadCurrentUser().then(function (aRoles) {
                    that._routeToRoleLanding(aRoles || []);
                });
            }
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

        // Lokaal nog niet ingelogd (geen credentials gezet)? Dan sturen de app-routes terug
        // naar de launchpad i.p.v. een basic-auth-dialog te triggeren (refresh/deep-link).
        needsLogin: function () {
            return this._bLocal && !this._sAuthHeader;
        },

        // Echte login als een rol (lokaal). Injecteert de basic-auth credentials van de
        // bijhorende mock-user op de 4 OData-modellen → de backend authentiseert/autoriseert
        // écht als die rol (bv. enkel Coordinator mag approve/reject). Zet de rolcontext en
        // navigeert naar de landingstab. (BTP slaat de launchpad over — zie init.)
        loginAs: function (sRole) {
            var that = this;

            if (this._bLocal && ROLE_USER[sRole]) {
                // injecteer de basic-auth credentials op de 4 OData-modellen → de backend
                // authentiseert/autoriseert écht als die rol
                this._sAuthHeader = "Basic " + btoa(ROLE_USER[sRole] + ":test");
                ["people", "trips", "airlines", "airports"].forEach(function (sName) {
                    try {
                        that.getModel(sName).changeHttpHeaders({ Authorization: that._sAuthHeader });
                    } catch (e) {
                        // changeHttpHeaders werpt bij lopende requests; bij een rolwissel is dit
                        // zeldzaam en niet kritisch (reads zijn rol-onafhankelijk)
                    }
                });
                // rolcontext zetten (lokaal is de gekozen rol leidend) → UI-gating + ShellBar
                var oApp = this.getModel("app");
                oApp.setProperty("/user/roles", [sRole]);
                oApp.setProperty("/user/isCoordinator", sRole === "TravelCoordinator");
                oApp.setProperty("/user/roleLabel", this._roleLabel([sRole]));
                // echte identiteit/rollen bevestigen via whoami (met dezelfde credentials)
                this._loadCurrentUser();
            }
            // BTP: de rolcontext van whoami (init) blijft leidend → hier enkel navigeren
            this.getRouter().navTo(ROLE_LANDING[sRole] || "overview");
        },

        // gelokaliseerd label van de (eerst gevonden) rol, voor de ShellBar secondaryTitle
        _roleLabel: function (aRoles) {
            var oBundle = this.getModel("i18n").getResourceBundle();
            for (var i = 0; i < ROLES.length; i++) {
                if (aRoles.indexOf(ROLES[i]) !== -1) {
                    return oBundle.getText("role" + ROLES[i] + "Title");
                }
            }
            return "";
        },

        // BTP: navigeer naar de landingstab van de echte rol (Coordinator/TeamLead → Employees,
        // HR → Overview); zonder bekende rol valt het terug op Overview.
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

        // Haalt id + rollen op via /user/whoami(). Lokaal sturen we de basic-auth header mee
        // (door loginAs gezet); op BTP draagt de doorgestuurde XSUAA-sessie de auth. Geeft de
        // rollen terug zodat de BTP-bypass naar de juiste landingstab kan routeren.
        _loadCurrentUser: function () {
            var that = this;
            var oModel = this.getModel("app");
            var mHeaders = { Accept: "application/json" };
            if (this._sAuthHeader) {
                mHeaders.Authorization = this._sAuthHeader;
            }
            return fetch("/user/whoami()", { headers: mHeaders })
                .then(function (oResponse) {
                    return oResponse.ok ? oResponse.json() : null;
                })
                .then(function (oJson) {
                    if (!oJson) {
                        return null;
                    }
                    var oData = oJson.value || oJson;
                    var aRoles = oData.roles || [];
                    oModel.setProperty("/user/id", oData.id || "");
                    oModel.setProperty("/user/roles", aRoles);
                    oModel.setProperty("/user/isCoordinator", aRoles.indexOf("TravelCoordinator") !== -1);
                    oModel.setProperty("/user/roleLabel", that._roleLabel(aRoles));
                    return aRoles;
                })
                .catch(function () {
                    // geen gebruiker / endpoint niet beschikbaar → geen coordinator-UI
                    return null;
                });
        }
    });
});
