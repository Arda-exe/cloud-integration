sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/base/Log"
], function (Controller, JSONModel, Log) {
    "use strict";

    return Controller.extend("primepath.dashboard.controller.Airports", {

        onInit: function () {
            this._aAllAirports = [];
            this._oMap = null;
            this._mMarkers = {};
            this._sPendingIata = null;
            this.getView().setModel(new JSONModel({ airports: [], count: 0 }), "view");

            this._loadAirports();
            this.getView().addEventDelegate({ onAfterRendering: this._initMap.bind(this) });

            // bij terugkeer naar de tab heeft de (verborgen geweest) kaart een
            // size-recalculatie nodig
            var oRouter = this.getOwnerComponent().getRouter();
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
            var sQuery = (this.byId("airportsSearch").getValue() || "").toLowerCase();
            var aAirports = this._aAllAirports;
            if (sQuery) {
                aAirports = aAirports.filter(function (oAirport) {
                    return [oAirport.Name, oAirport.IataCode, oAirport.IcaoCode,
                        oAirport.Location.City.Name, oAirport.Location.City.CountryRegion]
                        .some(function (sField) {
                            return (sField || "").toLowerCase().indexOf(sQuery) !== -1;
                        });
                });
            }
            var oViewModel = this.getView().getModel("view");
            oViewModel.setProperty("/airports", aAirports);
            oViewModel.setProperty("/count", aAirports.length);
        },

        _initMap: function () {
            var oMapDiv = document.getElementById("airportsMap");
            if (this._oMap || !oMapDiv || !window.L) {
                return;
            }
            this._oMap = window.L.map("airportsMap").setView([20, 0], 2);
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
            var sUpper = sIata.toUpperCase();
            var oAirport = this._aAllAirports.find(function (oCandidate) {
                return (oCandidate.IataCode || "").toUpperCase() === sUpper;
            });
            if (oAirport) {
                this._focusAirport(oAirport.IcaoCode);
            }
        },

        onAirportPress: function (oEvent) {
            var oAirport = oEvent.getSource().getBindingContext("view").getObject();
            this._focusAirport(oAirport.IcaoCode);
        },

        // inzoomen op één luchthaven; ook hergebruikt door de global search (stap 3)
        _focusAirport: function (sIcao) {
            var oEntry = this._mMarkers[sIcao];
            if (oEntry && this._oMap) {
                this._oMap.setView(oEntry.latlng, 9);
                oEntry.marker.openPopup();
            }
        },

        _onShown: function () {
            if (this._oMap) {
                var oMap = this._oMap;
                setTimeout(function () {
                    oMap.invalidateSize();
                }, 0);
            }
        }

    });
});
