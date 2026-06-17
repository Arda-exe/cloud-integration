sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/format/DateFormat",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/base/Log",
    "primepath/dashboard/util/formatters",
    "primepath/dashboard/util/constants",
    "primepath/dashboard/util/datePresets",
    "primepath/dashboard/util/approval"
], function (BaseController, JSONModel, DateFormat, MessageToast, MessageBox, Log, formatters, constants, datePresets, approval) {
    "use strict";

    // goedkeuringsstatus → kleur (sap.ui.core.ValueState) + i18n-sleutel (zelfde teksten als All Trips)
    var STATUS_STATE = { approved: "Success", rejected: "Error", pending: "Warning" };
    var STATUS_TEXT_KEY = { approved: "appr_approved", rejected: "appr_rejected", pending: "appr_pending" };

    return BaseController.extend("primepath.dashboard.controller.EmployeeDetail", {

        onInit: function () {
            this._oDateFormat = DateFormat.getDateInstance({ style: "medium" });
            this._aAllTrips = [];
            this.getView().setModel(new JSONModel({
                trips: [],
                rejectedTrips: [],
                locationText: "",
                busy: false,
                preset: "all",
                team: "",
                company: "",
                counts: { total: 0, upcoming: 0, completed: 0 }
            }), "detail");
            this._mExt = {};
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
            oDetail.setProperty("/rejectedTrips", []);
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
            var oComp = this.getOwnerComponent();
            var oDetail = this.getView().getModel("detail");
            oDetail.setProperty("/busy", true);

            // trips + de live goedkeurings-map samen → elke trip krijgt zijn afgeleide status
            Promise.all([
                oComp.getCachedTrips(sUserName),
                oComp.getTripExtensions()
            ]).then(function (aResults) {
                if (that._sUserName !== sUserName) { return; }
                var mExt = aResults[1] || {};
                that._mExt = mExt;
                var oBundle = that.getResourceBundle();
                // augmented KOPIEËN (cache-safe) met afgeleide status → badge-kolom + rejected-sectie
                that._aAllTrips = aResults[0].map(function (oTrip) {
                    var sKey = approval.statusKey(oTrip, sUserName, mExt);
                    return Object.assign({}, oTrip, {
                        _statusKey:   sKey,
                        _statusText:  sKey === "notsubmitted"
                            ? oBundle.getText("approvalNone")
                            : oBundle.getText(STATUS_TEXT_KEY[sKey]),
                        _statusState: STATUS_STATE[sKey] || "None"
                    });
                }).sort(function (a, b) {
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

        // tegels tellen enkel GOEDGEKEURDE trips (Totaal/Gepland/Afgerond)
        _computeCounts: function (aTrips) {
            var iNow = Date.now();
            var iTotal = 0;
            var iUpcoming = 0;
            var iCompleted = 0;
            (aTrips || []).forEach(function (oTrip) {
                if (!approval.isApproved(oTrip._statusKey)) { return; }
                iTotal++;
                if (new Date(oTrip.StartsAt).getTime() > iNow) {
                    iUpcoming++;
                } else if (new Date(oTrip.EndsAt).getTime() < iNow) {
                    iCompleted++;
                }
            });
            return { total: iTotal, upcoming: iUpcoming, completed: iCompleted };
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
            // hoofdlijst = alles behalve afgekeurd (goedgekeurd telt; pending/niet-ingediend
            // blijven zichtbaar met badge), afgekeurde trips krijgen hun eigen sectie eronder
            var oDetail = this.getView().getModel("detail");
            oDetail.setProperty("/trips", aTrips.filter(function (oTrip) {
                return oTrip._statusKey !== "rejected";
            }));
            oDetail.setProperty("/rejectedTrips", aTrips.filter(function (oTrip) {
                return oTrip._statusKey === "rejected";
            }));
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
                // enkel goedgekeurde trips plaatsen de persoon effectief "op reis"
                return approval.isApproved(t._statusKey)
                    && new Date(t.StartsAt).getTime() <= iDayEnd
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