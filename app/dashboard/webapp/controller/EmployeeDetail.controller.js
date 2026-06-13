sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Controller, JSONModel, Filter, FilterOperator) {
    "use strict";

    return Controller.extend("primepath.dashboard.controller.EmployeeDetail", {

        onInit: function () {
            this.getOwnerComponent().getRouter().getRoute("employee")
                .attachPatternMatched(this.onPatternMatched, this);
        },

        onPatternMatched: function (oEvent) {
            var sUserName = oEvent.getParameter("arguments").userName;
            this._sUserName = sUserName;

            // Laad employee details
            this.getView().bindElement({
                path: "people>/People('" + encodeURIComponent(sUserName) + "')"
            });

            // Laad trips voor deze persoon
            this._loadTrips(sUserName);
        },

        _loadTrips: function (sUserName) {
            var oView = this.getView();
            var oTripsModel = this.getOwnerComponent().getModel("trips");

            oTripsModel.bindList("/PersonTrips", null, null, [
                new Filter("personUserName", FilterOperator.EQ, sUserName)
            ]).requestContexts().then(function (aContexts) {
                var aTrips = aContexts.map(function (oCtx) {
                    return oCtx.getObject();
                });
                var oModel = new JSONModel({ trips: aTrips });
                oView.setModel(oModel, "tripData");
            });
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("employees");
        },

        formatEmails: function (aEmails) {
            return Array.isArray(aEmails) ? aEmails.join(", ") : "";
        },

        formatDate: function (sDate) {
            if (!sDate) return "";
            return new Date(sDate).toLocaleDateString("nl-BE");
        }
    });
});