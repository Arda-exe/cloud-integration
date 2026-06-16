sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/format/DateFormat",
    "sap/m/MessageToast",
    "sap/base/Log",
    "primepath/dashboard/util/formatters",
    "primepath/dashboard/util/constants",
    "primepath/dashboard/util/datePresets"
], function (BaseController, JSONModel, DateFormat, MessageToast, Log, formatters, constants, datePresets) {
    "use strict";

    return BaseController.extend("primepath.dashboard.controller.EmployeeDetail", {

        onInit: function () {
            this._oDateFormat = DateFormat.getDateInstance({ style: "medium" });
            this._aAllTrips = [];
            this.getView().setModel(new JSONModel({
                trips: [],
                locationText: "",
                busy: false,
                preset: "all",   // actieve snelkeuze ("" = handmatig bereik)
                counts: { total: 0, upcoming: 0, completed: 0 }
            }), "detail");
            this.getRouter().getRoute("employee")
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
            var oDetail = this.getView().getModel("detail");
            oDetail.setProperty("/trips", []);
            oDetail.setProperty("/locationText", "");
            oDetail.setProperty("/preset", "all");
            oDetail.setProperty("/counts", { total: 0, upcoming: 0, completed: 0 });

            this._loadTrips(sUserName);
        },

        _loadTrips: function (sUserName) {
            var that = this;
            var oDetail = this.getView().getModel("detail");
            oDetail.setProperty("/busy", true);

            // trips uit de app-brede cache (gedeeld met Overview/TripDetail)
            this.getOwnerComponent().getCachedTrips(sUserName).then(function (aTrips) {
                if (that._sUserName !== sUserName) {
                    return; // intussen naar een andere persoon genavigeerd
                }
                // kopie vóór sort — gedeelde cache-array niet muteren; ISO-strings
                // sorteren correct als tekst (chronologisch)
                that._aAllTrips = aTrips.slice().sort(function (a, b) {
                    return a.StartsAt < b.StartsAt ? -1 : 1;
                });
                // tellers over ALLE trips van de persoon (niet de periode-gefilterde lijst)
                oDetail.setProperty("/counts", that._computeCounts(that._aAllTrips));
                that._applyDateRange();
                oDetail.setProperty("/busy", false);
            }).catch(function (oError) {
                Log.error("Loading trips failed", oError);
                oDetail.setProperty("/busy", false);
                MessageToast.show(that.getResourceBundle().getText("tripsLoadError"));
            });
        },

        // Total / Upcoming (start in de toekomst) / Completed (einde in het verleden) t.o.v. nu.
        // Een lopende trip (start <= nu <= einde) telt mee in Total maar niet in Upcoming/Completed.
        _computeCounts: function (aTrips) {
            var iNow = Date.now();
            var iUpcoming = 0;
            var iCompleted = 0;
            aTrips.forEach(function (oTrip) {
                if (new Date(oTrip.StartsAt).getTime() > iNow) {
                    iUpcoming++;
                } else if (new Date(oTrip.EndsAt).getTime() < iNow) {
                    iCompleted++;
                }
            });
            return { total: aTrips.length, upcoming: iUpcoming, completed: iCompleted };
        },

        onDateRangeChange: function () {
            // handmatig bereik → geen snelkeuze meer actief
            this.getView().getModel("detail").setProperty("/preset", "");
            this._applyDateRange();
        },

        // snelkeuze-knop: vult de DateRangeSelection (programmatisch → vuurt geen change)
        // en filtert meteen. "all" wist het bereik.
        onPresetPress: function (oEvent) {
            var sKey = oEvent.getSource().data("period");
            var oRange = datePresets.rangeFor(sKey);
            this.getView().getModel("detail").setProperty("/preset", sKey);
            var oPicker = this.byId("tripsRange");
            oPicker.setDateValue(oRange ? oRange.from : null);
            oPicker.setSecondDateValue(oRange ? oRange.to : null);
            this._applyDateRange();
        },

        _applyDateRange: function () {
            var oRange = this.byId("tripsRange");
            var oFrom = oRange.getDateValue();
            var oTo = oRange.getSecondDateValue();
            var aTrips = this._aAllTrips;

            if (oFrom && oTo) {
                var iFrom = oFrom.getTime();
                var iTo = oTo.getTime() + constants.MS_PER_DAY - 1;
                aTrips = aTrips.filter(function (oTrip) {
                    // een trip telt mee zodra hij de gekozen periode overlapt
                    return new Date(oTrip.EndsAt).getTime() >= iFrom
                        && new Date(oTrip.StartsAt).getTime() <= iTo;
                });
            }
            this.getView().getModel("detail").setProperty("/trips", aTrips);
        },

        // "Locate on date" achter een knop → kleine popover (geen tweede zichtbaar datumveld
        // naast de trips-periodefilter). Start telkens leeg.
        onOpenLocation: function (oEvent) {
            var that = this;
            var oButton = oEvent.getSource();
            var fnOpen = function () {
                that.byId("locationDate").setDateValue(null);
                that.getView().getModel("detail").setProperty("/locationText", "");
                that._oLocationPopover.openBy(oButton);
            };
            if (this._oLocationPopover) {
                fnOpen();
                return;
            }
            this.loadFragment({ name: "primepath.dashboard.view.LocationPopover" }).then(function (oPopover) {
                that._oLocationPopover = oPopover;
                fnOpen();
            });
        },

        onLocationDateChange: function (oEvent) {
            var oDate = oEvent.getSource().getDateValue();
            var oDetail = this.getView().getModel("detail");
            if (!oDate) {
                oDetail.setProperty("/locationText", "");
                return;
            }

            var oBundle = this.getResourceBundle();
            var oContext = this.getView().getBindingContext("people");
            var oPerson = (oContext && oContext.getObject()) || {};
            var sName = oPerson.FirstName || this._sUserName;
            var sDate = this._oDateFormat.format(oDate);

            var iDayStart = oDate.getTime();
            var iDayEnd = iDayStart + constants.MS_PER_DAY - 1;
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
            this.getRouter().navTo("trip", {
                userName: this._sUserName,
                tripId: oTrip.TripId
            });
        },

        onNavBack: function () {
            this.getRouter().navTo("employees");
        },

        onExit: function () {
            if (this._oLocationPopover) {
                this._oLocationPopover.destroy();
                this._oLocationPopover = null;
            }
        },

        formatEmails: formatters.formatEmails,

        formatCity: formatters.formatCity,

        formatPeriod: formatters.formatPeriod
    });
});