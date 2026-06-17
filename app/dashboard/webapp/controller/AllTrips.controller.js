sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/base/Log",
    "primepath/dashboard/util/formatters",
    "primepath/dashboard/util/searchFilter",
    "primepath/dashboard/util/tripGroups",
    "sap/ui/core/format/DateFormat"
], function (BaseController, JSONModel, MessageToast, MessageBox, Log, formatters, searchFilter, tripGroups, DateFormat) {
    "use strict";

    // goedkeuringsstatus → kleur (sap.ui.core.ValueState) + i18n-sleutel
    var STATUS_STATE = { approved: "Success", rejected: "Error", pending: "Warning" };
    var STATUS_TEXT_KEY = { approved: "appr_approved", rejected: "appr_rejected", pending: "appr_pending" };

    return BaseController.extend("primepath.dashboard.controller.AllTrips", {

        onInit: function () {
            this._aAllGroups = [];
            this._oCreateDialog = null;
            this._oAddFlightDialog = null;
            this._bFlightListsLoaded = false;
            this._oDateTimeFormat = DateFormat.getDateTimeInstance({ style: "medium" });
            this.getView().setModel(new JSONModel({
                groups: [], count: 0, busy: true, employees: [],
                newFlights: [], airports: [], airlines: []
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
            this.byId("tripBudget").setValueState("None");
            this.byId("tripDescription").setValue("");
            // wachtrij met toe te voegen vluchten leegmaken (verse array → cache-safe)
            this.getView().getModel("view").setProperty("/newFlights", []);
        },

        // rode budget-foutstaat opheffen zodra de coordinator het veld bijwerkt
        onBudgetLiveChange: function () {
            this.byId("tripBudget").setValueState("None");
        },

        onSaveTrip: function () {
            var that = this;
            var oBundle = this.getResourceBundle();
            var oBudgetInput = this.byId("tripBudget");
            var sUser        = this.byId("tripEmployee").getSelectedKey();
            var sName        = this.byId("tripName").getValue().trim();
            var sDestination = this.byId("tripDestination").getValue().trim();
            var oStartsAt    = this.byId("tripStartsAt").getDateValue();
            var oEndsAt      = this.byId("tripEndsAt").getDateValue();
            var sBudget      = oBudgetInput.getValue().trim();
            var sDescription = this.byId("tripDescription").getValue().trim();

            if (!sUser || !sName || !oStartsAt || !oEndsAt) {
                MessageToast.show(oBundle.getText("allTripsValidation"));
                return;
            }
            if (oEndsAt < oStartsAt) {
                MessageToast.show("Einddatum moet na startdatum liggen.");
                return;
            }
            // budget is optioneel, maar als ingevuld moet het een geldig niet-negatief getal zijn
            // (anders zou parseFloat("abc") stil null opslaan) → blokkeren met veld-feedback
            oBudgetInput.setValueState("None");
            if (sBudget !== "" && (!isFinite(Number(sBudget)) || Number(sBudget) < 0)) {
                oBudgetInput.setValueState("Error");
                oBudgetInput.setValueStateText(oBundle.getText("budgetInvalid"));
                MessageToast.show(oBundle.getText("budgetInvalid"));
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

            // snapshot van de wachtrij: pas POSTen zodra we de trip-UUID hebben
            var aQueuedFlights = (this.getView().getModel("view").getProperty("/newFlights") || []).slice();

            fetch("/trips/OwnTrips", {
                method: "POST",
                headers: mHeaders,
                body: JSON.stringify(oBody)
            })
            .then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                return r.json();
            })
            .then(function (oCreated) {
                // elke vlucht is een losse OwnFlight gekoppeld via tripId (de nieuwe UUID).
                // allSettled (geen client-side transactie): één gefaalde vlucht mag de trip
                // niet ongedaan maken → we tellen mislukkingen en melden ze.
                var sNewTripId = oCreated.tripId;
                return Promise.allSettled(aQueuedFlights.map(function (oFlight) {
                    return fetch("/trips/OwnFlights", {
                        method: "POST",
                        headers: mHeaders,
                        body: JSON.stringify({
                            tripId:       sNewTripId,
                            flightNumber: oFlight.flightNumber,
                            airlineName:  oFlight.airlineName,
                            seatNumber:   oFlight.seatNumber,
                            startsAt:     oFlight.startsAt,
                            endsAt:       oFlight.endsAt,
                            fromIata:     oFlight.fromIata,
                            fromName:     oFlight.fromName,
                            toIata:       oFlight.toIata,
                            toName:       oFlight.toName
                        })
                    }).then(function (r) {
                        if (!r.ok) { throw new Error("HTTP " + r.status); }
                        return r.json();
                    });
                }));
            })
            .then(function (aSettled) {
                var iFailed = (aSettled || []).filter(function (o) { return o.status === "rejected"; }).length;
                that._oCreateDialog.close();
                if (iFailed > 0) {
                    MessageToast.show(oBundle.getText("allTripsCreatedFlightsPartial", [sName, iFailed]));
                } else {
                    MessageToast.show(oBundle.getText("allTripsCreated", [sName]));
                }
                // nieuwe eigen-trip + vluchten → trip- én vlucht-caches evicten zodat de lijst,
                // trip-detail én de Overview/Airports-aggregaten alles meteen meenemen
                delete oComp._mTripsCache[sUser];
                oComp._pTripData = null;
                oComp._pFlightData = null;
                oComp._pFlightAgg = null;
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

        // ---- vluchten toevoegen aan de nieuwe trip -------------------------

        // luchthaven-/airline-lijsten éénmalig in het view-model laden (voor de ComboBoxes).
        // Hergebruikt de gememoïseerde getCachedList → meestal al geladen, dus near-instant.
        _ensureFlightLists: function () {
            if (this._bFlightListsLoaded) { return; }
            var that = this;
            var oComp = this.getOwnerComponent();
            var oVM = this.getView().getModel("view");
            Promise.all([
                oComp.getCachedList("airports", "/Airports"),
                oComp.getCachedList("airlines", "/Airlines")
            ]).then(function (aResults) {
                var aAirports = aResults[0].map(function (o) {
                    return { IataCode: o.IataCode, Name: o.Name, label: o.Name + " (" + o.IataCode + ")" };
                }).sort(function (a, b) { return a.label < b.label ? -1 : 1; });
                var aAirlines = aResults[1].map(function (o) {
                    return { AirlineCode: o.AirlineCode, Name: o.Name };
                }).sort(function (a, b) { return (a.Name || "") < (b.Name || "") ? -1 : 1; });
                oVM.setProperty("/airports", aAirports);
                oVM.setProperty("/airlines", aAirlines);
                that._bFlightListsLoaded = true;
            }).catch(function (oError) {
                Log.error("Loading airport/airline lists failed", oError);
            });
        },

        onAddFlight: function () {
            var that = this;
            this._ensureFlightLists();
            if (this._oAddFlightDialog) {
                this._resetFlightForm();
                this._oAddFlightDialog.open();
                return;
            }
            this.loadFragment({ name: "primepath.dashboard.view.AddFlightDialog" })
                .then(function (oDialog) {
                    that._oAddFlightDialog = oDialog;
                    that._resetFlightForm();
                    oDialog.open();
                });
        },

        _resetFlightForm: function () {
            this.byId("flFrom").setSelectedKey("");
            this.byId("flFrom").setValue("");
            this.byId("flTo").setSelectedKey("");
            this.byId("flTo").setValue("");
            this.byId("flAirline").setSelectedKey("");
            this.byId("flAirline").setValue("");
            this.byId("flNumber").setValue("");
            this.byId("flSeat").setValue("");
            this.byId("flDep").setDateValue(null);
            this.byId("flArr").setDateValue(null);
            ["flFrom", "flTo", "flAirline", "flDep", "flArr"].forEach(function (sId) {
                this.byId(sId).setValueState("None");
            }, this);
        },

        onConfirmFlight: function () {
            var oBundle = this.getResourceBundle();
            var oVM = this.getView().getModel("view");

            var sFromIata = this.byId("flFrom").getSelectedKey();
            var sToIata   = this.byId("flTo").getSelectedKey();
            var sAirline  = this.byId("flAirline").getValue().trim();   // vrije tekst toegestaan
            var sAirCode  = this.byId("flAirline").getSelectedKey();
            var sNumber   = this.byId("flNumber").getValue().trim();
            var sSeat     = this.byId("flSeat").getValue().trim();
            var oDep      = this.byId("flDep").getDateValue();
            var oArr      = this.byId("flArr").getDateValue();

            // veld-feedback (rood) op de ontbrekende/ongeldige velden i.p.v. enkel een toast.
            // aankomst is ongeldig als ze leeg is of vóór vertrek ligt.
            var bArrInvalid = !oArr || (oDep && oArr < oDep);
            this.byId("flFrom").setValueState(sFromIata ? "None" : "Error");
            this.byId("flTo").setValueState(sToIata ? "None" : "Error");
            this.byId("flAirline").setValueState(sAirline ? "None" : "Error");
            this.byId("flDep").setValueState(oDep ? "None" : "Error");
            this.byId("flArr").setValueState(bArrInvalid ? "Error" : "None");
            if (!sFromIata || !sToIata || !sAirline || !oDep || bArrInvalid) {
                MessageToast.show(oBundle.getText("addFlightValidation"));
                return;
            }

            // luchthaven-naam opzoeken (ComboBox-key is alleen de IATA) — Top Routes en de
            // routeblok-labels gebruiken fromName/toName
            var aAirports = oVM.getProperty("/airports") || [];
            var fnName = function (sIata) {
                var oMatch = aAirports.filter(function (a) { return a.IataCode === sIata; })[0];
                return oMatch ? oMatch.Name : sIata;
            };

            var oFlight = {
                fromIata:     sFromIata,
                fromName:     fnName(sFromIata),
                toIata:       sToIata,
                toName:       fnName(sToIata),
                airlineName:  sAirline,
                airlineCode:  sAirCode,
                flightNumber: sNumber,
                seatNumber:   sSeat,
                startsAt:     oDep.toISOString(),
                endsAt:       oArr.toISOString(),
                // weergave in de wachtrij-lijst
                summary:      sFromIata + " → " + sToIata,
                detail:       (sAirline ? sAirline + " " : "") + sNumber + " · " + this._oDateTimeFormat.format(oDep)
            };

            // cache-safe: verse array, bestaande niet muteren
            var aQueue = (oVM.getProperty("/newFlights") || []).slice();
            aQueue.push(oFlight);
            oVM.setProperty("/newFlights", aQueue);

            this._oAddFlightDialog.close();
        },

        onCancelFlight: function () {
            this._oAddFlightDialog.close();
        },

        onRemoveQueuedFlight: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var iIndex = parseInt(oItem.getBindingContext("view").getPath().split("/").pop(), 10);
            var oVM = this.getView().getModel("view");
            var aQueue = (oVM.getProperty("/newFlights") || []).slice();
            aQueue.splice(iIndex, 1);
            oVM.setProperty("/newFlights", aQueue);
        },

        onNavBack: function () {
            this.getRouter().navTo("employees");
        },

        onExit: function () {
            if (this._oCreateDialog) {
                this._oCreateDialog.destroy();
                this._oCreateDialog = null;
            }
            if (this._oAddFlightDialog) {
                this._oAddFlightDialog.destroy();
                this._oAddFlightDialog = null;
            }
        }
    });
});
