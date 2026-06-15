sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (Controller, Fragment, JSONModel, MessageToast) {
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
            var mRouteToTab = { employee: "employees", trip: "employees", airportFocus: "airports" };
            this.byId("tabHeader").setSelectedKey(mRouteToTab[sRoute] || sRoute);
        },

        onTabSelect: function (oEvent) {
            this.getOwnerComponent().getRouter()
                .navTo(oEvent.getParameter("key"));
        },

        // ---- Global search (feature 7) -------------------------------------

        // Hergebruikt de app-brede Component-cache → de zoekfunctie deelt de datasets
        // met Overview/Employees/Airports (geen extra requests).
        _ensureSearchData: function () {
            var oComponent = this.getOwnerComponent();
            return Promise.all([
                oComponent.getCachedList("people", "/People"),
                oComponent.getCachedList("airports", "/Airports"),
                oComponent.getCachedList("airlines", "/Airlines")
            ]).then(function (aResults) {
                return { people: aResults[0], airports: aResults[1], airlines: aResults[2] };
            });
        },

        onGlobalSearch: function (oEvent) {
            var that = this;
            var sQuery = (oEvent.getParameter("query") || "").toLowerCase().trim();
            if (!sQuery) {
                return;
            }
            this._ensureSearchData().then(function (oData) {
                var fnMatch = function (aFields) {
                    return aFields.some(function (sField) {
                        return (sField || "").toLowerCase().indexOf(sQuery) !== -1;
                    });
                };
                var aEmp = oData.people.filter(function (p) {
                    return fnMatch([p.FirstName, p.LastName, p.UserName]);
                }).slice(0, 8).map(function (p) {
                    return {
                        type: "employee",
                        title: (p.FirstName || "") + " " + (p.LastName || ""),
                        desc: p.UserName,
                        key: p.UserName,
                        icon: "sap-icon://employee"
                    };
                });
                var aApt = oData.airports.filter(function (a) {
                    return fnMatch([a.Name, a.IataCode,
                        a.Location && a.Location.City && a.Location.City.Name]);
                }).slice(0, 8).map(function (a) {
                    return {
                        type: "airport",
                        title: a.Name,
                        desc: a.IataCode,
                        key: a.IataCode,
                        icon: "sap-icon://flight"
                    };
                });
                var aAln = oData.airlines.filter(function (a) {
                    return fnMatch([a.Name, a.AirlineCode]);
                }).slice(0, 8).map(function (a) {
                    return {
                        type: "airline",
                        title: a.Name,
                        desc: a.AirlineCode,
                        key: a.AirlineCode,
                        icon: "sap-icon://globe"
                    };
                });

                if (!aEmp.length && !aApt.length && !aAln.length) {
                    MessageToast.show(that._bundle().getText("globalSearchNoResults"));
                    return;
                }

                var oSearchModel = new JSONModel({
                    query: sQuery,
                    employees: aEmp, airports: aApt, airlines: aAln,
                    empCount: aEmp.length, airportCount: aApt.length, airlineCount: aAln.length
                });
                that._openSearchDialog(oSearchModel);
            });
        },

        _openSearchDialog: function (oSearchModel) {
            var that = this;
            var fnShow = function () {
                that._oSearchDialog.setModel(oSearchModel, "search");
                that._oSearchDialog.open();
            };
            if (this._oSearchDialog) {
                fnShow();
                return;
            }
            Fragment.load({
                id: this.getView().getId() + "--searchResults",
                name: "primepath.dashboard.view.SearchResults",
                controller: this
            }).then(function (oDialog) {
                that._oSearchDialog = oDialog;
                that.getView().addDependent(oDialog);
                fnShow();
            });
        },

        onSearchItemPress: function (oEvent) {
            var oItem = oEvent.getSource().getBindingContext("search").getObject();
            var oRouter = this.getOwnerComponent().getRouter();
            if (this._oSearchDialog) {
                this._oSearchDialog.close();
            }
            if (oItem.type === "employee") {
                oRouter.navTo("employee", { userName: oItem.key });
            } else if (oItem.type === "airport") {
                oRouter.navTo("airportFocus", { iata: oItem.key });
            } else {
                // geen airline-detailpagina → informatief
                MessageToast.show(this._bundle().getText("airlineInfo", [oItem.title, oItem.key]));
            }
        },

        onCloseSearch: function () {
            if (this._oSearchDialog) {
                this._oSearchDialog.close();
            }
        },

        onExit: function () {
            if (this._oSearchDialog) {
                this._oSearchDialog.destroy();
                this._oSearchDialog = null;
            }
        },

        _bundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        }

    });
});
