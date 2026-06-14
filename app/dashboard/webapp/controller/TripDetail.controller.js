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
            this.getView().setModel(new JSONModel({
                busy: false,
                personName: "",
                periodText: "",
                trip: {},
                tags: [],
                ext: {}
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
            var oTripsModel = this.getOwnerComponent().getModel("trips");
            oModel.setData({
                busy: true,
                personName: this._sUserName,
                periodText: "",
                trip: {},
                tags: [],
                ext: {}
            });

            // 1) Trip ophalen via PersonTrips (zelfde patroon als EmployeeDetail) en
            //    client-side de juiste TripId kiezen — een keyed trip-read geeft de
            //    verkeerde rij terug (backend issue 2).
            var oTripsBinding = oTripsModel.bindList("/PersonTrips", undefined, undefined,
                [new Filter("personUserName", FilterOperator.EQ, this._sUserName)]);

            // 2) Extension (approval/company/team/notes) los ophalen met een filter op de
            //    samengestelde sleutel; geen keyed read → geen 404-ruis als er (nog) geen
            //    rij is. Expliciete $select want autoExpandSelect ziet geen OData-bindings
            //    (we lezen via getObject() naar een JSON-model).
            var oExtBinding = oTripsModel.bindList("/TripExtensions", undefined, undefined, [
                new Filter("personUserName", FilterOperator.EQ, this._sUserName),
                new Filter("tripId", FilterOperator.EQ, this._iTripId)
            ], { $select: "tripId,personUserName,approvalStatus,company,team,notes" });

            Promise.all([
                oTripsBinding.requestContexts(0, 100),
                oExtBinding.requestContexts(0, 1)
            ]).then(function (aResults) {
                var oTrip = aResults[0]
                    .map(function (oContext) { return oContext.getObject(); })
                    .find(function (oCandidate) { return oCandidate.TripId === that._iTripId; });

                if (!oTrip) {
                    oModel.setProperty("/busy", false);
                    MessageToast.show(that._bundle().getText("tripLoadError"));
                    return;
                }

                var aExt = aResults[1];
                that._applyTrip(oTrip, aExt.length ? aExt[0].getObject() : null);
                oModel.setProperty("/busy", false);
            }).catch(function (oError) {
                Log.error("Loading trip detail failed", oError);
                oModel.setProperty("/busy", false);
                MessageToast.show(that._bundle().getText("tripLoadError"));
            });
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
                statusText: sStatus || oBundle.getText("approvalNone"),
                statusState: STATUS_STATE[sStatus] || "None",
                company: (oExt && oExt.company) || sNone,
                team: (oExt && oExt.team) || sNone,
                notes: (oExt && oExt.notes) || sNone
            });
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("employee", {
                userName: this._sUserName
            });
        },

        _bundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        }

    });
});
