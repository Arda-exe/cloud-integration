sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/format/DateFormat",
    "sap/m/MessageToast",
    "sap/base/Log"
], function (Controller, JSONModel, Filter, FilterOperator, DateFormat, MessageToast, Log) {
    "use strict";

    // approvalStatus → sap.ui.core.ValueState voor de gekleurde ObjectStatus
    var STATUS_STATE = {
        approved: "Success",
        rejected: "Error",
        pending: "Warning"
    };

    return Controller.extend("primepath.dashboard.controller.TripDetail", {

        onInit: function () {
            this._oDateFormat = DateFormat.getDateInstance({ style: "medium" });
            this._oDateTimeFormat = DateFormat.getDateTimeInstance({ style: "medium" });
            this.getView().setModel(new JSONModel({
                busy: false,
                personName: "",
                periodText: "",
                trip: {},
                tags: [],
                ext: {},
                flights: [],
                flightsBusy: false
            }), "trip");
            this.getOwnerComponent().getRouter().getRoute("trip")
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
                tags: [],
                ext: {},
                flights: [],
                flightsBusy: true
            });

            // Trips en vluchten uit de app-brede cache (gedeeld met Overview /
            // EmployeeDetail); de juiste trip wordt client-side op TripId gekozen.
            // TripExtensions is schrijfbaar → NIET cachen, altijd live lezen met een
            // filter op de samengestelde sleutel (geen keyed read → geen 404-ruis als er
            // nog geen rij is), zodat approve/reject/submit meteen zichtbaar is na _load().
            var oExtBinding = oTripsModel.bindList("/TripExtensions", undefined, undefined, [
                new Filter("personUserName", FilterOperator.EQ, this._sUserName),
                new Filter("tripId", FilterOperator.EQ, this._iTripId)
            ], { $select: "tripId,personUserName,approvalStatus,company,team,notes" });

            Promise.all([
                oComponent.getCachedTrips(this._sUserName),
                oExtBinding.requestContexts(0, 1),
                oComponent.getCachedFlights(this._sUserName, this._iTripId)
            ]).then(function (aResults) {
                var oTrip = aResults[0].find(function (oCandidate) {
                    return oCandidate.TripId === that._iTripId;
                });

                if (!oTrip) {
                    oModel.setProperty("/busy", false);
                    oModel.setProperty("/flightsBusy", false);
                    MessageToast.show(that._bundle().getText("tripLoadError"));
                    return;
                }

                var aExt = aResults[1];
                that._applyTrip(oTrip, aExt.length ? aExt[0].getObject() : null);
                that._applyFlights(aResults[2]);
                oModel.setProperty("/busy", false);
            }).catch(function (oError) {
                Log.error("Loading trip detail failed", oError);
                oModel.setProperty("/busy", false);
                oModel.setProperty("/flightsBusy", false);
                MessageToast.show(that._bundle().getText("tripLoadError"));
            });
        },

        _applyFlights: function (aFlightObjects) {
            var that = this;
            var sNone = this._bundle().getText("valueNone");
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
            var oBundle = this._bundle();
            var sNone = oBundle.getText("valueNone");

            oModel.setProperty("/trip", oTrip);
            oModel.setProperty("/periodText",
                this._oDateFormat.format(new Date(oTrip.StartsAt)) + " – "
                + this._oDateFormat.format(new Date(oTrip.EndsAt)));
            oModel.setProperty("/tags", (oTrip.Tags || []).map(function (sTag) {
                return { name: sTag };
            }));

            var sStatus = oExt && oExt.approvalStatus;
            oModel.setProperty("/ext", {
                exists: !!oExt,
                statusText: sStatus || oBundle.getText("approvalNone"),
                statusState: STATUS_STATE[sStatus] || "None",
                company: (oExt && oExt.company) || sNone,
                team: (oExt && oExt.team) || sNone,
                notes: (oExt && oExt.notes) || sNone
            });
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
                this.getOwnerComponent().getRouter().navTo("airportFocus", { iata: sIata });
            }
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("employee", {
                userName: this._sUserName
            });
        },

        // ---- Feature 8: approval record (coordinator-only) -----------------

        // Submit = nieuw TripExtension aanmaken (status default 'pending'). Knop is
        // uitgeschakeld zodra er al een record bestaat (samengestelde sleutel → geen
        // dubbele create).
        onOpenApprovalForm: function () {
            var that = this;
            var fnOpen = function () {
                that.byId("approvalCompany").setValue("");
                that.byId("approvalTeam").setValue("");
                that.byId("approvalNotes").setValue("");
                that._oApprovalDialog.open();
            };
            if (this._oApprovalDialog) {
                fnOpen();
                return;
            }
            this.loadFragment({ name: "primepath.dashboard.view.ApprovalForm" }).then(function (oDialog) {
                that._oApprovalDialog = oDialog;
                fnOpen();
            });
        },

        onSubmitApproval: function () {
            var that = this;
            var oModel = this.getOwnerComponent().getModel("trips");
            var oListBinding = oModel.bindList("/TripExtensions");
            var oNewContext = oListBinding.create({
                personUserName: this._sUserName,
                tripId: this._iTripId,
                company: this.byId("approvalCompany").getValue(),
                team: this.byId("approvalTeam").getValue(),
                notes: this.byId("approvalNotes").getValue()
            });
            oNewContext.created().then(function () {
                MessageToast.show(that._bundle().getText("approvalSubmitted"));
                that._oApprovalDialog.close();
                that._load();
            }).catch(function (oError) {
                Log.error("Submitting approval record failed", oError);
                MessageToast.show(that._bundle().getText("approvalSubmitError"));
            });
        },

        onCancelApproval: function () {
            this._oApprovalDialog.close();
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
                MessageToast.show(that._bundle().getText("approvalActionDone"));
                that._load();
            }).catch(function (oError) {
                Log.error("Action " + sAction + " failed", oError);
                MessageToast.show(that._bundle().getText("approvalActionError"));
            });
        },

        // sleutelpad voor TripExtensions: String-sleutel tussen quotes (' → ''),
        // Integer-sleutel kaal
        _extPath: function () {
            var sUser = "'" + String(this._sUserName).replace(/'/g, "''") + "'";
            return "/TripExtensions(personUserName=" + sUser + ",tripId=" + this._iTripId + ")";
        },

        onExit: function () {
            if (this._oApprovalDialog) {
                this._oApprovalDialog.destroy();
                this._oApprovalDialog = null;
            }
        },

        _bundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        }

    });
});
