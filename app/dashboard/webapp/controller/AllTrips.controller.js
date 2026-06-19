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
                newFlights: [], airports: [], airlines: [],
                // create-dialog: gedeeld budget (AAN) of één bedrag per gekozen medewerker (UIT)
                budgetSame: true, perEmployeeBudgets: []
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

            Promise.all([
                oComp.getTripData(),
                oComp.getTripExtensions()
            ]).then(function (aResults) {
                var aPerPerson = aResults[0];
                var mExt = aResults[1] || {};

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
                    var oComp = that.getOwnerComponent();
                    oComp.getModel("trips")
                        .bindList("/TripExtensions")
                        .create({ personUserName: oRow.userName, tripId: oRow.tripId })
                        .created().then(function () {
                            MessageToast.show(oBundle.getText("approvalSubmitted"));
                            // nieuwe TripExtension (notsubmitted → pending) → map + aggregaat evicten
                            oComp._pTripExt = null;
                            oComp._pFlightAgg = null;
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
            var mHeaders = oComp._fetchHeaders({ "Content-Type": "application/json", Accept: "application/json" });

            fetch("/trips/OwnTrips('" + oRow.rawUuid + "')", {
                method: "PATCH",
                headers: mHeaders,
                body: JSON.stringify({ approvalStatus: sStatus })
            })
            .then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                MessageToast.show(that.getResourceBundle().getText("approvalActionDone"));
                // eigen-trip status leeft in de gedeelde trip-cache → trip- én vlucht-aggregaten
                // evicten zodat Overview/Employees/Airports de nieuwe status meteen meenemen
                delete oComp._mTripsCache[oRow.userName];
                oComp._pTripData = null;
                oComp._pFlightData = null;
                oComp._pFlightAgg = null;
                oComp._pTripExt = null;
                that._loadAllTrips();
            })
            .catch(function (oError) {
                Log.error("Patch own trip status failed", oError);
                MessageToast.show(that.getResourceBundle().getText("approvalActionError"));
            });
        },

        _invokeExtAction: function (oRow, sAction) {
            var that = this;
            var oComp = this.getOwnerComponent();
            var oModel = oComp.getModel("trips");
            var sUser = "'" + String(oRow.userName).replace(/'/g, "''") + "'";
            var sPath = "/TripExtensions(personUserName=" + sUser + ",tripId=" + oRow.tripId + ")";
            var oEntityContext = oModel.bindContext(sPath).getBoundContext();
            var oOperation = oModel.bindContext("TripsService." + sAction + "(...)", oEntityContext);
            oOperation.execute().then(function () {
                MessageToast.show(that.getResourceBundle().getText("approvalActionDone"));
                // de goedkeuringsstatus is gewijzigd → de gememoïseerde TripExtensions-map en het
                // vlucht-aggregaat evicten zodat Overview/Employees/Airports meteen kloppen
                oComp._pTripExt = null;
                oComp._pFlightAgg = null;
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
            this.byId("tripEmployees").setSelectedKeys([]);
            this.byId("tripName").setValue("");
            this.byId("tripDestination").setValue("");
            this.byId("tripStartsAt").setDateValue(null);
            this.byId("tripEndsAt").setDateValue(null);
            this.byId("tripBudgetSame").setSelected(true);
            this.byId("tripBudget").setValue("");
            this.byId("tripBudget").setValueState("None");
            this.byId("tripDescription").setValue("");
            // wachtrij + per-medewerker budgetrijen leegmaken; terug naar gedeeld budget
            // (verse arrays → cache-safe)
            var oVM = this.getView().getModel("view");
            oVM.setProperty("/newFlights", []);
            oVM.setProperty("/budgetSame", true);
            oVM.setProperty("/perEmployeeBudgets", []);
        },

        // rode budget-foutstaat opheffen zodra de coordinator het veld bijwerkt
        onBudgetLiveChange: function () {
            this.byId("tripBudget").setValueState("None");
        },

        // medewerkerselectie gewijzigd → de per-medewerker budgetrijen mee laten lopen, zodat ze
        // klaarstaan zodra de coordinator naar "budget per reiziger" wisselt
        onTripEmployeesChange: function () {
            this._syncPerEmployeeBudgets();
        },

        // checkbox "zelfde budget voor iedereen": AAN = één gedeeld veld; UIT = één veld per
        // gekozen medewerker (rijen opnieuw opbouwen uit de huidige selectie)
        onToggleBudgetSame: function (oEvent) {
            var bSame = oEvent.getParameter("selected");
            this.getView().getModel("view").setProperty("/budgetSame", bSame);
            if (!bSame) { this._syncPerEmployeeBudgets(); }
        },

        // de per-medewerker budgetrijen synchroniseren met de huidige MultiComboBox-selectie.
        // Reeds ingevoerde budgetten behouden (op UserName) zodat (de)selecteren niets wist.
        _syncPerEmployeeBudgets: function () {
            var oVM = this.getView().getModel("view");
            var aKeys = this.byId("tripEmployees").getSelectedKeys();
            var aEmployees = oVM.getProperty("/employees") || [];
            var aPrev = oVM.getProperty("/perEmployeeBudgets") || [];
            var mPrev = {};
            aPrev.forEach(function (o) { mPrev[o.UserName] = o.budget; });
            var aRows = aKeys.map(function (sKey) {
                var oEmp = aEmployees.filter(function (e) { return e.UserName === sKey; })[0];
                return {
                    UserName: sKey,
                    fullName: oEmp ? oEmp.fullName : sKey,
                    budget:   mPrev[sKey] !== undefined ? mPrev[sKey] : ""
                };
            });
            oVM.setProperty("/perEmployeeBudgets", aRows);
        },

        onSaveTrip: function () {
            var that = this;
            var oBundle = this.getResourceBundle();
            var oVM = this.getView().getModel("view");
            var aUsers       = this.byId("tripEmployees").getSelectedKeys();
            var sName        = this.byId("tripName").getValue().trim();
            var sDestination = this.byId("tripDestination").getValue().trim();
            var oStartsAt    = this.byId("tripStartsAt").getDateValue();
            var oEndsAt      = this.byId("tripEndsAt").getDateValue();
            var sDescription = this.byId("tripDescription").getValue().trim();
            var bSame        = oVM.getProperty("/budgetSame");

            if (!aUsers.length || !sName || !oStartsAt || !oEndsAt) {
                MessageToast.show(oBundle.getText("allTripsValidation"));
                return;
            }
            if (oEndsAt < oStartsAt) {
                MessageToast.show(oBundle.getText("allTripsEndBeforeStart"));
                return;
            }

            // budget per medewerker bepalen: gedeeld (één veld) of per-medewerker (rijen). Een
            // ingevuld budget moet een geldig niet-negatief getal zijn (anders sloeg parseFloat("abc")
            // stil null op) → blokkeren met veld-feedback.
            var mBudgetByUser = this._collectBudgets(aUsers, bSame);
            if (!mBudgetByUser) { return; }   // validatie faalde (toast/veldstaat al gezet)

            var oComp = this.getOwnerComponent();
            var mHeaders = oComp._fetchHeaders({ "Content-Type": "application/json", Accept: "application/json" });

            // één gedeeld shareId over alle kopieën → util/tripGroups groepeert ze tot één trip
            var sShareId = this._uuid();
            // snapshot van de wachtrij: vluchten worden ÉÉN keer geboekt op de representatieve kopie
            // (gedeeld over de reizigers) — niet per medewerker, anders dubbeltellen de aggregaten
            var aQueuedFlights = (oVM.getProperty("/newFlights") || []).slice();

            var fnBody = function (sUser) {
                var nBudget = mBudgetByUser[sUser];
                return {
                    personUserName: sUser,
                    name:           sName,
                    destination:    sDestination,
                    startsAt:       oStartsAt.toISOString(),
                    endsAt:         oEndsAt.toISOString(),
                    budget:         (nBudget !== null && nBudget !== undefined) ? nBudget : null,
                    description:    sDescription,
                    shareId:        sShareId
                };
            };
            var fnPostTrip = function (sUser) {
                return fetch("/trips/OwnTrips", {
                    method: "POST", headers: mHeaders, body: JSON.stringify(fnBody(sUser))
                }).then(function (r) {
                    if (!r.ok) { throw new Error("HTTP " + r.status); }
                    return r.json();
                });
            };

            // 1) representatieve kopie (eerste medewerker) eerst → we hebben zijn tripId nodig om de
            //    gedeelde vluchten aan te koppelen. Faalt deze, dan faalt de hele aanmaak (catch).
            var sFirstUser = aUsers[0];
            fnPostTrip(sFirstUser).then(function (oCreated) {
                var sRepTripId = oCreated.tripId;
                // 2) vluchten één keer boeken op de representatieve trip. allSettled (geen client-side
                //    transactie): één gefaalde vlucht mag de trip niet ongedaan maken.
                var pFlights = Promise.allSettled(aQueuedFlights.map(function (oFlight) {
                    return fetch("/trips/OwnFlights", {
                        method: "POST", headers: mHeaders,
                        body: JSON.stringify({
                            tripId:       sRepTripId,
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
                // 3) de overige kopieën (zelfde shareId, eigen budget) — vluchten NIET dupliceren
                var pOthers = Promise.allSettled(aUsers.slice(1).map(fnPostTrip));
                return Promise.all([pFlights, pOthers]);
            })
            .then(function (aResults) {
                var iFlightsFailed = (aResults[0] || []).filter(function (o) { return o.status === "rejected"; }).length;
                var iCopiesFailed  = (aResults[1] || []).filter(function (o) { return o.status === "rejected"; }).length;
                that._oCreateDialog.close();
                if (iCopiesFailed > 0) {
                    MessageToast.show(oBundle.getText("allTripsCreatedCopiesPartial", [sName, iCopiesFailed]));
                } else if (iFlightsFailed > 0) {
                    MessageToast.show(oBundle.getText("allTripsCreatedFlightsPartial", [sName, iFlightsFailed]));
                } else {
                    MessageToast.show(oBundle.getText("allTripsCreated", [sName]));
                }
                // nieuwe eigen-trip(s) + vluchten → trip- én vlucht-caches voor ALLE betrokken
                // medewerkers evicten zodat de lijst, trip-detail én de Overview/Airports-aggregaten
                // alles meteen meenemen
                aUsers.forEach(function (sUser) { delete oComp._mTripsCache[sUser]; });
                oComp._pTripData = null;
                oComp._pFlightData = null;
                oComp._pFlightAgg = null;
                oComp._pTripExt = null;
                that._loadAllTrips();
            })
            .catch(function (oError) {
                Log.error("Create trip failed", oError);
                MessageToast.show(oBundle.getText("allTripsCreateError"));
            });
        },

        // het budget per gekozen medewerker bepalen + valideren. Gedeeld (bSame) → het ene veld op
        // iedereen; anders → per-medewerker rijen. Retourneert { userName: number|null } of null bij
        // een ongeldig (niet-numeriek/negatief) budget (toast + veldstaat al gezet).
        _collectBudgets: function (aUsers, bSame) {
            var oBundle = this.getResourceBundle();
            var fnParse = function (sRaw) {
                var s = String(sRaw == null ? "" : sRaw).trim();
                if (s === "") { return null; }
                if (!isFinite(Number(s)) || Number(s) < 0) { return undefined; } // ongeldig
                return parseFloat(s);
            };
            var mBudgetByUser = {};
            if (bSame) {
                var oBudgetInput = this.byId("tripBudget");
                oBudgetInput.setValueState("None");
                var nShared = fnParse(oBudgetInput.getValue());
                if (nShared === undefined) {
                    oBudgetInput.setValueState("Error");
                    oBudgetInput.setValueStateText(oBundle.getText("budgetInvalid"));
                    MessageToast.show(oBundle.getText("budgetInvalid"));
                    return null;
                }
                aUsers.forEach(function (sUser) { mBudgetByUser[sUser] = nShared; });
            } else {
                var aRows = this.getView().getModel("view").getProperty("/perEmployeeBudgets") || [];
                var bInvalid = false;
                aRows.forEach(function (oRow) {
                    var n = fnParse(oRow.budget);
                    if (n === undefined) { bInvalid = true; n = null; }
                    mBudgetByUser[oRow.UserName] = n;
                });
                if (bInvalid) {
                    MessageToast.show(oBundle.getText("budgetInvalid"));
                    return null;
                }
            }
            return mBudgetByUser;
        },

        // een shareId genereren (RFC4122 v4). crypto.randomUUID is beschikbaar op localhost/https;
        // fallback voor oudere/onveilige contexten.
        _uuid: function () {
            if (window.crypto && window.crypto.randomUUID) { return window.crypto.randomUUID(); }
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0;
                return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
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
            this._openFlightDialog(null);
        },

        // retourvlucht: open de vlucht-dialoog met enkel de luchthavens OMGEKEERD voorgevuld
        // (heen→terug); nummer, stoel en de vertrek-/aankomsttijden vult de gebruiker zelf in.
        onAddReturnFlight: function (oEvent) {
            var oFlight = oEvent.getSource().getBindingContext("view").getObject();
            // omgekeerde richting: bestemming → vertrek (de namen worden in onConfirmFlight opnieuw
            // afgeleid uit de luchthavenlijst, dus hier volstaan de IATA-codes)
            this._openFlightDialog({ fromIata: oFlight.toIata, toIata: oFlight.fromIata });
        },

        // de vlucht-dialoog openen. mPrefill (optioneel) vult enkel From/To voor — gebruikt voor de
        // retourvlucht; de luchthaven-lijsten zijn dan al geladen (er is al een vlucht toegevoegd),
        // dus setSelectedKey toont meteen het juiste label.
        _openFlightDialog: function (mPrefill) {
            var that = this;
            this._ensureFlightLists();
            var fnOpen = function () {
                that._resetFlightForm();
                if (mPrefill) {
                    that.byId("flFrom").setSelectedKey(mPrefill.fromIata);
                    that.byId("flTo").setSelectedKey(mPrefill.toIata);
                }
                that._oAddFlightDialog.open();
            };
            if (this._oAddFlightDialog) {
                fnOpen();
                return;
            }
            this.loadFragment({ name: "primepath.dashboard.view.AddFlightDialog" })
                .then(function (oDialog) {
                    that._oAddFlightDialog = oDialog;
                    fnOpen();
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

        // vertrek gewijzigd en aankomst nog leeg → aankomst voorvullen met dezelfde datum+tijd,
        // zodat de gebruiker enkel de aankomsttijd hoeft aan te passen. Een reeds ingevulde aankomst
        // NIET overschrijven; de aankomstdatum blijft vrij bewerkbaar voor overnacht-vluchten.
        onFlightDepChange: function () {
            var oDep = this.byId("flDep").getDateValue();
            var oArr = this.byId("flArr");
            if (oDep && !oArr.getDateValue()) {
                oArr.setDateValue(new Date(oDep.getTime()));
                oArr.setValueState("None");
            }
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
