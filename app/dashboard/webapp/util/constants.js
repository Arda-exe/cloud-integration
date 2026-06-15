sap.ui.define([], function () {
    "use strict";

    // App-brede constanten, gecentraliseerd zodat paginagroottes en kaart-instellingen
    // op één plek staan i.p.v. verspreid over Component/controllers.
    return {
        // requestContexts paginagroottes (backend volgt @odata.nextLink nog niet → één pagina)
        PAGE_SIZE_LIST: 500,
        PAGE_SIZE_TRIPS: 200,
        PAGE_SIZE_FLIGHTS: 200,

        // hoeveel items een "top N"-lijst toont (Overview top travellers/airlines/routes)
        TOP_N: 5,

        // Leaflet-kaart (Airports-tab)
        MAP_VIEW: [20, 0],
        MAP_ZOOM: 2,
        MAP_FOCUS_ZOOM: 9,

        // milliseconden per dag — voor datumvergelijkingen (periodefilter, locatie-op-datum)
        MS_PER_DAY: 24 * 60 * 60 * 1000
    };
});
