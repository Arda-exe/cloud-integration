sap.ui.define([], function () {
    "use strict";

    // Eén bron van waarheid voor de goedkeuringsstatus van een trip. Model-vrij (geen UI5/i18n) →
    // gedeeld door de tellende lagen (Aggregate, status-badges, tegels) én de groepering
    // (tripGroups). De afleiding zat eerder inline in tripGroups.js.
    //
    //   oTrip     : trip uit getTripData (eigen trip draagt approvalStatus + _isOwn;
    //               TripPin-trip heeft alleen TripId)
    //   sUserName : person.UserName (voor de TripPin ext-lookup)
    //   mExt      : { "userName|tripId": status }  (live /TripExtensions, alleen TripPin)
    //
    // Statuswaarden (lowercase): "approved" | "pending" | "rejected" | "notsubmitted".
    function statusKey(oTrip, sUserName, mExt) {
        mExt = mExt || {};
        return oTrip._isOwn
            ? (oTrip.approvalStatus || "pending")
            : (mExt[sUserName + "|" + oTrip.TripId] || "notsubmitted");
    }

    // TELLINGEN (KPI's, status-badges, traffic, tegels): enkel goedgekeurd telt mee.
    function isApproved(sStatusKey) {
        return sStatusKey === "approved";
    }

    // BUDGET-totalen op de beheer-views (All Trips / Trip detail): goedgekeurd + in behandeling;
    // afgekeurd én niet-ingediend tellen NIET mee.
    function countsInBudget(sStatusKey) {
        return sStatusKey === "approved" || sStatusKey === "pending";
    }

    return {
        statusKey: statusKey,
        isApproved: isApproved,
        countsInBudget: countsInBudget
    };
});
