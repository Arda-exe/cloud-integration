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
            this.getView().setModel(new JSONModel({ airports: [], count: 0 }), "view");

            this._loadAirports();
            this.getView().addEventDelegate({ onAfterRendering: this._initMap.bind(this) });

            // bij terugkeer naar de tab heeft de (verborgen geweest) kaart een
            // size-recalculatie nodig
            this.getOwnerComponent().getRouter().getRoute("airports")
                .attachPatternMatched(this._onShown, this);
        },

        _loadAirports: function () {
            var that = this;
            var oModel = this.getOwnerComponent().getModel("airports");
            oModel.bindList("/Airports").requestContexts(0, 200).then(function (aContexts) {
                var aAirports = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });
                aAirports.sort(function (a, b) {
                    return a.Name < b.Name ? -1 : 1;
                });
                that._aAllAirports = aAirports;
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
            if (!this._oMap || !this._aAllAirports.length) {
                return;
            }
            var oMap = this._oMap;
            var aBounds = [];
            this._aAllAirports.forEach(function (oAirport) {
                // GeoJSON-volgorde is [lon, lat]; Leaflet verwacht [lat, lon]
                var aCoords = oAirport.Location.Loc.coordinates;
                var aLatLng = [aCoords[1], aCoords[0]];
                window.L.marker(aLatLng)
                    .bindPopup("<b>" + oAirport.Name + "</b><br>"
                        + oAirport.IataCode + " &middot; " + oAirport.Location.City.Name)
                    .addTo(oMap);
                aBounds.push(aLatLng);
            });
            oMap.fitBounds(aBounds, { padding: [30, 30] });
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
