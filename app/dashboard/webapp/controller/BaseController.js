sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";

    // Gemeenschappelijke basis voor alle controllers: bundelt de twee chains die overal
    // herhaald werden (router + i18n-bundle), zodat de afgeleide controllers korter blijven.
    return Controller.extend("primepath.dashboard.controller.BaseController", {

        getRouter: function () {
            return this.getOwnerComponent().getRouter();
        },

        getResourceBundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        }
    });
});
