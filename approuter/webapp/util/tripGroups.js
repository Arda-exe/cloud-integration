sap.ui.define([
    "primepath/dashboard/util/approval"
], function (approval) {
    "use strict";

    // Zuivere groepering van trip-KOPIEËN tot één "echte" trip. Een gedeelde TripPin-trip
    // bestaat als kopie-per-persoon: eigen TripId, gedeelde ShareId, eigen Budget. Deze util
    // voegt die kopieën samen op ShareId → één groep met een lid per reiziger. Eigen trips
    // (geen ShareId) en niet-gedeelde TripPin-trips worden een groep van één.
    //
    // Model-vrij (geen UI5/i18n/formatters) en CACHE-SAFE: leest alleen oTrip.*/person.* en
    // bouwt VERSE objecten → muteert de gedeelde getTripData-cache nooit. De consument voegt
    // periode + statusteksten toe.
    //
    //   aPerPerson : [{ person, trips }]            (Component.getTripData)
    //   mExt       : { "userName|tripId": status }  (live TripExtensions, alleen TripPin)
    // → [ {
    //       groupKey, shareId, isOwn, tripName, startsAt, endsAt,
    //       totalBudget, travellerNames, travellerCount,
    //       repUserName, repTripId,                 // eerste kopie → trip-detail navigatie
    //       members: [ { userName, fullName, tripId, rawUuid, isOwn, budget,
    //                    statusKey, canSubmit, canAct } ]
    //     } ]

    function fullName(oPerson) {
        return ((oPerson.FirstName || "") + " " + (oPerson.LastName || "")).trim();
    }

    function groupTrips(aPerPerson, mExt) {
        mExt = mExt || {};
        var mGroups = {};
        var aOrder = [];

        (aPerPerson || []).forEach(function (oEntry) {
            var oPerson = oEntry.person;
            var sFull = fullName(oPerson);
            (oEntry.trips || []).forEach(function (oTrip) {
                var bOwn = !!oTrip._isOwn;
                // gedeelde afleiding (eigen trip → approvalStatus; TripPin-trip → live ext-map)
                var sStatusKey = approval.statusKey(oTrip, oPerson.UserName, mExt);

                var oMember = {
                    userName:  oPerson.UserName,
                    fullName:  sFull,
                    tripId:    oTrip.TripId,
                    rawUuid:   bOwn ? String(oTrip.TripId) : null,
                    isOwn:     bOwn,
                    budget:    oTrip.Budget,
                    statusKey: sStatusKey,
                    canSubmit: !bOwn && sStatusKey === "notsubmitted",
                    canAct:    sStatusKey !== "notsubmitted"
                };

                var sKey = oTrip.ShareId || (oPerson.UserName + "|" + oTrip.TripId);
                var oGroup = mGroups[sKey];
                if (!oGroup) {
                    oGroup = mGroups[sKey] = {
                        groupKey:    sKey,
                        shareId:     oTrip.ShareId || null,
                        isOwn:       bOwn,
                        tripName:    oTrip.Name,
                        startsAt:    oTrip.StartsAt,
                        endsAt:      oTrip.EndsAt,
                        totalBudget: 0,
                        repUserName: oPerson.UserName,
                        repTripId:   oTrip.TripId,
                        members:     []
                    };
                    aOrder.push(oGroup);
                }
                oGroup.members.push(oMember);
                // totaal telt enkel goedgekeurd + in behandeling (afgekeurd/niet-ingediend niet)
                if (approval.countsInBudget(sStatusKey)) {
                    oGroup.totalBudget += (oTrip.Budget || 0);
                }
            });
        });

        aOrder.forEach(function (oGroup) {
            oGroup.travellerCount = oGroup.members.length;
            oGroup.travellerNames = oGroup.members.map(function (m) {
                return m.fullName;
            }).join(", ");
        });

        return aOrder;
    }

    return { groupTrips: groupTrips };
});
