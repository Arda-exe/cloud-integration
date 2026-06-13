sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/format/DateFormat",
    "sap/m/MessageToast",
    "sap/base/Log"
], function (Controller, JSONModel, Filter, FilterOperator, DateFormat, MessageToast, Log) {
    "use strict";

    var MS_PER_DAY = 24 * 60 * 60 * 1000;

    return Controller.extend("primepath.dashboard.controller.EmployeeDetail", {

        onInit: function () {
            this._oDateFormat = DateFormat.getDateInstance({ style: "medium" });
            this._aAllTrips = [];
            this.getView().setModel(new JSONModel({ trips: [], locationText: "", busy: false }), "detail");
            this.getOwnerComponent().getRouter().getRoute("employee")
                .attachPatternMatched(this.onPatternMatched, this);
        },

        onPatternMatched: function (oEvent) {
            var sUserName = oEvent.getParameter("arguments").userName;
            this._sUserName = sUserName;

            // OData escapet een ' in een string-literal door verdubbeling
            var sKey = encodeURIComponent(sUserName.replace(/'/g, "''"));
            this.getView().bindElement({
                path: "people>/People('" + sKey + "')"
            });

            // UI-state resetten bij wissel van persoon
            this._aAllTrips = [];
            this.byId("tripsRange").setDateValue(null);
            this.byId("tripsRange").setSecondDateValue(null);
            this.byId("locationDate").setDateValue(null);
            var oDetail = this.getView().getModel("detail");
            oDetail.setProperty("/trips", []);
            oDetail.setProperty("/locationText", "");

            this._loadTrips(sUserName);
        },

        _loadTrips: function (sUserName) {
            var that = this;
            var oDetail = this.getView().getModel("detail");
            var oTripsModel = this.getOwnerComponent().getModel("trips");
            oDetail.setProperty("/busy", true);

            // De backend leest de username uit de waarde van de eerste filterconditie
            // (CLAUDE.md backend issue 4); het gefilterde veld zelf is daarbij irrelevant.
            // Na de backendfix (query forwarding + persoonsveld in de projectie) wordt
            // dit een echte server-side filter op dat persoonsveld.
            var oBinding = oTripsModel.bindList("/PersonTrips", undefined, undefined,
                [new Filter("Name", FilterOperator.EQ, sUserName)]);

            oBinding.requestContexts(0, 100).then(function (aContexts) {
                if (that._sUserName !== sUserName) {
                    return; // intussen naar een andere persoon genavigeerd
                }
                var aTrips = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });
                // chronologisch; ISO-strings sorteren correct als tekst
                aTrips.sort(function (a, b) {
                    return a.StartsAt < b.StartsAt ? -1 : 1;
                });
                that._aAllTrips = aTrips;
                that._applyDateRange();
                oDetail.setProperty("/busy", false);
            }).catch(function (oError) {
                Log.error("Loading trips failed", oError);
                oDetail.setProperty("/busy", false);
                var oBundle = that.getOwnerComponent().getModel("i18n").getResourceBundle();
                MessageToast.show(oBundle.getText("tripsLoadError"));
            });
        },

        onDateRangeChange: function () {
            this._applyDateRange();
        },

        _applyDateRange: function () {
            var oRange = this.byId("tripsRange");
            var oFrom = oRange.getDateValue();
            var oTo = oRange.getSecondDateValue();
            var aTrips = this._aAllTrips;

            if (oFrom && oTo) {
                var iFrom = oFrom.getTime();
                var iTo = oTo.getTime() + MS_PER_DAY - 1;
                aTrips = aTrips.filter(function (oTrip) {
                    // een trip telt mee zodra hij de gekozen periode overlapt
                    return new Date(oTrip.EndsAt).getTime() >= iFrom
                        && new Date(oTrip.StartsAt).getTime() <= iTo;
                });
            }
            this.getView().getModel("detail").setProperty("/trips", aTrips);
        },

        onLocationDateChange: function (oEvent) {
            var oDate = oEvent.getSource().getDateValue();
            var oDetail = this.getView().getModel("detail");
            if (!oDate) {
                oDetail.setProperty("/locationText", "");
                return;
            }

            var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            var oContext = this.getView().getBindingContext("people");
            var oPerson = (oContext && oContext.getObject()) || {};
            var sName = oPerson.FirstName || this._sUserName;
            var sDate = this._oDateFormat.format(oDate);

            var iDayStart = oDate.getTime();
            var iDayEnd = iDayStart + MS_PER_DAY - 1;
            var oTrip = this._aAllTrips.find(function (t) {
                return new Date(t.StartsAt).getTime() <= iDayEnd
                    && new Date(t.EndsAt).getTime() >= iDayStart;
            });

            var sText;
            if (oTrip) {
                sText = oBundle.getText("locationOnTrip", [sDate, sName, oTrip.Name,
                    this._oDateFormat.format(new Date(oTrip.StartsAt)),
                    this._oDateFormat.format(new Date(oTrip.EndsAt))]);
            } else {
                var sCity = this.formatCity(oPerson.AddressInfo) || oBundle.getText("cityUnknown");
                sText = oBundle.getText("locationAtHome", [sDate, sName, sCity]);
            }
            oDetail.setProperty("/locationText", sText);
        },

        onTripPress: function (oEvent) {
            var oTrip = oEvent.getSource().getBindingContext("detail").getObject();
            this.getOwnerComponent().getRouter().navTo("trip", {
                userName: this._sUserName,
                tripId: oTrip.TripId
            });

            this._loadTrips(sUserName);
        },

        _loadTrips: function (sUserName) {
            var oView = this.getView();
            fetch("/trips/PersonTrips?$filter=personUserName eq '" + sUserName + "'")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    oView.setModel(new JSONModel({ trips: data.value ?? [] }), "tripData");
                });
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("employees");
        },

        formatEmails: function (aEmails) {
            return Array.isArray(aEmails) ? aEmails.join(", ") : "";
        },

        formatCity: function (aAddressInfo) {
            var oCity = Array.isArray(aAddressInfo) && aAddressInfo[0] && aAddressInfo[0].City;
            return oCity ? oCity.Name + ", " + oCity.CountryRegion : "";
        },

        formatPeriod: function (sStartsAt, sEndsAt) {
            if (!sStartsAt || !sEndsAt) {
                return "";
            }
            return this._oDateFormat.format(new Date(sStartsAt)) + " – "
                + this._oDateFormat.format(new Date(sEndsAt));
        }

        formatDate: function (sDate) {
            if (!sDate) return "";
            return new Date(sDate).toLocaleDateString("nl-BE");
        }
    });
});