sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
    "use strict";

    return Controller.extend("primepath.dashboard.controller.EmployeeDetail", {

        onInit: function () {
            this.getOwnerComponent().getRouter().getRoute("employee")
                .attachPatternMatched(this.onPatternMatched, this);
        },

        onPatternMatched: function (oEvent) {
            var sUserName = oEvent.getParameter("arguments").userName;
            var oView = this.getView();

            // Reset binding eerst zodat oude data weg is
            oView.unbindElement("people");

            // Dan nieuwe binding zetten
            oView.bindElement({
                path: "people>/People('" + encodeURIComponent(sUserName) + "')",
                parameters: { $select: "UserName,FirstName,LastName,Emails" }
            });

            this._loadTrips(sUserName);
        },

        _loadTrips: function (sUserName) {
            var oView = this.getView();
            fetch("/trips/PersonTrips?$filter=personUserName eq '" + sUserName + "'")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    oView.setModel(new JSONModel({ trips: data.value ?? [] }), "tripData");
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