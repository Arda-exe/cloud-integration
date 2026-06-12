sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";

    return Controller.extend("primepath.dashboard.controller.App", {

        onInit: function () {
            // route names en tab keys zijn identiek (overview/employees/airports),
            // dus de route-naam kan rechtstreeks als selectedKey dienen
            this.getOwnerComponent().getRouter()
                .attachRouteMatched(this.onRouteMatched, this);
        },

        onRouteMatched: function (oEvent) {
            this.byId("tabHeader").setSelectedKey(oEvent.getParameter("name"));
        },

        onTabSelect: function (oEvent) {
            this.getOwnerComponent().getRouter()
                .navTo(oEvent.getParameter("key"));
        }

    });
});
