sap.ui.define([
    "primepath/dashboard/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/base/Log",
    "primepath/dashboard/util/searchFilter",
    "primepath/dashboard/util/constants"
], function (BaseController, JSONModel, Log, searchFilter, constants) {
    "use strict";

    return BaseController.extend("primepath.dashboard.controller.Airports", {

        onInit: function () {
            this._aAllAirports = [];
            this._oMap = null;
            this._mMarkers = {};        // ICAO -> { marker, latlng }
            this._mAirportByIata = {};  // IATA -> airport-object (O(1) focus + zijpaneel)
            this._sPendingIata = null;
            this.getView().setModel(new JSONModel({
                airports: [],
                count: 0,
                selected: { has: false }
            }), "view");

            this._loadAirports();
            this.getView().addEventDelegate({ onAfterRendering: this._initMap.bind(this) });

            // bij terugkeer naar de tab heeft de (verborgen geweest) kaart een
            // size-recalculatie nodig
            var oRouter = this.getRouter();
            oRouter.getRoute("airports").attachPatternMatched(this._onShown, this);
            // cross-navigatie vanaf een vlucht: airports/{iata} → zoom in op die luchthaven
            oRouter.getRoute("airportFocus").attachPatternMatched(this._onFocusRoute, this);
        },

        _loadAirports: function () {
            var that = this;
            this.getOwnerComponent().getCachedList("airports", "/Airports").then(function (aAirports) {
                // kopie vóór sort — gedeelde cache-array niet muteren
                that._aAllAirports = aAirports.slice().sort(function (a, b) {
                    return a.Name < b.Name ? -1 : 1;
                });
                // IATA -> ICAO index voor O(1) focus (vervangt de lineaire .find)
                that._mAirportByIata = {};
                that._aAllAirports.forEach(function (oAirport) {
                    if (oAirport.IataCode) {
                        that._mAirportByIata[oAirport.IataCode.toUpperCase()] = oAirport;
                    }
                });
                that._applySearch();
                that._renderMarkers();
            }).catch(function (oError) {
                Log.error("Loading airports failed", oError);
            });
        },

        onSearch: function () {
            this._applySearch();
        },

        _applySearch: function () {
            var aAirports = searchFilter.filter(
                this._aAllAirports,
                this.byId("airportsSearch").getValue(),
                function (oAirport) {
                    return [oAirport.Name, oAirport.IataCode, oAirport.IcaoCode,
                        oAirport.Location.City.Name, oAirport.Location.City.CountryRegion];
                }
            );
            var oViewModel = this.getView().getModel("view");
            oViewModel.setProperty("/airports", aAirports);
            oViewModel.setProperty("/count", aAirports.length);
        },

        _initMap: function () {
            var oMapDiv = document.getElementById("airportsMap");
            if (this._oMap || !oMapDiv || !window.L) {
                return;
            }
            this._oMap = window.L.map("airportsMap").setView(constants.MAP_VIEW, constants.MAP_ZOOM);
            window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            }).addTo(this._oMap);
            this._renderMarkers();
        },

        _renderMarkers: function () {
            if (!this._oMap || !this._aAllAirports.length || this._bMarkersDone) {
                return;
            }
            this._bMarkersDone = true;
            var that = this;
            var oMap = this._oMap;
            var aBounds = [];
            this._aAllAirports.forEach(function (oAirport) {
                // GeoJSON-volgorde is [lon, lat]; Leaflet verwacht [lat, lon]
            var oLoc = oAirport.Location && oAirport.Location.Loc;
            if (!oLoc || !oLoc.coordinates) {
                return;
            }
            var aCoords = oLoc.coordinates;
            var aLatLng = [aCoords[1], aCoords[0]];
                var oMarker = window.L.marker(aLatLng)
                    .bindPopup("<b>" + oAirport.Name + "</b><br>"
                        + oAirport.IataCode + " &middot; " + oAirport.Location.City.Name)
                    .addTo(oMap);
                // klik op een pin → zelfde detailpaneel als een lijst-klik
                oMarker.on("click", function () { that._selectAndShow(oAirport); });
                this._mMarkers[oAirport.IcaoCode] = { marker: oMarker, latlng: aLatLng };
                aBounds.push(aLatLng);
            }, this);
            oMap.fitBounds(aBounds, { padding: [30, 30] });

            // een cross-navigatie die vóór het renderen van de markers binnenkwam,
            // is uitgesteld tot nu
            if (this._sPendingIata) {
                var sPending = this._sPendingIata;
                this._sPendingIata = null;
                this._focusByIata(sPending);
            }
        },

        // afkomstig van de airportFocus-route (airports/{iata}); PlanItems levert alleen
        // IATA, terwijl de markers op ICAO gesleuteld zijn → eerst IATA→ICAO opzoeken
        _onFocusRoute: function (oEvent) {
            this._onShown();
            this._focusByIata(oEvent.getParameter("arguments").iata);
        },

        _focusByIata: function (sIata) {
            if (!sIata) {
                return;
            }
            // markers nog niet klaar (koude deep-link) → onthouden en later in
            // _renderMarkers afhandelen
            if (!this._aAllAirports.length || !this._bMarkersDone) {
                this._sPendingIata = sIata;
                return;
            }
            var oAirport = this._mAirportByIata[sIata.toUpperCase()];
            if (oAirport) {
                this._selectAndShow(oAirport);
            }
        },

        onAirportPress: function (oEvent) {
            this._selectAndShow(oEvent.getSource().getBindingContext("view").getObject());
        },

        // selecteer + zoom in + toon het detailpaneel (lijst-klik, kaart-pin of deep-link)
        _selectAndShow: function (oAirport) {
            this._selectAirport(oAirport);
            this._focusAirport(oAirport.IcaoCode);
            this._showDetail();
        },

        _showDetail: function () {
            var oNav = this.byId("airportNav");
            var oDetail = this.byId("airportDetailPage");
            if (oNav && oDetail && oNav.getCurrentPage() !== oDetail) {
                oNav.to(oDetail.getId());
            }
        },

        // inzoomen op één luchthaven; ook hergebruikt door de global search (stap 3)
        _focusAirport: function (sIcao) {
            var oEntry = this._mMarkers[sIcao];
            if (oEntry && this._oMap) {
                this._oMap.setView(oEntry.latlng, constants.MAP_FOCUS_ZOOM);
                oEntry.marker.openPopup();
            }
        },

        _onShown: function () {
            this._invalidateMapSoon();
        },

        // de kaart heeft een size-herberekening nodig nadat hij verborgen was of nadat het
        // zijpaneel zijn breedte wijzigt (anders grijze tegels / verkeerde centrering)
        _invalidateMapSoon: function () {
            var oMap = this._oMap;
            if (oMap) {
                setTimeout(function () {
                    oMap.invalidateSize();
                }, 0);
            }
        },

        // ---- detail-zijpaneel voor de geselecteerde luchthaven --------------

        _selectAirport: function (oAirport) {
            var oVM = this.getView().getModel("view");
            var oLoc = oAirport.Location && oAirport.Location.Loc;
            var oCity = oAirport.Location && oAirport.Location.City;
            var sCoords = "";
            if (oLoc && oLoc.coordinates) {
                // GeoJSON [lon, lat] → toon "lat, lon"
                sCoords = oLoc.coordinates[1].toFixed(4) + ", " + oLoc.coordinates[0].toFixed(4);
            }
            oVM.setProperty("/selected", {
                has: true,
                busy: true,
                name: oAirport.Name,
                iata: oAirport.IataCode,
                icao: oAirport.IcaoCode,
                city: oCity ? oCity.Name : "",
                country: oCity ? oCity.CountryRegion : "",
                coords: sCoords,
                trafficText: "",
                trafficState: "None",
                flights: 0,
                trips: []
            });
            this._loadAirportStats(oAirport.IataCode);
        },

        // verkeerstatistieken uit het zware all-time aggregaat → progressief (busy op de stats),
        // zodat naam/codes/coördinaten meteen tonen
        _loadAirportStats: function (sIata) {
            var that = this;
            var oVM = this.getView().getModel("view");
            this.getOwnerComponent().getFlightAggregate().then(function (oAgg) {
                if (oVM.getProperty("/selected/iata") !== sIata) {
                    return;   // intussen een andere luchthaven geselecteerd
                }
                var mBy = oAgg.byAirport || {};
                var oStats = mBy[sIata];
                var oLevel = that._trafficLevel(mBy, sIata);
                var oBundle = that.getResourceBundle();
                oVM.setProperty("/selected/flights", oStats ? oStats.total : 0);
                // trips zijn al gegroepeerd per trip (ShareId); toon het aantal reizigers
                oVM.setProperty("/selected/trips", (oStats ? oStats.trips : []).map(function (t) {
                    return {
                        tripName: t.tripName,
                        user: t.user,
                        tripId: t.tripId,
                        travellersText: oBundle.getText("airportTripTravellers", [t.travellers])
                    };
                }));
                oVM.setProperty("/selected/trafficText", oBundle.getText(oLevel.key));
                oVM.setProperty("/selected/trafficState", oLevel.state);
                oVM.setProperty("/selected/busy", false);
            }).catch(function (oError) {
                Log.error("Loading airport stats failed", oError);
                oVM.setProperty("/selected/busy", false);
            });
        },

        // relatieve drukte t.o.v. de drukste luchthaven (robuust bij onvolledige paging-data)
        _trafficLevel: function (mByAirport, sIata) {
            var oStats = mByAirport[sIata];
            var iTotal = oStats ? oStats.total : 0;
            if (!iTotal) {
                return { key: "trafficLow", state: "Success" };
            }
            var iMax = 0;
            Object.keys(mByAirport).forEach(function (sK) {
                if (mByAirport[sK].total > iMax) {
                    iMax = mByAirport[sK].total;
                }
            });
            var fRatio = iMax ? iTotal / iMax : 0;
            if (fRatio >= 0.66) {
                return { key: "trafficHigh", state: "Information" };
            }
            if (fRatio >= 0.33) {
                return { key: "trafficMedium", state: "Warning" };
            }
            return { key: "trafficLow", state: "Success" };
        },

        onCloseAirportPanel: function () {
            this.getView().getModel("view").setProperty("/selected/has", false);
            var oNav = this.byId("airportNav");
            if (oNav) {
                oNav.back();
            }
        },

        onSelectedTripPress: function (oEvent) {
            var oTrip = oEvent.getSource().getBindingContext("view").getObject();
            this.getRouter().navTo("trip", { userName: oTrip.user, tripId: oTrip.tripId });
        }

    });
});
