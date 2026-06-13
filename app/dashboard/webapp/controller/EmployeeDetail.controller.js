sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";

    return Controller.extend("primepath.dashboard.controller.EmployeeDetail", {

        onInit: function () {
            this.getOwnerComponent().getRouter().getRoute("employee")
                .attachPatternMatched(this.onPatternMatched, this);
        },

        onPatternMatched: function (oEvent) {
            var sUserName = oEvent.getParameter("arguments").userName;
            this.getView().bindElement({
                path: "people>/People('" + encodeURIComponent(sUserName) + "')"
            });
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("employees");
        },

        formatEmails: function (aEmails) {
            return Array.isArray(aEmails) ? aEmails.join(", ") : "";
        }

    });
});
