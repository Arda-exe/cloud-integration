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

    // welke tabs elke rol mag zien (Coordinator = alles). Gedeeld door de IconTabFilter-
    // zichtbaarheid (App.view) én de route-guard (App.controller), zodat een verborgen tab
    // ook niet via de hash/deep-link bereikbaar blijft.
    var ROLE_TABS = {
        TravelCoordinator: ["overview", "employees", "airports"],
        TeamLead:          ["employees", "airports"],
        HR:                ["overview", "airports"]
    };

    // sessionStorage-sleutels: de lokaal gekozen rol (refresh-persistentie) + de op BTP
    // actief-gekozen rol (rol-switcher: welke van je rollen je nu "speelt"), zodat een refresh
    // op een deep-link de scope én de pagina behoudt.
    var STORAGE_ROLE = "primepath.role";
    var STORAGE_ACTIVE_ROLE = "primepath.activeRole";

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
            // op BTP draait de app na de XSUAA-login onder /secure/ (de approuter mirror-route);
            // de publieke launchpad draait onder /dashboard/webapp/ zónder login
            this._bSecure = window.location.pathname.indexOf("/secure/") === 0;
            this._sAuthHeader = null;

            // user: "has*" = welke rollen de gebruiker BEZIT (stuurt de launchpad-tegels);
            // "is*"/roleLabel/activeRole = de ENE rol die nu actief gespeeld wordt (stuurt de
            // tab-/actie-zichtbaarheid in de app). Een multi-rol-gebruiker kiest op de launchpad.
            this.setModel(new JSONModel({
                showChrome: false,
                isLocal: this._bLocal,
                user: { id: "", initials: "", roles: [],
                    hasCoordinator: false, hasTeamLead: false, hasHR: false,
                    isCoordinator: false, isTeamLead: false, isHR: false,
                    activeRole: "", roleLabel: "" }
            }), "app");

            // de hash MOET vóór router.initialize() gelezen worden: bij een refresh op een
            // deep-link (#/employees/x) behouden we díe pagina i.p.v. naar de landing te springen.
            // Rechtstreeks uit de URL: de HashChanger is vóór initialize() nog niet "aan".
            var bHasRoute = !!window.location.hash.replace(/^#\/?/, "");
            var that = this;

            if (this._bLocal) {
                // lokaal: een eerder gekozen rol uit sessionStorage herstellen zodat een refresh
                // niet naar de launchpad bounced. De auth-header MOET gezet zijn vóór initialize()
                // (onRouteMatched vuurt synchroon en checkt needsLogin()).
                var sRole = this._readStorage(STORAGE_ROLE);
                if (sRole && ROLE_USER[sRole]) {
                    this._applyLocalAuth(sRole);
                }
                this.getRouter().initialize();
                if (!bHasRoute && this._sAuthHeader) {
                    this.getRouter().navTo(ROLE_LANDING[sRole] || "overview");
                }
            } else if (this._bSecure) {
                // BTP, ná login: gedraagt zich als "ingelogd". De launchpad is hier een POST-login
                // welkom/rol-kiezer (rol-switcher). whoami vult de bezeten rollen; daarna:
                //  - eerder actief-gekozen rol (uit sessionStorage) die de gebruiker nog bezit →
                //    de scope herstellen en de deep-link/pagina behouden (refresh),
                //  - anders → de launchpad tonen zodat de gebruiker een rol kiest.
                this.getRouter().initialize();
                this._loadCurrentUser().then(function (aRoles) {
                    aRoles = aRoles || [];
                    var sActive = that._readStorage(STORAGE_ACTIVE_ROLE);
                    if (sActive && aRoles.indexOf(sActive) !== -1) {
                        // scope herstellen; bij een refresh op een deep-link de pagina behouden
                        that._setActiveRole(sActive);
                        if (!bHasRoute) {
                            that.getRouter().navTo(ROLE_LANDING[sActive] || "overview");
                        }
                    } else {
                        // geen (herstelbare) actieve rol → de gebruiker moet er eerst één kiezen
                        that.getRouter().navTo("launchpad");
                    }
                });
            } else {
                // BTP, publieke launchpad (vóór login): enkel de launchpad tonen. GEEN whoami —
                // /user/whoami() is xsuaa-protected en zou een XHR 302'en. De launchpad heeft
                // geen geauthenticeerde request nodig.
                this.getRouter().initialize();
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

        // veilige sessionStorage-toegang (kan in privacy-/incognitomodi gooien)
        _readStorage: function (sKey) {
            try { return window.sessionStorage.getItem(sKey); } catch (e) { return null; }
        },
        _writeStorage: function (sKey, sValue) {
            try { window.sessionStorage.setItem(sKey, sValue); } catch (e) { /* private mode */ }
        },
        _removeStorage: function (sKey) {
            try { window.sessionStorage.removeItem(sKey); } catch (e) { /* private mode */ }
        },

        // alle gememoïseerde datasets + de OData-modelcaches droppen. Nodig bij een rolwissel:
        // de backend SCOPET data per rol (srv/people-service.js → People/PersonExtensions worden
        // op de toegelaten UserNames gefilterd), dus zonder dit toont de volgende pagina nog de
        // gescopete data van de vórige rol. Dit is het in-app equivalent van een harde refresh.
        _resetDataCaches: function () {
            this._mListCache = {};
            this._mTripsCache = {};
            this._mFlightCache = {};
            this._pTripData = null;
            this._pFlightData = null;
            this._pFlightAgg = null;
            this._pAirportsByIata = null;
            this._pPersonExt = null;
            this._pTripExt = null;
            ["people", "trips", "airlines", "airports"].forEach(function (sName) {
                var oModel = this.getModel(sName);
                try { if (oModel) { oModel.refresh(); } } catch (e) { /* pending changes */ }
            }, this);
        },

        // lokale mock-auth: Basic-header in de 4 OData-modellen injecteren + user-context zetten.
        // Gedeeld door loginAs (rol-klik) en init (herstel uit sessionStorage na refresh).
        _applyLocalAuth: function (sRole) {
            var that = this;
            this._sAuthHeader = "Basic " + btoa(ROLE_USER[sRole] + ":test");
            ["people", "trips", "airlines", "airports"].forEach(function (sName) {
                try {
                    that.getModel(sName).changeHttpHeaders({ Authorization: that._sAuthHeader });
                } catch (e) {}
            });
            // nieuwe identiteit → de gescopete data van de vorige rol weggooien (zie _resetDataCaches)
            this._resetDataCaches();
            // lokaal heeft de mock-user precies één rol: die bezit hij én speelt hij meteen.
            var oApp = this.getModel("app");
            oApp.setProperty("/user/roles", [sRole]);
            oApp.setProperty("/user/hasCoordinator", sRole === "TravelCoordinator");
            oApp.setProperty("/user/hasTeamLead", sRole === "TeamLead");
            oApp.setProperty("/user/hasHR", sRole === "HR");
            this._setActiveRole(sRole);
            this._loadCurrentUser();
        },

        // de launchpad-tegel-klik: lokaal = echte mock-login als die rol; op BTP (ná XSUAA-login)
        // = "speel" die rol (rol-switcher die de UI scopet), geen nieuwe login.
        pickRole: function (sRole) {
            if (this._bLocal) { this.loginAs(sRole); return; }
            this.actAsRole(sRole);
        },

        // lokaal: mock-auth toepassen, de rol onthouden (refresh-persistentie) en naar de landing.
        loginAs: function (sRole) {
            if (this._bLocal && ROLE_USER[sRole]) {
                this._applyLocalAuth(sRole);
                this._writeStorage(STORAGE_ROLE, sRole);
                this.getRouter().navTo(ROLE_LANDING[sRole] || "overview");
            }
        },

        // enkel de ACTIEVE (gespeelde) rol zetten — de "is*"-vlaggen sturen de tab-/actie-
        // zichtbaarheid in de app. Gedeeld door _applyLocalAuth, actAsRole en het refresh-herstel.
        _setActiveRole: function (sRole) {
            var oApp = this.getModel("app");
            oApp.setProperty("/user/isCoordinator", sRole === "TravelCoordinator");
            oApp.setProperty("/user/isTeamLead", sRole === "TeamLead");
            oApp.setProperty("/user/isHR", sRole === "HR");
            oApp.setProperty("/user/activeRole", sRole);
            oApp.setProperty("/user/roleLabel", this._roleLabel([sRole]));
        },

        // BTP, ná login: één van je rollen "spelen" → scope de UI, onthoud de keuze (refresh) en
        // navigeer naar de landing van die rol.
        actAsRole: function (sRole) {
            this._setActiveRole(sRole);
            this._writeStorage(STORAGE_ACTIVE_ROLE, sRole);
            this.getRouter().navTo(ROLE_LANDING[sRole] || "overview");
        },

        // BTP "Switch role": de actieve rol loslaten (GEEN XSUAA-logout) en terug naar de launchpad
        // om een andere bezeten rol te kiezen.
        clearActiveRole: function () {
            var oApp = this.getModel("app");
            oApp.setProperty("/user/isCoordinator", false);
            oApp.setProperty("/user/isTeamLead", false);
            oApp.setProperty("/user/isHR", false);
            oApp.setProperty("/user/activeRole", "");
            oApp.setProperty("/user/roleLabel", "");
            this._removeStorage(STORAGE_ACTIVE_ROLE);
            this.getRouter().navTo("launchpad");
        },

        // "Switch role" in de ShellBar: lokaal = uitloggen → launchpad; op BTP = enkel de actieve
        // rol loslaten → launchpad (de XSUAA-sessie blijft, dus geen nieuwe login nodig).
        switchRole: function () {
            if (this._bLocal) { this.logout(); return; }
            this.clearActiveRole();
        },

        // echte sign-out. Lokaal: de mock-auth/rolcontext wissen → launchpad. Op BTP: via de
        // approuter uitloggen → dropt de XSUAA-sessie (logoutEndpoint in xs-app.json).
        logout: function () {
            if (this._bLocal) {
                this._removeStorage(STORAGE_ROLE);
                this._removeStorage(STORAGE_ACTIVE_ROLE);
                this._sAuthHeader = null;
                this.getModel("app").setProperty("/user",
                    { id: "", initials: "", roles: [],
                        hasCoordinator: false, hasTeamLead: false, hasHR: false,
                        isCoordinator: false, isTeamLead: false, isHR: false,
                        activeRole: "", roleLabel: "" });
                this.getRouter().navTo("launchpad");
                return;
            }
            window.location.assign("/logout");
        },

        // mag de huidige gebruiker deze tab(-route) zien? Gebaseerd op de ACTIEVE rol (de "is*"-
        // vlaggen), niet op alle bezeten rollen — zo blijft een verborgen tab ook ná de rol-keuze
        // uit de scope. Nog geen actieve rol (launchpad / whoami bezig) → toelaten.
        isTabAllowed: function (sTabKey) {
            var oUser = this.getModel("app").getProperty("/user");
            if (!oUser.isCoordinator && !oUser.isTeamLead && !oUser.isHR) { return true; }
            if (oUser.isCoordinator) { return true; }
            if (oUser.isTeamLead && ROLE_TABS.TeamLead.indexOf(sTabKey) !== -1) { return true; }
            if (oUser.isHR && ROLE_TABS.HR.indexOf(sTabKey) !== -1) { return true; }
            return false;
        },

        // de landing-tab voor de actief gespeelde rol; fallback overview
        roleLanding: function () {
            var sActive = this.getModel("app").getProperty("/user/activeRole");
            return ROLE_LANDING[sActive] || "overview";
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

        _loadCurrentUser: function () {
            var oModel = this.getModel("app");
            // no-store: de whoami-GET mag NIET uit de browsercache komen. Zonder dit hergebruikt de
            // browser (zelfde URL, geen Vary: Authorization) het antwoord van de vórige identiteit —
            // bij een rolwissel (andere XSUAA-user op BTP, ander mock-account lokaal) krijg je dan de
            // gecachte rollen → de launchpad-tegels/tabs blijven "vastzitten" op die eerste rol.
            var mHeaders = { Accept: "application/json", "Cache-Control": "no-cache" };
            if (this._sAuthHeader) { mHeaders.Authorization = this._sAuthHeader; }
            return fetch("/user/whoami()", { headers: mHeaders, cache: "no-store" })
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
                    // membership ("has*") = welke rollen de gebruiker BEZIT (stuurt de launchpad-
                    // tegels). De actieve "is*"-vlaggen worden pas bij de rol-keuze gezet (actAsRole) —
                    // lokaal al synchroon via _applyLocalAuth.
                    oModel.setProperty("/user/hasCoordinator", aRoles.indexOf("TravelCoordinator") !== -1);
                    oModel.setProperty("/user/hasTeamLead", aRoles.indexOf("TeamLead") !== -1);
                    oModel.setProperty("/user/hasHR", aRoles.indexOf("HR") !== -1);
                    return aRoles;
                })
                .catch(function () { return null; });
        }
    });
});