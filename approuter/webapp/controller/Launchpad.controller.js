sap.ui.define([
    "primepath/dashboard/controller/BaseController"
], function (BaseController) {
    "use strict";

    return BaseController.extend("primepath.dashboard.controller.Launchpad", {

        // klik op een rol-tegel (alleen lokaal: rol-switcher voor dev/demo) → echte login als die
        // rol; Component.loginAs zet de OData-auth + rolcontext én navigeert naar de landingstab
        // (Coordinator/TeamLead → Employees, HR → Overview).
        onSelectRole: function (oEvent) {
            this.getOwnerComponent().loginAs(oEvent.getSource().data("role"));
        },

        // BTP "Sign in"-tegel: de rol komt van XSUAA (niet te kiezen), dus dit triggert enkel de
        // login via de beveiligde /secure-route; ná login bepaalt de échte rol tabs + scope.
        onSignIn: function () {
            this.getOwnerComponent().enterApp();
        }

    });
});
