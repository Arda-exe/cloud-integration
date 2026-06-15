sap.ui.define([], function () {
    "use strict";

    // Eén client-side "bevat"-filter, gedeeld door Employees, Airports en de global search.
    // Vervangt drie bijna-identieke kopieën (één miste .trim()). Client-side omdat de backend
    // $filter nog negeert (backend issue 2).
    return {

        // aList     : de volledige lijst
        // sQuery    : zoekterm (wordt lowercased + getrimd)
        // fnFields  : (oItem) => [veld, veld, ...] — de te doorzoeken velden per item
        // → nieuwe gefilterde array (muteert de invoer niet)
        filter: function (aList, sQuery, fnFields) {
            var sNeedle = (sQuery || "").toLowerCase().trim();
            if (!sNeedle) {
                return aList.slice();
            }
            return aList.filter(function (oItem) {
                return fnFields(oItem).some(function (sField) {
                    return (sField || "").toLowerCase().indexOf(sNeedle) !== -1;
                });
            });
        }
    };
});
