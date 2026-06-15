sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/base/Log"
], function (Controller, JSONModel, Log) {
    "use strict";

    return Controller.extend("primepath.dashboard.controller.Employees", {

        onInit: function () {
            this._aAllPeople = [];
            this.getView().setModel(new JSONModel({ people: [], count: 0 }), "view");
            this._loadPeople();
        },

        _loadPeople: function () {
            var that = this;
            this.getOwnerComponent().getCachedList("people", "/People").then(function (aPeople) {
                // kopie vóór sort — nooit de gedeelde cache-array in place sorteren
                that._aAllPeople = aPeople.slice().sort(function (a, b) {
                    var sA = (a.LastName || "") + (a.FirstName || "");
                    var sB = (b.LastName || "") + (b.FirstName || "");
                    return sA < sB ? -1 : 1;
                });
                that._applySearch();
            }).catch(function (oError) {
                Log.error("Loading employees failed", oError);
            });
        },

        onSearch: function () {
            this._applySearch();
        },

        // Client-side filteren omdat de backend $filter nog negeert (backend issue 2).
        // Zodra de backend $filter honoreert: terug naar een server-side
        // binding.filter() op {people>/People}.
        _applySearch: function () {
            var sQuery = (this.byId("searchField").getValue() || "").toLowerCase().trim();
            var aPeople = this._aAllPeople;
            if (sQuery) {
                aPeople = aPeople.filter(function (oPerson) {
                    return [oPerson.FirstName, oPerson.LastName, oPerson.UserName]
                        .some(function (sField) {
                            return (sField || "").toLowerCase().indexOf(sQuery) !== -1;
                        });
                });
            }
            var oViewModel = this.getView().getModel("view");
            oViewModel.setProperty("/people", aPeople);
            oViewModel.setProperty("/count", aPeople.length);
        },

        onEmployeePress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("view");
            this.getOwnerComponent().getRouter().navTo("employee", {
                userName: oContext.getProperty("UserName")
            });
        },

        formatEmails: function (aEmails) {
            return Array.isArray(aEmails) ? aEmails.join(", ") : "";
        }

    });
});
