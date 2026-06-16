sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/base/Log",
    "primepath/dashboard/util/formatters",
    "primepath/dashboard/util/searchFilter",
    "primepath/dashboard/util/tripGroups"
], function (BaseController, JSONModel, MessageToast, MessageBox, Log, formatters, searchFilter, tripGroups) {
    "use strict";

    // goedkeuringsstatus → kleur (sap.ui.core.ValueState) + i18n-sleutel
    var STATUS_STATE = { approved: "Success", rejected: "Error", pending: "Warning" };
    var STATUS_TEXT_KEY = { approved: "appr_approved", rejected: "appr_rejected", pending: "appr_pending" };

    return BaseController.extend("primepath.dashboard.controller.AllTrips", {

        onInit: function () {
            this._aAllGroups = [];
            this._oCreateDialog = null;
            this.getView().setModel(new JSONModel({
                groups: [], count: 0, busy: true, employees: []
            }), "view");
            this.getRouter().getRoute("allTrips")
                .attachPatternMatched(this.onPatternMatched, this);
        },

        // bij elke navigatie naar deze pagina herladen, zodat nieuw aangemaakte/goedgekeurde
        // trips meteen kloppen
        onPatternMatched: function () {
            this._loadAllTrips();
        },

        // Eén rij per ECHTE trip: kopieën van dezelfde gedeelde trip (zelfde ShareId) worden
        // samengevoegd tot één groep met een lid per reiziger (util/tripGroups). Goedkeuring
        // blijft per reiziger. TripPin-status komt uit een LIVE (ongecachte) TripExtensions-map.
        _loadAllTrips: function () {
            var that = this;
            var oComp = this.getOwnerComponent();
            var oVM = this.getView().getModel("view");
            var oBundle = this.getResourceBundle();
            oVM.setProperty("/busy", true);

            var oExtBinding = oComp.getModel("trips").bindList("/TripExtensions");

            Promise.all([
                oComp.getTripData(),
                oExtBinding.requestContexts(0, 1000)
            ]).then(function (aResults) {
                var aPerPerson = aResults[0];
                var mExt = {};
                aResults[1].forEach(function (oCtx) {
                    var o = oCtx.getObject();
                    mExt[o.personUserName + "|" + o.tripId] = o.approvalStatus;
                });

                // groepeer op ShareId; verrijk de VERSE util-objecten met periode + statusteksten
                var aGroups = tripGroups.groupTrips(aPerPerson, mExt);
                aGroups.forEach(function (oGroup) {
                    oGroup.period = formatters.formatPeriod(oGroup.startsAt, oGroup.endsAt);
                    oGroup.members.forEach(function (oMember) {
                        oMember.statusText = oMember.statusKey === "notsubmitted"
                            ? oBundle.getText("approvalNone")
                            : oBundle.getText(STATUS_TEXT_KEY[oMember.statusKey]);
                        oMember.statusState = STATUS_STATE[oMember.statusKey] || "None";
                    });
                });
                // nieuwste trips eerst (ISO-datumstring → string-vergelijking volstaat)
                aGroups.sort(function (a, b) {
                    return (a.startsAt < b.startsAt) ? 1 : -1;
                });

                var aEmployees = aPerPerson.map(function (oEntry) {
                    return {
                        UserName: oEntry.person.UserName,
                        fullName: ((oEntry.person.FirstName || "") + " " + (oEntry.person.LastName || "")).trim()
                    };
                }).sort(function (a, b) {
                    return a.fullName < b.fullName ? -1 : 1;
                });

                that._aAllGroups = aGroups;
                oVM.setProperty("/employees", aEmployees);
                oVM.setProperty("/busy", false);
                that._applySearch();
            }).catch(function (oError) {
                Log.error("Loading all trips failed", oError);
                oVM.setProperty("/busy", false);
                MessageToast.show(that.getResourceBundle().getText("tripsLoadError"));
            });
        },

        onSearch: function () {
            this._applySearch();
        },

        onApprovalFilterChange: function () {
            this._applySearch();
        },

        // client-side: zoekterm (tripnaam of een reiziger) + goedkeuringsfilter in één pass.
        // Bij per-reiziger goedkeuring blijft een groep staan zodra ÉÉN lid de status matcht.
        _applySearch: function () {
            var aGroups = searchFilter.filter(
                this._aAllGroups,
                this.byId("searchField").getValue(),
                function (oGroup) {
                    return [oGroup.tripName].concat(
                        oGroup.members.map(function (m) { return m.fullName; }),
                        oGroup.members.map(function (m) { return m.userName; })
                    );
                }
            );
            var sStatus = this.byId("approvalFilter").getSelectedKey();
            if (sStatus) {
                aGroups = aGroups.filter(function (oGroup) {
                    return oGroup.members.some(function (m) { return m.statusKey === sStatus; });
                });
            }
            var oVM = this.getView().getModel("view");
            oVM.setProperty("/groups", aGroups);
            oVM.setProperty("/count", aGroups.length);
        },

        onTripPress: function (oEvent) {
            var oGroup = oEvent.getSource().getBindingContext("view").getObject();
            this.getRouter().navTo("trip", { userName: oGroup.repUserName, tripId: oGroup.repTripId });
        },

        // ---- goedkeuringsacties (alleen coordinator) -----------------------

        onSubmit: function (oEvent) {
            var that = this;
            var oRow = oEvent.getSource().getBindingContext("view").getObject();
            var oBundle = this.getResourceBundle();
            MessageBox.confirm(oBundle.getText("approvalConfirm"), {
                title: oBundle.getText("btnSubmit"),
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    that.getOwnerComponent().getModel("trips")
                        .bindList("/TripExtensions")
                        .create({ personUserName: oRow.userName, tripId: oRow.tripId })
                        .created().then(function () {
                            MessageToast.show(oBundle.getText("approvalSubmitted"));
                            that._loadAllTrips();
                        }).catch(function (oError) {
                            Log.error("Submitting approval record failed", oError);
                            MessageToast.show(oBundle.getText("approvalSubmitError"));
                        });
                }
            });
        },

        onApprove: function (oEvent) {
            this._act(oEvent, "approved", "approve");
        },

        onReject: function (oEvent) {
            this._act(oEvent, "rejected", "rejectTrip");
        },

        // eigen trip → PATCH OwnTrips; TripPin-trip → gebonden TripExtensions-actie
        _act: function (oEvent, sOwnStatus, sExtAction) {
            var oRow = oEvent.getSource().getBindingContext("view").getObject();
            if (oRow.isOwn) {
                this._patchOwnTrip(oRow, sOwnStatus);
            } else {
                this._invokeExtAction(oRow, sExtAction);
            }
        },

        _patchOwnTrip: function (oRow, sStatus) {
            var that = this;
            var oComp = this.getOwnerComponent();
            var mHeaders = { "Content-Type": "application/json", Accept: "application/json" };
            if (oComp._sAuthHeader) { mHeaders.Authorization = oComp._sAuthHeader; }

            fetch("/trips/OwnTrips('" + oRow.rawUuid + "')", {
                method: "PATCH",
                headers: mHeaders,
                body: JSON.stringify({ approvalStatus: sStatus })
            })
            .then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                MessageToast.show(that.getResourceBundle().getText("approvalActionDone"));
                // eigen-trip status leeft in de gedeelde trip-cache → evicten
                delete oComp._mTripsCache[oRow.userName];
                oComp._pTripData = null;
                that._loadAllTrips();
            })
            .catch(function (oError) {
                Log.error("Patch own trip status failed", oError);
                MessageToast.show(that.getResourceBundle().getText("approvalActionError"));
            });
        },

        _invokeExtAction: function (oRow, sAction) {
            var that = this;
            var oModel = this.getOwnerComponent().getModel("trips");
            var sUser = "'" + String(oRow.userName).replace(/'/g, "''") + "'";
            var sPath = "/TripExtensions(personUserName=" + sUser + ",tripId=" + oRow.tripId + ")";
            var oEntityContext = oModel.bindContext(sPath).getBoundContext();
            var oOperation = oModel.bindContext("TripsService." + sAction + "(...)", oEntityContext);
            oOperation.execute().then(function () {
                MessageToast.show(that.getResourceBundle().getText("approvalActionDone"));
                // TripExtensions wordt live ingelezen → geen cache-evict nodig
                that._loadAllTrips();
            }).catch(function (oError) {
                Log.error("Action " + sAction + " failed", oError);
                MessageToast.show(that.getResourceBundle().getText("approvalActionError"));
            });
        },

        // ---- nieuwe trip aanmaken (alleen coordinator) ---------------------

        onCreateTrip: function () {
            var that = this;
            if (this._oCreateDialog) {
                this._resetCreateForm();
                this._oCreateDialog.open();
                return;
            }
            this.loadFragment({ name: "primepath.dashboard.view.CreateTripDialog" })
                .then(function (oDialog) {
                    that._oCreateDialog = oDialog;
                    oDialog.open();
                });
        },

        _resetCreateForm: function () {
            this.byId("tripEmployee").setSelectedKey("");
            this.byId("tripName").setValue("");
            this.byId("tripDestination").setValue("");
            this.byId("tripStartsAt").setDateValue(null);
            this.byId("tripEndsAt").setDateValue(null);
            this.byId("tripBudget").setValue("");
            this.byId("tripDescription").setValue("");
        },

        onSaveTrip: function () {
            var that = this;
            var oBundle = this.getResourceBundle();
            var sUser        = this.byId("tripEmployee").getSelectedKey();
            var sName        = this.byId("tripName").getValue().trim();
            var sDestination = this.byId("tripDestination").getValue().trim();
            var oStartsAt    = this.byId("tripStartsAt").getDateValue();
            var oEndsAt      = this.byId("tripEndsAt").getDateValue();
            var sBudget      = this.byId("tripBudget").getValue();
            var sDescription = this.byId("tripDescription").getValue().trim();

            if (!sUser || !sName || !oStartsAt || !oEndsAt) {
                MessageToast.show(oBundle.getText("allTripsValidation"));
                return;
            }
            if (oEndsAt < oStartsAt) {
                MessageToast.show("Einddatum moet na startdatum liggen.");
                return;
            }

            var oComp = this.getOwnerComponent();
            var mHeaders = { "Content-Type": "application/json", Accept: "application/json" };
            if (oComp._sAuthHeader) { mHeaders.Authorization = oComp._sAuthHeader; }

            var oBody = {
                personUserName: sUser,
                name:           sName,
                destination:    sDestination,
                startsAt:       oStartsAt.toISOString(),
                endsAt:         oEndsAt.toISOString(),
                budget:         sBudget ? parseFloat(sBudget) : null,
                description:    sDescription
            };

            fetch("/trips/OwnTrips", {
                method: "POST",
                headers: mHeaders,
                body: JSON.stringify(oBody)
            })
            .then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                return r.json();
            })
            .then(function () {
                that._oCreateDialog.close();
                MessageToast.show(oBundle.getText("allTripsCreated", [sName]));
                // nieuwe eigen-trip → gedeelde trip-cache evicten zodat de lijst hem toont
                delete oComp._mTripsCache[sUser];
                oComp._pTripData = null;
                that._loadAllTrips();
            })
            .catch(function (oError) {
                Log.error("Create trip failed", oError);
                MessageToast.show(oBundle.getText("allTripsCreateError"));
            });
        },

        onCancelTrip: function () {
            this._oCreateDialog.close();
        },

        onNavBack: function () {
            this.getRouter().navTo("employees");
        },

        onExit: function () {
            if (this._oCreateDialog) {
                this._oCreateDialog.destroy();
                this._oCreateDialog = null;
            }
        }
    });
});
