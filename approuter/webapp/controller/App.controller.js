sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "primepath/dashboard/util/searchFilter"
], function (BaseController, Fragment, JSONModel, MessageToast, searchFilter) {
    "use strict";

    return BaseController.extend("primepath.dashboard.controller.App", {

        onInit: function () {
            // route names en tab keys zijn identiek (overview/employees/airports), dus de
            // route-naam kan rechtstreeks als selectedKey dienen. De launchpad-route heeft
            // geen tab → die wordt apart afgehandeld in onRouteMatched.
            this.getRouter()
                .attachRouteMatched(this.onRouteMatched, this);
        },

        onRouteMatched: function (oEvent) {
            var sRoute = oEvent.getParameter("name");
            var bLaunchpad = sRoute === "launchpad";
            var oComponent = this.getOwnerComponent();
            // tab-balk + switch-role verschijnen pas binnen de app, niet op de launchpad
            oComponent.getModel("app").setProperty("/showChrome", !bLaunchpad);
            if (bLaunchpad) {
                return;   // launchpad heeft geen tab → niets selecteren
            }
            // lokaal nog geen rol gekozen (refresh/deep-link) → terug naar de launchpad
            // i.p.v. een basic-auth-dialog te laten verschijnen
            if (oComponent.needsLogin()) {
                this.getRouter().navTo("launchpad");
                return;
            }
            // detail routes horen bij de tab van hun lijst
            var mRouteToTab = { employee: "employees", trip: "employees", airportFocus: "airports" };
            this.byId("tabHeader").setSelectedKey(mRouteToTab[sRoute] || sRoute);
        },

        onTabSelect: function (oEvent) {
            this.getRouter()
                .navTo(oEvent.getParameter("key"));
        },

        // terug naar de launchpad om een andere rol te kiezen
        onSwitchRole: function () {
            this.getRouter().navTo("launchpad");
        },

        // ---- Global search (feature 7) -------------------------------------

        // Hergebruikt de app-brede Component-cache → de zoekfunctie deelt de datasets
        // met Overview/Employees/Airports (geen extra requests).
        _ensureSearchData: function () {
            var oComponent = this.getOwnerComponent();
            // alleen entiteiten met een doelpagina → airlines zijn weggelaten (geen
            // airline-detail om naartoe te navigeren)
            return Promise.all([
                oComponent.getCachedList("people", "/People"),
                oComponent.getCachedList("airports", "/Airports")
            ]).then(function (aResults) {
                return { people: aResults[0], airports: aResults[1] };
            });
        },

        onGlobalSearch: function (oEvent) {
            var that = this;
            var sQuery = (oEvent.getParameter("query") || "").toLowerCase().trim();
            if (!sQuery) {
                return;
            }
            this._ensureSearchData().then(function (oData) {
                var aEmp = searchFilter.filter(oData.people, sQuery, function (p) {
                    return [p.FirstName, p.LastName, p.UserName];
                }).slice(0, 8).map(function (p) {
                    return {
                        type: "employee",
                        title: (p.FirstName || "") + " " + (p.LastName || ""),
                        desc: p.UserName,
                        key: p.UserName,
                        icon: "sap-icon://employee"
                    };
                });
                var aApt = searchFilter.filter(oData.airports, sQuery, function (a) {
                    return [a.Name, a.IataCode,
                        a.Location && a.Location.City && a.Location.City.Name];
                }).slice(0, 8).map(function (a) {
                    return {
                        type: "airport",
                        title: a.Name,
                        desc: a.IataCode,
                        key: a.IataCode,
                        icon: "sap-icon://flight"
                    };
                });
                if (!aEmp.length && !aApt.length) {
                    MessageToast.show(that.getResourceBundle().getText("globalSearchNoResults"));
                    return;
                }

                var oSearchModel = new JSONModel({
                    query: sQuery,
                    employees: aEmp, airports: aApt,
                    empCount: aEmp.length, airportCount: aApt.length
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
            var oRouter = this.getRouter();
            if (this._oSearchDialog) {
                this._oSearchDialog.close();
            }
            if (oItem.type === "employee") {
                oRouter.navTo("employee", { userName: oItem.key });
            } else if (oItem.type === "airport") {
                oRouter.navTo("airportFocus", { iata: oItem.key });
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
        }

    });
});
