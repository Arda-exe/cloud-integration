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

            // global search verbergen op de launchpad. sap.f.SearchManager is een Element
            // (geen visible-property), dus we halen de aggregatie weg en zetten ze terug
            // bij het betreden van de app (zonder ze te vernietigen).
            var oShellBar = this.byId("shellBar");
            if (oShellBar) {
                if (bLaunchpad) {
                    if (oShellBar.getSearchManager()) {
                        this._oSearchManager = oShellBar.getSearchManager();
                        oShellBar.setSearchManager(null);
                    }
                } else if (this._oSearchManager) {
                    oShellBar.setSearchManager(this._oSearchManager);
                    this._oSearchManager = null;
                }
            }

            if (bLaunchpad) {
                return;   // launchpad heeft geen tab → niets selecteren
            }
            // lokaal nog geen rol gekozen (refresh/deep-link) → terug naar de launchpad
            // i.p.v. een basic-auth-dialog te laten verschijnen
            if (oComponent.needsLogin()) {
                this.getRouter().navTo("launchpad");
                return;
            }
            // rol-scoping op route-niveau: een voor deze rol verborgen top-level tab mag ook niet
            // via de hash/deep-link bereikbaar zijn → terug naar de eigen landing. Detail-routes
            // (employee/trip/airportFocus) blijven open voor cross-navigatie en worden door de
            // backend-scope beschermd.
            var bTopTab = sRoute === "overview" || sRoute === "employees" || sRoute === "airports";
            if (bTopTab && !oComponent.isTabAllowed(sRoute)) {
                this.getRouter().navTo(oComponent.roleLanding());
                return;
            }
            // detail routes horen bij de tab van hun lijst (allTrips wordt vanuit Employees
            // geopend → blijft onder de Employees-tab; geen aparte Trips-tab, zie domeinregel)
            var mRouteToTab = {
                employee: "employees", trip: "employees", allTrips: "employees",
                airportFocus: "airports"
            };
            this.byId("tabHeader").setSelectedKey(mRouteToTab[sRoute] || sRoute);
        },

        onTabSelect: function (oEvent) {
            this.getRouter()
                .navTo(oEvent.getParameter("key"));
        },

        // terug naar de launchpad om een andere rol te kiezen. Lokaal = de auth-context wissen +
        // launchpad; op BTP = enkel de actieve rol loslaten → launchpad (de XSUAA-sessie blijft,
        // dus geen nieuwe login nodig; echte sign-out gebeurt via de launchpad-link).
        onSwitchRole: function () {
            this.getOwnerComponent().switchRole();
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
