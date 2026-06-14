sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
    "use strict";

    return UIComponent.extend("primepath.dashboard.Component", {
        metadata: {
            manifest: "json",
            interfaces: ["sap.ui.core.IAsyncContentCreation"]
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);

            // app-brede gebruikerscontext voor rol-gating (feature 8): tot whoami
            // antwoordt is niemand coordinator, dus coordinator-only UI blijft verborgen
            this.setModel(new JSONModel({
                user: { id: "", roles: [], isCoordinator: false }
            }), "app");
            this._loadCurrentUser();

            this.getRouter().initialize();
        },

        // Haalt de rollen op via het (geïsoleerde) /user/whoami() endpoint. Same-origin,
        // werkt lokaal (cds watch) en via de BTP approuter.
        _loadCurrentUser: function () {
            var oModel = this.getModel("app");
            fetch("/user/whoami()", { headers: { Accept: "application/json" } })
                .then(function (oResponse) {
                    return oResponse.ok ? oResponse.json() : null;
                })
                .then(function (oJson) {
                    if (!oJson) {
                        return;
                    }
                    var oData = oJson.value || oJson;
                    var aRoles = oData.roles || [];
                    oModel.setProperty("/user/id", oData.id || "");
                    oModel.setProperty("/user/roles", aRoles);
                    oModel.setProperty("/user/isCoordinator", aRoles.indexOf("TravelCoordinator") !== -1);
                })
                .catch(function () {
                    // geen gebruiker / endpoint niet beschikbaar → geen coordinator-UI
                });
        }
    });
});
