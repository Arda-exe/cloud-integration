sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/format/DateFormat",
    "sap/m/MessageToast",
    "sap/base/Log",
    "primepath/dashboard/util/formatters",
    "primepath/dashboard/util/tripGroups"
], function (BaseController, JSONModel, DateFormat, MessageToast, Log, formatters, tripGroups) {
    "use strict";

    var STATUS_STATE = {
        approved: "Success",
        rejected: "Error",
        pending:  "Warning"
    };

    // statuskey → i18n-sleutel; zelfde teksten als de All Trips-lijst
    var STATUS_TEXT_KEY = { approved: "appr_approved", rejected: "appr_rejected", pending: "appr_pending" };

    return BaseController.extend("primepath.dashboard.controller.TripDetail", {

        onInit: function () {
            this._oDateTimeFormat = DateFormat.getDateTimeInstance({ style: "medium" });
            this._iLoadSeq = 0;
            this.getView().setModel(new JSONModel({
                busy: false,
                personName: "",
                periodText: "",
                trip: {},
                totalBudget: 0,
                members: [],
                flights: [],
                flightsBusy: false,
                route: { has: false }
            }), "trip");
            this.getRouter().getRoute("trip")
                .attachPatternMatched(this.onPatternMatched, this);
        },

        // statuskey → leesbare tekst (gedeeld met de All Trips-lijst)
        _statusText: function (sKey) {
            var oBundle = this.getResourceBundle();
            return sKey === "notsubmitted"
                ? oBundle.getText("approvalNone")
                : oBundle.getText(STATUS_TEXT_KEY[sKey] || "approvalNone");
        },

       onPatternMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            this._sUserName  = oArgs.userName;
            this._sTripIdRaw = oArgs.tripId;
            this._iTripId    = parseInt(oArgs.tripId, 10);
    
            this._bIsOwn = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oArgs.tripId);
            this._load();
        },

        _load: function () {
            if (this._bIsOwn) {
                this._loadOwnTrip();
                return;
            }
            this._loadTripPinTrip();
        },


        _loadOwnTrip: function () {
            var that = this;
            var iSeq = ++this._iLoadSeq;
            var sUserName = this._sUserName;
            var sTripIdRaw = this._sTripIdRaw;
            var oModel = this.getView().getModel("trip");
            var oComp = this.getOwnerComponent();

            // flightsBusy:true → de routeblok-leegstaat flitst niet voordat de vluchten geladen zijn
            oModel.setData({
                busy: true, personName: this._sUserName, periodText: "",
                trip: {}, totalBudget: 0, members: [], flights: [], flightsBusy: true,
                route: { has: false }
            });

            var mHeaders = { Accept: "application/json" };
            if (oComp._sAuthHeader) { mHeaders.Authorization = oComp._sAuthHeader; }

            // trip + vluchten in ÉÉN Promise.all (net als de TripPin-tak): zo renderen de
            // vluchten/route nooit op een trip waarvan de header niet laadde. getCachedFlights en
            // getAirportsByIata vangen hun eigen fout op → alleen de OwnTrips-fetch kan rejecten.
            Promise.all([
                fetch("/trips/OwnTrips(" + sTripIdRaw + ")", { headers: mHeaders })
                    .then(function (r) {
                        if (!r.ok) { throw new Error("HTTP " + r.status); }
                        return r.json();
                    }),
                oComp.getCachedFlights(sUserName, sTripIdRaw),
                oComp.getAirportsByIata().catch(function () { return {}; })
            ]).then(function (aResults) {
                if (iSeq !== that._iLoadSeq) { return; }
                var oTrip = aResults[0];
                var aFlights = aResults[1];
                var mByIata = aResults[2];

                var sStatus = oTrip.approvalStatus || "pending";
                oModel.setProperty("/trip", {
                    Name:        oTrip.name,
                    Budget:      oTrip.budget,
                    Description: oTrip.description || oTrip.destination || ""
                });
                oModel.setProperty("/personName", that._sUserName);
                oModel.setProperty("/periodText", formatters.formatPeriod(oTrip.startsAt, oTrip.endsAt));
                // eigen trip = één reiziger → totaal = eigen budget
                oModel.setProperty("/totalBudget", oTrip.budget || 0);
                oModel.setProperty("/members", [{
                    userName:    that._sUserName,
                    name:        that._sUserName,
                    budget:      oTrip.budget,
                    statusText:  that._statusText(sStatus),
                    statusState: STATUS_STATE[sStatus] || "None"
                }]);
                oModel.setProperty("/busy", false);

                // vluchten identiek toegepast als bij een TripPin-trip (tabel + routeblok + tellers)
                if (aFlights && aFlights.length) {
                    that._applyFlights(aFlights);
                    that._applyRoute(aFlights, mByIata);
                } else {
                    oModel.setProperty("/flightsBusy", false);
                }
            })
            .catch(function (oError) {
                if (iSeq !== that._iLoadSeq) { return; }
                Log.error("Loading own trip failed", oError);
                oModel.setProperty("/busy", false);
                oModel.setProperty("/flightsBusy", false);
                MessageToast.show(that.getResourceBundle().getText("tripLoadError"));
            });
        },

        _loadTripPinTrip: function () {
            var that = this;
            var iSeq = ++this._iLoadSeq;
            var sUserName = this._sUserName;
            var iTripId = this._iTripId;
            var oModel = this.getView().getModel("trip");
            var oComponent = this.getOwnerComponent();
            var oTripsModel = oComponent.getModel("trips");

            oModel.setData({
                busy: true,
                personName: this._sUserName,
                periodText: "",
                trip: {},
                totalBudget: 0,
                members: [],
                flights: [],
                flightsBusy: true,
                route: { has: false }
            });

            Promise.all([
                oComponent.getCachedTrips(this._sUserName),
                oComponent.getCachedFlights(this._sUserName, this._iTripId),
                oComponent.getAirportsByIata().catch(function () { return {}; })
            ]).then(function (aResults) {
                if (iSeq !== that._iLoadSeq) { return; }
                var oTrip = aResults[0].find(function (oCandidate) {
                    return oCandidate.TripId === iTripId;
                });

                if (!oTrip) {
                    oModel.setProperty("/busy", false);
                    oModel.setProperty("/flightsBusy", false);
                    MessageToast.show(that.getResourceBundle().getText("tripLoadError"));
                    return;
                }

                var aOwnFlights = aResults[1];
                var mByIata = aResults[2];
                // per-reiziger budget + status komt uit _loadSharedTrip (groepeert op ShareId)
                that._applyTrip(oTrip);
                oModel.setProperty("/busy", false);

                if (aOwnFlights && aOwnFlights.length) {
                    that._applyFlights(aOwnFlights);
                    that._applyRoute(aOwnFlights, mByIata);
                }
                that._loadSharedTrip(oTrip, aOwnFlights, mByIata, sUserName, iTripId, iSeq);
            }).catch(function (oError) {
                if (iSeq !== that._iLoadSeq) { return; }
                Log.error("Loading trip detail failed", oError);
                oModel.setProperty("/busy", false);
                oModel.setProperty("/flightsBusy", false);
                MessageToast.show(that.getResourceBundle().getText("tripLoadError"));
            });
        },

        _applyFlights: function (aFlightObjects) {
            var that = this;
            var sNone = this.getResourceBundle().getText("valueNone");
            var aFlights = aFlightObjects.map(function (o) {
                return {
                    flightId:    o.PlanItemId,
                    flightTitle: (o.airlineName ? o.airlineName + " " : "") + (o.FlightNumber || ""),
                    airlineName: o.airlineName || "",
                    seat:        o.SeatNumber || sNone,
                    departure:   o.StartsAt ? that._oDateTimeFormat.format(new Date(o.StartsAt)) : "",
                    arrival:     o.EndsAt   ? that._oDateTimeFormat.format(new Date(o.EndsAt))   : "",
                    fromIata:    o.fromIata,
                    fromName:    o.fromName,
                    toIata:      o.toIata,
                    toName:      o.toName
                };
            });
            var oModel = this.getView().getModel("trip");
            oModel.setProperty("/flights", aFlights);
            oModel.setProperty("/flightsBusy", false);
        },

        _applyTrip: function (oTrip) {
            var oModel = this.getView().getModel("trip");
            oModel.setProperty("/trip", oTrip);
            oModel.setProperty("/periodText", formatters.formatPeriod(oTrip.StartsAt, oTrip.EndsAt));
            // voorlopig totaal = budget van deze kopie; _loadSharedTrip overschrijft met de som
            oModel.setProperty("/totalBudget", oTrip.Budget || 0);
        },

        _applyRoute: function (aFlights, mByIata) {
            var that = this;
            var oModel = this.getView().getModel("trip");
            if (!aFlights || !aFlights.length) {
                oModel.setProperty("/route", { has: false });
                return;
            }
            var aSorted = aFlights.slice().sort(function (a, b) {
                return (a.StartsAt || "") < (b.StartsAt || "") ? -1 : 1;
            });
            var mHint = {};
            aSorted.forEach(function (f) {
                if (f.fromIata && !mHint[f.fromIata]) { mHint[f.fromIata] = { name: f.fromName, city: f.fromCity }; }
                if (f.toIata   && !mHint[f.toIata])   { mHint[f.toIata]   = { name: f.toName,   city: f.toCity   }; }
            });
            var aSeq = [];
            aSorted.forEach(function (f) {
                [f.fromIata, f.toIata].forEach(function (sIata) {
                    if (sIata && aSeq[aSeq.length - 1] !== sIata) { aSeq.push(sIata); }
                });
            });
            var aStops = aSeq.map(function (sIata, i) {
                var h = mHint[sIata] || {};
                return { iata: sIata, name: that._airportFacts(sIata, h.name, h.city, mByIata).name, showArrow: i > 0 };
            });
            var mSeen = {};
            var aAirports = [];
            aSeq.forEach(function (sIata) {
                if (mSeen[sIata]) { return; }
                mSeen[sIata] = true;
                var h = mHint[sIata] || {};
                var oFacts = that._airportFacts(sIata, h.name, h.city, mByIata);
                aAirports.push({ iata: sIata, name: oFacts.name, city: oFacts.city });
            });
            oModel.setProperty("/route", { has: true, stops: aStops, airports: aAirports });
        },

        _airportFacts: function (sIata, sFlightName, sFlightCity, mByIata) {
            var oAirport = mByIata[(sIata || "").toUpperCase()];
            var sName = (oAirport && oAirport.Name) || sFlightName || sIata || "";
            var sCity = sFlightCity || "";
            if (oAirport && oAirport.Location && oAirport.Location.City) {
                sCity = oAirport.Location.City.Name + (oAirport.Location.City.CountryRegion ? ", " + oAirport.Location.City.CountryRegion : "");
            }
            return { name: sName, city: sCity };
        },

        // De pagina is identiek vanuit elke kopie: groepeer op ShareId → combineer budgetten,
        // toon elke reiziger met eigen budget + status, en leen vluchten van een kopie die ze
        // wél heeft. Gebruikt dezelfde util + LIVE TripExtensions-map als de All Trips-lijst.
        _loadSharedTrip: function (oTrip, aOwnFlights, mByIata, sUserName, iTripId, iSeq) {
            var that = this;
            var oModel = this.getView().getModel("trip");
            var oComp = this.getOwnerComponent();
            var oExtBinding = oComp.getModel("trips").bindList("/TripExtensions");

            Promise.all([
                oComp.getTripData(),
                oExtBinding.requestContexts(0, 1000)
            ]).then(function (aResults) {
                if (iSeq !== that._iLoadSeq) { return; }
                var aPerPerson = aResults[0];
                var mExt = {};
                aResults[1].forEach(function (oCtx) {
                    var o = oCtx.getObject();
                    mExt[o.personUserName + "|" + o.tripId] = o.approvalStatus;
                });

                var aGroups = tripGroups.groupTrips(aPerPerson, mExt);
                var oGroup = aGroups.find(function (g) {
                    return g.members.some(function (m) {
                        return m.userName === sUserName && String(m.tripId) === String(iTripId);
                    });
                });
                var aMembers = (oGroup ? oGroup.members : []).map(function (m) {
                    return {
                        userName:    m.userName,
                        name:        m.fullName,
                        budget:      m.budget,
                        statusText:  that._statusText(m.statusKey),
                        statusState: STATUS_STATE[m.statusKey] || "None"
                    };
                });
                oModel.setProperty("/members", aMembers);
                oModel.setProperty("/totalBudget", oGroup ? oGroup.totalBudget : (oTrip.Budget || 0));

                // vlucht-borrow: andere kopieën in dezelfde groep (behalve de huidige)
                if (aOwnFlights && aOwnFlights.length) { return; }
                var aOther = (oGroup ? oGroup.members : []).filter(function (m) {
                    return !(m.userName === sUserName && String(m.tripId) === String(iTripId));
                });
                if (!aOther.length) {
                    oModel.setProperty("/flightsBusy", false);
                    return;
                }
                Promise.all(aOther.map(function (m) {
                    return oComp.getCachedFlights(m.userName, m.tripId);
                })).then(function (aFlightResults) {
                    if (iSeq !== that._iLoadSeq) { return; }
                    var aBorrowed = aFlightResults.find(function (a) { return a && a.length; }) || [];
                    that._applyFlights(aBorrowed);
                    that._applyRoute(aBorrowed, mByIata || {});
                    that._loadAirportTripCounts();
                });
            }).catch(function (oError) {
                if (iSeq !== that._iLoadSeq) { return; }
                Log.error("Loading shared trip failed", oError);
                oModel.setProperty("/members", []);
                oModel.setProperty("/flightsBusy", false);
            });
        },

        onCoTravellerPress: function (oEvent) {
            var oCo = oEvent.getSource().getBindingContext("trip").getObject();
            this.getRouter().navTo("employee", { userName: oCo.userName });
        },

        onFromPress: function (oEvent) {
            this._navToAirport(oEvent.getSource().getBindingContext("trip").getObject().fromIata);
        },

        onToPress: function (oEvent) {
            this._navToAirport(oEvent.getSource().getBindingContext("trip").getObject().toIata);
        },

        _navToAirport: function (sIata) {
            if (sIata) { this.getRouter().navTo("airportFocus", { iata: sIata }); }
        },

        onNavBack: function () {
            this.getRouter().navTo("employee", { userName: this._sUserName });
        }
    });
});