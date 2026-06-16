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

    var STATUS_STATE = {
        approved: "Success",
        rejected: "Error",
        pending:  "Warning"
    };

    var STATUS_TEXT = {
        approved: "Goedgekeurd",
        rejected: "Afgekeurd",
        pending:  "In behandeling"
    };

    return BaseController.extend("primepath.dashboard.controller.TripDetail", {

        onInit: function () {
            this._oDateTimeFormat = DateFormat.getDateTimeInstance({ style: "medium" });
            this._iLoadSeq = 0;
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
            var oModel = this.getView().getModel("trip");
            var oComp = this.getOwnerComponent();

            oModel.setData({
                busy: true, personName: this._sUserName, periodText: "",
                trip: {}, ext: {}, flights: [], flightsBusy: false,
                route: { has: false }, coTravellers: []
            });

            var mHeaders = { Accept: "application/json" };
            if (oComp._sAuthHeader) { mHeaders.Authorization = oComp._sAuthHeader; }

            fetch("/trips/OwnTrips(" + this._sTripIdRaw + ")", { headers: mHeaders })
                .then(function (r) {
                    if (!r.ok) { throw new Error("HTTP " + r.status); }
                    return r.json();
                })
                .then(function (oTrip) {
                    var sStatus = oTrip.approvalStatus || "pending";
                    oModel.setProperty("/trip", {
                        Name:        oTrip.name,
                        Budget:      oTrip.budget,
                        Description: oTrip.description || oTrip.destination || ""
                    });
                    oModel.setProperty("/personName", that._sUserName);
                    oModel.setProperty("/periodText", formatters.formatPeriod(oTrip.startsAt, oTrip.endsAt));
                    oModel.setProperty("/ext", {
                        exists:      true,
                        statusText:  STATUS_TEXT[sStatus] || sStatus,
                        statusState: STATUS_STATE[sStatus] || "None"
                    });
                    oModel.setProperty("/busy", false);
                    oModel.setProperty("/flightsBusy", false);
                })
                .catch(function (oError) {
                    Log.error("Loading own trip failed", oError);
                    oModel.setProperty("/busy", false);
                    oModel.setProperty("/flightsBusy", false);
                    MessageToast.show(that.getResourceBundle().getText("tripLoadError"));
                });
        },

        _approveOwnTrip: function () {
            this._patchOwnTripStatus("approved");
        },

        _rejectOwnTrip: function () {
            this._patchOwnTripStatus("rejected");
        },

        _patchOwnTripStatus: function (sStatus) {
            var that = this;
            var oComp = this.getOwnerComponent();
            var mHeaders = { "Content-Type": "application/json", Accept: "application/json" };
            if (oComp._sAuthHeader) { mHeaders.Authorization = oComp._sAuthHeader; }

            fetch("/trips/OwnTrips('" + this._sTripIdRaw + "')", {
                method: "PATCH",
                headers: mHeaders,
                body: JSON.stringify({ approvalStatus: sStatus })
            })
            .then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                MessageToast.show(that.getResourceBundle().getText("approvalActionDone"));
                // cache wissen zodat employee detail ook de nieuwe status ziet
                delete oComp._mTripsCache[that._sUserName];
                that._loadOwnTrip();
            })
            .catch(function (oError) {
                Log.error("Patch own trip status failed", oError);
                MessageToast.show(that.getResourceBundle().getText("approvalActionError"));
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
                ext: {},
                flights: [],
                flightsBusy: true,
                route: { has: false },
                coTravellers: []
            });

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

                var aExt = aResults[1];
                var aOwnFlights = aResults[2];
                var mByIata = aResults[3];
                that._applyTrip(oTrip, aExt.length ? aExt[0].getObject() : null);
                oModel.setProperty("/busy", false);

                if (aOwnFlights && aOwnFlights.length) {
                    that._applyFlights(aOwnFlights);
                    that._applyRoute(aOwnFlights, mByIata);
                    that._loadAirportTripCounts();
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

        _applyTrip: function (oTrip, oExt) {
            var oModel = this.getView().getModel("trip");
            var oBundle = this.getResourceBundle();
            oModel.setProperty("/trip", oTrip);
            oModel.setProperty("/periodText", formatters.formatPeriod(oTrip.StartsAt, oTrip.EndsAt));

            var sStatus = oExt && oExt.approvalStatus;
            oModel.setProperty("/ext", {
                exists:      !!oExt,
                statusText:  sStatus ? (STATUS_TEXT[sStatus] || sStatus) : oBundle.getText("approvalNone"),
                statusState: STATUS_STATE[sStatus] || "None"
            });
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
            var sNone = this.getResourceBundle().getText("valueNone");
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
                aAirports.push({ iata: sIata, name: oFacts.name, city: oFacts.city, coords: oFacts.coords, trips: sNone });
            });
            oModel.setProperty("/route", { has: true, stops: aStops, airports: aAirports });
        },

        _airportFacts: function (sIata, sFlightName, sFlightCity, mByIata) {
            var oAirport = mByIata[(sIata || "").toUpperCase()];
            var sName = (oAirport && oAirport.Name) || sFlightName || sIata || "";
            var sCity = sFlightCity || "";
            var sCoords = "";
            if (oAirport && oAirport.Location) {
                if (oAirport.Location.City) {
                    sCity = oAirport.Location.City.Name + (oAirport.Location.City.CountryRegion ? ", " + oAirport.Location.City.CountryRegion : "");
                }
                var oLoc = oAirport.Location.Loc;
                if (oLoc && oLoc.coordinates) {
                    sCoords = oLoc.coordinates[1].toFixed(4) + ", " + oLoc.coordinates[0].toFixed(4);
                }
            }
            return { name: sName, city: sCity, coords: sCoords };
        },

        _loadAirportTripCounts: function () {
            var oModel = this.getView().getModel("trip");
            if (!oModel.getProperty("/route/has")) { return; }
            this.getOwnerComponent().getFlightAggregate().then(function (oAgg) {
                var mBy = oAgg.byAirport || {};
                var aAirports = oModel.getProperty("/route/airports") || [];
                aAirports.forEach(function (oA) {
                    oA.trips = mBy[oA.iata] ? String(mBy[oA.iata].trips.length) : "0";
                });
                oModel.setProperty("/route/airports", aAirports);
            }).catch(function (oError) {
                Log.error("Loading airport trip counts failed", oError);
            });
        },

        _loadSharedTrip: function (oTrip, aOwnFlights, mByIata, sUserName, iTripId, iSeq) {
            var that = this;
            var oModel = this.getView().getModel("trip");
            var sShareId = oTrip.ShareId;
            this.getOwnerComponent().getTripData().then(function (aPerPerson) {
                if (iSeq !== that._iLoadSeq) { return; }
                var mSeen = {};
                var aCo = [];
                var aPairs = [];
                aPerPerson.forEach(function (oEntry) {
                    oEntry.trips.forEach(function (oT) {
                        if (oT._isOwn) { return; }
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
                if (aOwnFlights && aOwnFlights.length) { return; }
                var aOther = aPairs.filter(function (p) {
                    return !(p.user === sUserName && p.tripId === iTripId);
                });
                if (!aOther.length) {
                    oModel.setProperty("/flightsBusy", false);
                    return;
                }
                Promise.all(aOther.map(function (p) {
                    return that.getOwnerComponent().getCachedFlights(p.user, p.tripId);
                })).then(function (aResults) {
                    if (iSeq !== that._iLoadSeq) { return; }
                    var aBorrowed = aResults.find(function (a) { return a && a.length; }) || [];
                    that._applyFlights(aBorrowed);
                    that._applyRoute(aBorrowed, mByIata || {});
                    that._loadAirportTripCounts();
                });
            }).catch(function (oError) {
                if (iSeq !== that._iLoadSeq) { return; }
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

        _navToAirport: function (sIata) {
            if (sIata) { this.getRouter().navTo("airportFocus", { iata: sIata }); }
        },

        onNavBack: function () {
            this.getRouter().navTo("employee", { userName: this._sUserName });
        },

        onApprove: function () {
            if (this._bIsOwn) {
                this._patchOwnTripStatus("approved");
            } else {
                this._invokeExtAction("approve");
            }
        },

        onReject: function () {
            if (this._bIsOwn) {
                this._patchOwnTripStatus("rejected");
            } else {
                this._invokeExtAction("rejectTrip");
            }
        },

        onSubmitApproval: function () {
            var that = this;
            var oBundle = this.getResourceBundle();
            MessageBox.confirm(oBundle.getText("approvalConfirm"), {
                title: oBundle.getText("btnSubmit"),
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
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

        _patchOwnTripStatus: function (sStatus) {
            var that = this;
            var oComp = this.getOwnerComponent();
            var mHeaders = { "Content-Type": "application/json", Accept: "application/json" };
            if (oComp._sAuthHeader) { mHeaders.Authorization = oComp._sAuthHeader; }

            fetch("/trips/OwnTrips('" + this._sTripIdRaw + "')", {
                method: "PATCH",
                headers: mHeaders,
                body: JSON.stringify({ approvalStatus: sStatus })
            })
            .then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                MessageToast.show(that.getResourceBundle().getText("approvalActionDone"));
                delete oComp._mTripsCache[that._sUserName];
                that._loadOwnTrip();
            })
            .catch(function (oError) {
                Log.error("Patch own trip status failed", oError);
                MessageToast.show(that.getResourceBundle().getText("approvalActionError"));
            });
        },

        _extPath: function () {
            var sUser = "'" + String(this._sUserName).replace(/'/g, "''") + "'";
            return "/TripExtensions(personUserName=" + sUser + ",tripId=" + this._iTripId + ")";
        }
    });
});