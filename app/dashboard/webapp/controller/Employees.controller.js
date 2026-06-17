sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/base/Log",
    "primepath/dashboard/util/formatters",
    "primepath/dashboard/util/searchFilter",
    "primepath/dashboard/util/approval"
], function (BaseController, JSONModel, Log, formatters, searchFilter, approval) {
    "use strict";

    // afgeleide reisstatus → kleur (sap.ui.core.ValueState) + i18n-sleutel
    var STATUS_STATE = { traveling: "Warning", upcoming: "Information", available: "Success" };
    var STATUS_TEXT_KEY = {
        traveling: "statusTraveling",
        upcoming: "statusUpcoming",
        available: "statusAvailable"
    };

    return BaseController.extend("primepath.dashboard.controller.Employees", {

        onInit: function () {
            this._aAllPeople = [];
            this.getView().setModel(new JSONModel({
                people: [], count: 0, busy: true,
                teamOptions: [], companyOptions: []
            }), "view");
            // bij elke navigatie naar deze tab herladen, zodat een nieuw aangemaakte trip de
            // afgeleide status (upcoming/traveling) meteen bijwerkt (cache is al geëvict bij create)
            this.getRouter().getRoute("employees")
                .attachPatternMatched(this.onPatternMatched, this);
        },

        onPatternMatched: function () {
            this._loadPeople();
        },

        _loadPeople: function () {
            var that = this;
            var oVM = this.getView().getModel("view");
            var oBundle = this.getResourceBundle();
            var oComp = this.getOwnerComponent();
            // getTripData levert personen MET hun trips (gedeelde cache, zelfde burst als Overview);
            // getPersonExtensions levert team/company per medewerker (aparte CAP-entiteit);
            // getTripExtensions levert de goedkeurings-map → enkel goedgekeurde trips bepalen status
            Promise.all([
                oComp.getTripData(),
                oComp.getPersonExtensions(),
                oComp.getTripExtensions()
            ]).then(function (aResults) {
                var aPerPerson = aResults[0];
                var mExt = aResults[1] || {};
                var mTripExt = aResults[2] || {};
                // augmented KOPIEËN — nooit de gedeelde cache-objecten muteren
                that._aAllPeople = aPerPerson.map(function (oEntry) {
                    var sStatus = that._computeStatus(oEntry.person.UserName, oEntry.trips, mTripExt);
                    var oExt = mExt[oEntry.person.UserName] || {};
                    return Object.assign({}, oEntry.person, {
                        status: sStatus,
                        statusText: oBundle.getText(STATUS_TEXT_KEY[sStatus]),
                        statusState: STATUS_STATE[sStatus],
                        team: oExt.team || "",
                        company: oExt.company || ""
                    });
                }).sort(function (a, b) {
                    var sA = (a.LastName || "") + (a.FirstName || "");
                    var sB = (b.LastName || "") + (b.FirstName || "");
                    return sA < sB ? -1 : 1;
                });
                that._buildFilterOptions();
                oVM.setProperty("/busy", false);
                that._applySearch();
            }).catch(function (oError) {
                Log.error("Loading employees failed", oError);
                oVM.setProperty("/busy", false);
            });
        },

        // distinct team-/company-waarden → dropdown-opties; de "Alle"-optie staat als sentinel
        // (key="") vooraan in de array i.p.v. een statisch <core:Item>, omdat een Select met
        // zowel statische als gebonden items die niet betrouwbaar samenvoegt.
        _buildFilterOptions: function () {
            var oBundle = this.getResourceBundle();
            var sAll = oBundle.getText("filterAll");
            var fnOptions = function (sField) {
                var oSeen = {};
                this._aAllPeople.forEach(function (oPerson) {
                    var sVal = oPerson[sField];
                    if (sVal) { oSeen[sVal] = true; }
                });
                var aOptions = Object.keys(oSeen).sort().map(function (sVal) {
                    return { key: sVal, text: sVal };
                });
                aOptions.unshift({ key: "", text: sAll });
                return aOptions;
            }.bind(this);

            var oVM = this.getView().getModel("view");
            oVM.setProperty("/teamOptions", fnOptions("team"));
            oVM.setProperty("/companyOptions", fnOptions("company"));
        },

        // reisstatus t.o.v. vandaag: onderweg (trip loopt nu) > gepland (toekomstige trip) > beschikbaar.
        // Enkel GOEDGEKEURDE trips tellen mee — een afgekeurde/pending trip maakt niemand "onderweg".
        _computeStatus: function (sUserName, aTrips, mExt) {
            var iNow = Date.now();
            var bTraveling = false;
            var bUpcoming = false;
            (aTrips || []).forEach(function (oTrip) {
                if (!approval.isApproved(approval.statusKey(oTrip, sUserName, mExt))) { return; }
                var iStart = new Date(oTrip.StartsAt).getTime();
                var iEnd = new Date(oTrip.EndsAt).getTime();
                if (iStart <= iNow && iEnd >= iNow) {
                    bTraveling = true;
                } else if (iStart > iNow) {
                    bUpcoming = true;
                }
            });
            return bTraveling ? "traveling" : (bUpcoming ? "upcoming" : "available");
        },

        onSearch: function () {
            this._applySearch();
        },

        onStatusChange: function () {
            this._applySearch();
        },

        onTeamChange: function () {
            this._applySearch();
        },

        onCompanyChange: function () {
            this._applySearch();
        },

        // Client-side filteren (backend $filter wordt nog genegeerd, issue 2): zoekterm,
        // status-, team- én company-filter in één pass.
        _applySearch: function () {
            var aPeople = searchFilter.filter(
                this._aAllPeople,
                this.byId("searchField").getValue(),
                function (oPerson) {
                    return [oPerson.FirstName, oPerson.LastName, oPerson.UserName];
                }
            );
            var sStatus = this.byId("statusFilter").getSelectedKey();
            if (sStatus) {
                aPeople = aPeople.filter(function (oPerson) {
                    return oPerson.status === sStatus;
                });
            }
            var sTeam = this.byId("teamFilter").getSelectedKey();
            if (sTeam) {
                aPeople = aPeople.filter(function (oPerson) {
                    return oPerson.team === sTeam;
                });
            }
            var sCompany = this.byId("companyFilter").getSelectedKey();
            if (sCompany) {
                aPeople = aPeople.filter(function (oPerson) {
                    return oPerson.company === sCompany;
                });
            }
            var oViewModel = this.getView().getModel("view");
            oViewModel.setProperty("/people", aPeople);
            oViewModel.setProperty("/count", aPeople.length);
        },

        onEmployeePress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("view");
            this.getRouter().navTo("employee", {
                userName: oContext.getProperty("UserName")
            });
        },

        onAllTrips: function () {
            this.getRouter().navTo("allTrips");
        },

        formatEmails: formatters.formatEmails

    });
});
