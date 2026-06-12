sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Controller, Filter, FilterOperator) {
    "use strict";

    return Controller.extend("primepath.dashboard.controller.Employees", {

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue").trim();
            var aFilters = [];

            if (sQuery) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("FirstName", FilterOperator.Contains, sQuery),
                        new Filter("LastName", FilterOperator.Contains, sQuery),
                        new Filter("UserName", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }

            this.byId("employeesTable").getBinding("items").filter(aFilters);
        },

        onEmployeePress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("people");
            this.getOwnerComponent().getRouter().navTo("employee", {
                userName: oContext.getProperty("UserName")
            });
        },

        formatEmails: function (aEmails) {
            return Array.isArray(aEmails) ? aEmails.join(", ") : "";
        }

    });
});
