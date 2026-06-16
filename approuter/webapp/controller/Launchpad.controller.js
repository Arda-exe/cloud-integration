sap.ui.define([
    "primepath/dashboard/controller/BaseController"
], function (BaseController) {
    "use strict";

    return BaseController.extend("primepath.dashboard.controller.Launchpad", {

        // klik op een rol-tegel → echte login als die rol; Component.loginAs zet de OData-auth
        // + rolcontext én navigeert naar de landingstab (Coordinator/TeamLead → Employees,
        // HR → Overview).
        onSelectRole: function (oEvent) {
            this.getOwnerComponent().loginAs(oEvent.getSource().data("role"));
        }

    });
});
