sap.ui.define([], function () {
    "use strict";

    // Snelkeuze-periodes voor de dashboards (Overview + EmployeeDetail). Relatief t.o.v.
    // vandaag; "all" (of een onbekende sleutel) → null = all-time (geen filter).
    // NB: TripPin's demo-data is grotendeels ~2014, dus de relatieve keuzes zijn op de
    // huidige data vaak leeg — "All time" toont alles (zie CLAUDE.md data-caveats).
    function rangeFor(sKey) {
        var oFrom = new Date();
        switch (sKey) {
            case "month":
                oFrom.setMonth(oFrom.getMonth() - 1);
                break;
            case "quarter":
                oFrom.setMonth(oFrom.getMonth() - 3);
                break;
            case "year":
                oFrom.setFullYear(oFrom.getFullYear() - 1);
                break;
            default:
                return null;   // "all" of onbekend
        }
        return { from: oFrom, to: new Date() };
    }

    return { rangeFor: rangeFor };
});
