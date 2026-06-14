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
            var sRoute = oEvent.getParameter("name");
            // detail routes horen bij de tab van hun lijst
            var mRouteToTab = { employee: "employees", trip: "employees" };
            this.byId("tabHeader").setSelectedKey(mRouteToTab[sRoute] || sRoute);
        },

        onTabSelect: function (oEvent) {
            this.getOwnerComponent().getRouter()
                .navTo(oEvent.getParameter("key"));
        }

    });
});
