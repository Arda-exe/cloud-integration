const { SELECT } = require('@sap/cds').ql

// Vaste rol-scoping (géén per-user XSUAA-attributen): een TeamLead ziet enkel mensen uit team
// "Team Alpha", HR enkel uit bedrijf "Contoso", een TravelCoordinator ziet alles. Dit is de ENIGE
// bron van waarheid voor de regel — hier wijzigen volstaat. De koppeling gebeurt op PersonExtension
// (key personUserName); de medewerkersset is klein, dus dit is goedkoop en volledig in-memory.
const ROLE_SCOPE = {
    TeamLead: { field: 'team',    value: 'Team Alpha' },
    HR:       { field: 'company', value: 'Contoso' }
}

// → null  = onbeperkt (TravelCoordinator of een rol zonder scoping)
// → Set   = de toegelaten personUserName-waarden voor de huidige gebruiker
async function scopedUserNames(req) {
    if (req.user.is('TravelCoordinator')) { return null }

    let oScope = null
    if (req.user.is('TeamLead')) { oScope = ROLE_SCOPE.TeamLead }
    else if (req.user.is('HR'))  { oScope = ROLE_SCOPE.HR }
    if (!oScope) { return null }

    const aExt = await SELECT.from('primepath.PersonExtension')
        .columns('personUserName', oScope.field)

    const oAllowed = new Set()
    aExt.forEach((oRow) => {
        if (oRow[oScope.field] === oScope.value) { oAllowed.add(oRow.personUserName) }
    })
    return oAllowed
}

module.exports = { scopedUserNames }
