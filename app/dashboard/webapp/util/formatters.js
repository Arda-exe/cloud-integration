sap.ui.define([
    "sap/ui/core/format/DateFormat"
], function (DateFormat) {
    "use strict";

    // Gedeelde, stateless formatters. Controllers wijzen ze toe als methode
    // (formatEmails: formatters.formatEmails) zodat de bestaande ".formatEmails"-
    // bindings in de XML-views blijven werken. Geen van deze functies gebruikt `this`.
    var oDateFormat = DateFormat.getDateInstance({ style: "medium" });

    return {

        // Emails is een collectie → joinen tot één leesbare string
        formatEmails: function (aEmails) {
            return Array.isArray(aEmails) ? aEmails.join(", ") : "";
        },

        // Thuisbasis uit AddressInfo[0].City
        formatCity: function (aAddressInfo) {
            var oCity = Array.isArray(aAddressInfo) && aAddressInfo[0] && aAddressInfo[0].City;
            return oCity ? oCity.Name + ", " + oCity.CountryRegion : "";
        },

        // Periode "start – einde" (medium datumstijl)
        formatPeriod: function (sStartsAt, sEndsAt) {
            if (!sStartsAt || !sEndsAt) {
                return "";
            }
            return oDateFormat.format(new Date(sStartsAt)) + " – "
                + oDateFormat.format(new Date(sEndsAt));
        }
    };
});
