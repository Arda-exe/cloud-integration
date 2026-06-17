sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/format/DateFormat",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/base/Log",
    "primepath/dashboard/util/formatters",
    "primepath/dashboard/util/constants",
    "primepath/dashboard/util/datePresets"
], function (BaseController, JSONModel, DateFormat, MessageToast, MessageBox, Log, formatters, constants, datePresets) {
    "use strict";

    return BaseController.extend("primepath.dashboard.controller.EmployeeDetail", {

        onInit: function () {
            this._oDateFormat = DateFormat.getDateInstance({ style: "medium" });
            this._aAllTrips = [];
            this.getView().setModel(new JSONModel({
                trips: [],
                locationText: "",
                busy: false,
                preset: "all",
                team: "",
                company: "",
                counts: { total: 0, upcoming: 0, completed: 0 }
            }), "detail");
            this.getRouter().getRoute("employee")
                .attachPatternMatched(this.onPatternMatched, this);
        },

        onPatternMatched: function (oEvent) {
            var sUserName = oEvent.getParameter("arguments").userName;
            this._sUserName = sUserName;

            var sKey = encodeURIComponent(sUserName.replace(/'/g, "''"));
            this.getView().bindElement({
                path: "people>/People('" + sKey + "')"
            });

            this._aAllTrips = [];
            this.byId("tripsRange").setDateValue(null);
            this.byId("tripsRange").setSecondDateValue(null);
            var oDetail = this.getView().getModel("detail");
            oDetail.setProperty("/trips", []);
            oDetail.setProperty("/locationText", "");
            oDetail.setProperty("/preset", "all");
            oDetail.setProperty("/team", "");
            oDetail.setProperty("/company", "");
            oDetail.setProperty("/counts", { total: 0, upcoming: 0, completed: 0 });

            this._loadTrips(sUserName);
            this._loadExtension(sUserName);
        },

        // team/company komen uit PersonExtension (aparte CAP-entiteit) → in het detail-model
        // zetten zodat de header ze toont. Stale-nav guard zoals _loadTrips.
        _loadExtension: function (sUserName) {
            var that = this;
            this.getOwnerComponent().getPersonExtensions().then(function (mExt) {
                if (that._sUserName !== sUserName) { return; }
                var oExt = mExt[sUserName] || {};
                var oDetail = that.getView().getModel("detail");
                oDetail.setProperty("/team", oExt.team || "");
                oDetail.setProperty("/company", oExt.company || "");
            }).catch(function (oError) {
                Log.error("Loading person extension failed", oError);
            });
        },

        _loadTrips: function (sUserName) {
            var that = this;
            var oDetail = this.getView().getModel("detail");
            oDetail.setProperty("/busy", true);

            this.getOwnerComponent().getCachedTrips(sUserName).then(function (aTrips) {
                if (that._sUserName !== sUserName) { return; }
                that._aAllTrips = aTrips.slice().sort(function (a, b) {
                    return a.StartsAt < b.StartsAt ? -1 : 1;
                });
                oDetail.setProperty("/counts", that._computeCounts(that._aAllTrips));
                that._applyDateRange();
                oDetail.setProperty("/busy", false);
            }).catch(function (oError) {
                Log.error("Loading trips failed", oError);
                oDetail.setProperty("/busy", false);
                MessageToast.show(that.getResourceBundle().getText("tripsLoadError"));
            });
        },

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
            this.getView().getModel("detail").setProperty("/preset", "");
            this._applyDateRange();
        },

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
                    return new Date(oTrip.EndsAt).getTime() >= iFrom
                        && new Date(oTrip.StartsAt).getTime() <= iTo;
                });
            }
            this.getView().getModel("detail").setProperty("/trips", aTrips);
        },

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

        _showOwnTripDetail: function (oTrip) {
            var oFmt = this._oDateFormat;
            var sStart = oTrip.StartsAt ? oFmt.format(new Date(oTrip.StartsAt)) : "—";
            var sEnd   = oTrip.EndsAt   ? oFmt.format(new Date(oTrip.EndsAt))   : "—";

            MessageBox.information(
                "Periode: " + sStart + " – " + sEnd + "\n" +
                "Bestemming: " + (oTrip.Description || "—") + "\n" +
                "Budget: " + (oTrip.Budget ? oTrip.Budget + " USD" : "—"),
                {
                    title: oTrip.Name + " (Eigen trip)",
                    actions: [MessageBox.Action.CLOSE]
                }
            );
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
        formatCity:   formatters.formatCity,
        formatPeriod: formatters.formatPeriod
    });
});