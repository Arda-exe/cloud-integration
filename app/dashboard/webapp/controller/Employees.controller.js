sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/base/Log",
    "primepath/dashboard/util/formatters",
    "primepath/dashboard/util/searchFilter"
], function (BaseController, JSONModel, Log, formatters, searchFilter) {
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
            this.getView().setModel(new JSONModel({ people: [], count: 0, busy: true }), "view");
            this._loadPeople();
        },

        _loadPeople: function () {
            var that = this;
            var oVM = this.getView().getModel("view");
            var oBundle = this.getResourceBundle();
            // getTripData levert personen MET hun trips (gedeelde cache, zelfde burst als Overview)
            this.getOwnerComponent().getTripData().then(function (aPerPerson) {
                // augmented KOPIEËN — nooit de gedeelde cache-objecten muteren
                that._aAllPeople = aPerPerson.map(function (oEntry) {
                    var sStatus = that._computeStatus(oEntry.trips);
                    return Object.assign({}, oEntry.person, {
                        status: sStatus,
                        statusText: oBundle.getText(STATUS_TEXT_KEY[sStatus]),
                        statusState: STATUS_STATE[sStatus]
                    });
                }).sort(function (a, b) {
                    var sA = (a.LastName || "") + (a.FirstName || "");
                    var sB = (b.LastName || "") + (b.FirstName || "");
                    return sA < sB ? -1 : 1;
                });
                oVM.setProperty("/busy", false);
                that._applySearch();
            }).catch(function (oError) {
                Log.error("Loading employees failed", oError);
                oVM.setProperty("/busy", false);
            });
        },

        // reisstatus t.o.v. vandaag: onderweg (trip loopt nu) > gepland (toekomstige trip) > beschikbaar
        _computeStatus: function (aTrips) {
            var iNow = Date.now();
            var bTraveling = false;
            var bUpcoming = false;
            (aTrips || []).forEach(function (oTrip) {
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

        // Client-side filteren (backend $filter wordt nog genegeerd, issue 2): zoekterm én
        // statusfilter in één pass.
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

        formatEmails: formatters.formatEmails

    });
});
