sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/format/DateFormat",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/base/Log",
    "primepath/dashboard/util/formatters"
], function (BaseController, JSONModel, Filter, FilterOperator, DateFormat, MessageToast, MessageBox, Log, formatters) {
    "use strict";

    // approvalStatus → sap.ui.core.ValueState voor de gekleurde ObjectStatus
    var STATUS_STATE = {
        approved: "Success",
        rejected: "Error",
        pending: "Warning"
    };

    return BaseController.extend("primepath.dashboard.controller.TripDetail", {

        onInit: function () {
            this._oDateTimeFormat = DateFormat.getDateTimeInstance({ style: "medium" });
            this.getView().setModel(new JSONModel({
                busy: false,
                personName: "",
                periodText: "",
                trip: {},
                ext: {},
                flights: [],
                flightsBusy: false,
                route: { has: false },
                coTravellers: []
            }), "trip");
            this.getRouter().getRoute("trip")
                .attachPatternMatched(this.onPatternMatched, this);
        },

        onPatternMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            this._sUserName = oArgs.userName;
            this._iTripId = parseInt(oArgs.tripId, 10);
            this._load();
        },

        _load: function () {
            var that = this;
            var oModel = this.getView().getModel("trip");
            var oComponent = this.getOwnerComponent();
            var oTripsModel = oComponent.getModel("trips");
            oModel.setData({
                busy: true,
                personName: this._sUserName,
                periodText: "",
                trip: {},
                ext: {},
                flights: [],
                flightsBusy: true,
                route: { has: false },
                coTravellers: []
            });

            // Trips en vluchten uit de app-brede cache (gedeeld met Overview /
            // EmployeeDetail); de juiste trip wordt client-side op TripId gekozen.
            // TripExtensions is schrijfbaar → NIET cachen, altijd live lezen met een
            // filter op de samengestelde sleutel (geen keyed read → geen 404-ruis als er
            // nog geen rij is), zodat approve/reject/submit meteen zichtbaar is na _load().
            var oExtBinding = oTripsModel.bindList("/TripExtensions", undefined, undefined, [
                new Filter("personUserName", FilterOperator.EQ, this._sUserName),
                new Filter("tripId", FilterOperator.EQ, this._iTripId)
            ], { $select: "tripId,personUserName,approvalStatus" });

            Promise.all([
                oComponent.getCachedTrips(this._sUserName),
                oExtBinding.requestContexts(0, 1),
                oComponent.getCachedFlights(this._sUserName, this._iTripId),
                oComponent.getAirportsByIata().catch(function () { return {}; })
            ]).then(function (aResults) {
                var oTrip = aResults[0].find(function (oCandidate) {
                    return oCandidate.TripId === that._iTripId;
                });

                if (!oTrip) {
                    oModel.setProperty("/busy", false);
                    oModel.setProperty("/flightsBusy", false);
                    MessageToast.show(that.getResourceBundle().getText("tripLoadError"));
                    return;
                }

                var aExt = aResults[1];
                var aOwnFlights = aResults[2];
                var mByIata = aResults[3];
                that._applyTrip(oTrip, aExt.length ? aExt[0].getObject() : null);
                oModel.setProperty("/busy", false);

                // eigen vluchten meteen tonen; een lege kopie van een gedeelde trip wordt in
                // _loadSharedTrip aangevuld vanaf een mede-reiziger (flightsBusy blijft tot dan)
                if (aOwnFlights && aOwnFlights.length) {
                    that._applyFlights(aOwnFlights);
                    that._applyRoute(aOwnFlights, mByIata);
                    that._loadAirportTripCounts();
                }
                that._loadSharedTrip(oTrip, aOwnFlights, mByIata);
            }).catch(function (oError) {
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
                    flightId: o.PlanItemId,
                    flightTitle: (o.airlineName ? o.airlineName + " " : "") + (o.FlightNumber || ""),
                    airlineName: o.airlineName || "",
                    seat: o.SeatNumber || sNone,
                    departure: o.StartsAt ? that._oDateTimeFormat.format(new Date(o.StartsAt)) : "",
                    arrival: o.EndsAt ? that._oDateTimeFormat.format(new Date(o.EndsAt)) : "",
                    fromIata: o.fromIata,
                    fromName: o.fromName,
                    toIata: o.toIata,
                    toName: o.toName
                };
            });
            var oModel = this.getView().getModel("trip");
            oModel.setProperty("/flights", aFlights);
            oModel.setProperty("/flightsBusy", false);
        },

        _applyTrip: function (oTrip, oExt) {
            var oModel = this.getView().getModel("trip");
            var oBundle = this.getResourceBundle();

            oModel.setProperty("/trip", oTrip);
            oModel.setProperty("/periodText", formatters.formatPeriod(oTrip.StartsAt, oTrip.EndsAt));

            var sStatus = oExt && oExt.approvalStatus;
            oModel.setProperty("/ext", {
                exists: !!oExt,
                statusText: sStatus || oBundle.getText("approvalNone"),
                statusState: STATUS_STATE[sStatus] || "None"
            });
        },

        // visuele route (eerste vertrek → laatste aankomst) + airport-facts uit de IATA-index
        _applyRoute: function (aFlights, mByIata) {
            var oModel = this.getView().getModel("trip");
            if (!aFlights || !aFlights.length) {
                oModel.setProperty("/route", { has: false });
                return;
            }
            var aSorted = aFlights.slice().sort(function (a, b) {
                return (a.StartsAt || "") < (b.StartsAt || "") ? -1 : 1;
            });
            var oFirst = aSorted[0];
            var oLast = aSorted[aSorted.length - 1];
            var sNone = this.getResourceBundle().getText("valueNone");
            var oFrom = this._airportFacts(oFirst.fromIata, oFirst.fromName, oFirst.fromCity, mByIata);
            var oTo = this._airportFacts(oLast.toIata, oLast.toName, oLast.toCity, mByIata);
            oModel.setProperty("/route", {
                has: true,
                fromIata: oFirst.fromIata || "",
                fromName: oFrom.name,
                fromCity: oFrom.city,
                fromCoords: oFrom.coords,
                fromTrips: sNone,
                toIata: oLast.toIata || "",
                toName: oTo.name,
                toCity: oTo.city,
                toCoords: oTo.coords,
                toTrips: sNone
            });
        },

        // airport-naam/stad/coördinaten uit het airport-object (IATA-index); valt terug op
        // de velden van de vlucht als de luchthaven niet in de lijst zit
        _airportFacts: function (sIata, sFlightName, sFlightCity, mByIata) {
            var oAirport = mByIata[(sIata || "").toUpperCase()];
            var sName = (oAirport && oAirport.Name) || sFlightName || sIata || "";
            var sCity = sFlightCity || "";
            var sCoords = "";
            if (oAirport && oAirport.Location) {
                if (oAirport.Location.City) {
                    sCity = oAirport.Location.City.Name
                        + (oAirport.Location.City.CountryRegion
                            ? ", " + oAirport.Location.City.CountryRegion : "");
                }
                var oLoc = oAirport.Location.Loc;
                if (oLoc && oLoc.coordinates) {
                    // GeoJSON [lon, lat] → toon "lat, lon"
                    sCoords = oLoc.coordinates[1].toFixed(4) + ", " + oLoc.coordinates[0].toFixed(4);
                }
            }
            return { name: sName, city: sCity, coords: sCoords };
        },

        // "trips via deze luchthaven" komt uit het zware all-time aggregaat → progressief,
        // zodat de route + airport-facts meteen renderen
        _loadAirportTripCounts: function () {
            var that = this;
            var oModel = this.getView().getModel("trip");
            if (!oModel.getProperty("/route/has")) {
                return;
            }
            this.getOwnerComponent().getFlightAggregate().then(function (oAgg) {
                var mBy = oAgg.byAirport || {};
                var sFrom = oModel.getProperty("/route/fromIata");
                var sTo = oModel.getProperty("/route/toIata");
                oModel.setProperty("/route/fromTrips", mBy[sFrom] ? String(mBy[sFrom].trips.length) : "0");
                oModel.setProperty("/route/toTrips", mBy[sTo] ? String(mBy[sTo].trips.length) : "0");
            }).catch(function (oError) {
                Log.error("Loading airport trip counts failed", oError);
            });
        },

        // Gedeelde trip (zelfde ShareId): toon ALLE reizigers (incl. de huidige) en, als de
        // eigen kopie geen vluchten heeft, leen de vluchten van een mede-reiziger die ze wél
        // heeft — zodat elke kopie dezelfde route/luchthavens toont (TripPin vult PlanItems
        // niet op elke kopie van een gedeelde trip).
        _loadSharedTrip: function (oTrip, aOwnFlights, mByIata) {
            var that = this;
            var oModel = this.getView().getModel("trip");
            var sShareId = oTrip.ShareId;
            this.getOwnerComponent().getTripData().then(function (aPerPerson) {
                var mSeen = {};
                var aCo = [];
                var aPairs = [];
                aPerPerson.forEach(function (oEntry) {
                    oEntry.trips.forEach(function (oT) {
                        if (sShareId && oT.ShareId === sShareId) {
                            aPairs.push({ user: oEntry.person.UserName, tripId: oT.TripId });
                            if (!mSeen[oEntry.person.UserName]) {
                                mSeen[oEntry.person.UserName] = true;
                                aCo.push({
                                    userName: oEntry.person.UserName,
                                    name: (oEntry.person.FirstName || "") + " " + (oEntry.person.LastName || "")
                                });
                            }
                        }
                    });
                });
                oModel.setProperty("/coTravellers", aCo);

                // eigen vluchten al getoond → klaar
                if (aOwnFlights && aOwnFlights.length) {
                    return;
                }
                // leen de vluchten van een andere kopie van dezelfde trip
                var aOther = aPairs.filter(function (p) {
                    return !(p.user === that._sUserName && p.tripId === that._iTripId);
                });
                if (!aOther.length) {
                    oModel.setProperty("/flightsBusy", false);
                    return;
                }
                Promise.all(aOther.map(function (p) {
                    return that.getOwnerComponent().getCachedFlights(p.user, p.tripId);
                })).then(function (aResults) {
                    var aBorrowed = aResults.find(function (a) { return a && a.length; }) || [];
                    that._applyFlights(aBorrowed);
                    that._applyRoute(aBorrowed, mByIata || {});
                    that._loadAirportTripCounts();
                });
            }).catch(function (oError) {
                Log.error("Loading shared trip failed", oError);
                oModel.setProperty("/coTravellers", []);
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

        // cross-navigatie vlucht → luchthaven: open de Airports-tab en zoom in (op IATA)
        _navToAirport: function (sIata) {
            if (sIata) {
                this.getRouter().navTo("airportFocus", { iata: sIata });
            }
        },

        onNavBack: function () {
            this.getRouter().navTo("employee", {
                userName: this._sUserName
            });
        },

        // ---- Feature 8: approval record (coordinator-only) -----------------

        // Submit = nieuw TripExtension aanmaken (status default 'pending'). Geen velden meer
        // (company/team horen bij de employee, notes is geschrapt) → een eenvoudige bevestiging.
        // Knop is uit zodra er al een record bestaat (samengestelde sleutel → geen dubbele create).
        onSubmitApproval: function () {
            var that = this;
            var oBundle = this.getResourceBundle();
            MessageBox.confirm(oBundle.getText("approvalConfirm"), {
                title: oBundle.getText("btnSubmit"),
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) {
                        return;
                    }
                    that.getOwnerComponent().getModel("trips")
                        .bindList("/TripExtensions")
                        .create({ personUserName: that._sUserName, tripId: that._iTripId })
                        .created().then(function () {
                            MessageToast.show(oBundle.getText("approvalSubmitted"));
                            that._load();
                        }).catch(function (oError) {
                            Log.error("Submitting approval record failed", oError);
                            MessageToast.show(oBundle.getText("approvalSubmitError"));
                        });
                }
            });
        },

        onApprove: function () {
            this._invokeExtAction("approve");
        },

        onReject: function () {
            this._invokeExtAction("rejectTrip");
        },

        // Bound action op TripExtensions; FQN = TripsService.<actie> (zie EDMX).
        _invokeExtAction: function (sAction) {
            var that = this;
            var oModel = this.getOwnerComponent().getModel("trips");
            var oEntityContext = oModel.bindContext(this._extPath()).getBoundContext();
            var oOperation = oModel.bindContext("TripsService." + sAction + "(...)", oEntityContext);
            return oOperation.execute().then(function () {
                MessageToast.show(that.getResourceBundle().getText("approvalActionDone"));
                that._load();
            }).catch(function (oError) {
                Log.error("Action " + sAction + " failed", oError);
                MessageToast.show(that.getResourceBundle().getText("approvalActionError"));
            });
        },

        // sleutelpad voor TripExtensions: String-sleutel tussen quotes (' → ''),
        // Integer-sleutel kaal
        _extPath: function () {
            var sUser = "'" + String(this._sUserName).replace(/'/g, "''") + "'";
            return "/TripExtensions(personUserName=" + sUser + ",tripId=" + this._iTripId + ")";
        }

    });
});
