sap.ui.define([
    "primepath/dashboard/controller/BaseController"
], function (BaseController) {
    "use strict";

    return BaseController.extend("primepath.dashboard.controller.Launchpad", {

        // klik op een rol-tegel → die rol "spelen". Component.pickRole kiest de juiste actie:
        // lokaal een echte mock-login (loginAs), op BTP (ná XSUAA-login) de UI scopen (actAsRole).
        // Beide zetten de rolcontext én navigeren naar de landingstab van die rol
        // (Coordinator/TeamLead → Employees, HR → Overview).
        onSelectRole: function (oEvent) {
            this.getOwnerComponent().pickRole(oEvent.getSource().data("role"));
        },

        // echte sign-out (alleen BTP): via de approuter uitloggen → dropt de XSUAA-sessie.
        onSignOut: function () {
            this.getOwnerComponent().logout();
        }

    });
});
