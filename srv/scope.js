const { SELECT } = require('@sap/cds').ql

// Vaste rol-scoping (géén per-user XSUAA-attributen): een TeamLead ziet enkel mensen uit team
// "Team Alpha", HR enkel uit bedrijf "Contoso", een TravelCoordinator ziet alles. Dit is de ENIGE
// bron van waarheid voor de regel — hier wijzigen volstaat. De koppeling gebeurt op PersonExtension
// (key personUserName); de medewerkersset is klein, dus dit is goedkoop en volledig in-memory.
const ROLE_SCOPE = {
    TeamLead: { field: 'team',    value: 'Team Alpha' },
    HR:       { field: 'company', value: 'Contoso' }
}

// De ENIGE rolwaarden die de X-Active-Role-header mag dragen: de drie echte applicatierollen.
// CRUCIAAL voor de escalatieguard — req.user.is() geeft true voor de CAP-pseudorollen
// ('authenticated-user'/'identified-user'/'any') voor élke ingelogde gebruiker, dus zonder deze
// allow-list zou een TeamLead/HR met "X-Active-Role: authenticated-user" door is() glippen en
// (geen ROLE_SCOPE-match) onbeperkte toegang krijgen. De allow-list houdt pseudorollen wég van is().
const VALID_ACTIVE_ROLES = ['TravelCoordinator', 'TeamLead', 'HR']

// → null  = onbeperkt (TravelCoordinator of een rol zonder scoping)
// → Set   = de toegelaten personUserName-waarden voor de huidige gebruiker
async function scopedUserNames(req) {
    // De rol die de gebruiker NU speelt, door de frontend meegegeven als X-Active-Role-header.
    // Op BTP draagt het XSUAA-token álle rol-collecties tegelijk, dus zonder dit zou de meest-
    // geprivilegieerde rol altijd winnen en zou een multi-rol-gebruiker als TeamLead/HR nog alles
    // zien. SECURITY-KRITIEK: de waarde eerst tegen de allow-list checken (pseudorollen weren, zie
    // VALID_ACTIVE_ROLES) en dan enkel honoreren als de gebruiker die rol ECHT bezit (req.user.is) —
    // anders zou een TeamLead met "X-Active-Role: TravelCoordinator" zich kunnen escaleren.
    const sRawRole = req.headers?.['x-active-role']
        ?? req._.req?.headers?.['x-active-role']
    const sActiveRole = VALID_ACTIVE_ROLES.includes(sRawRole) ? sRawRole : null

    let oScope = null
    if (sActiveRole && req.user.is(sActiveRole)) {
        // geldige actieve rol → exact die rol scopen
        if (sActiveRole === 'TravelCoordinator') { return null }
        oScope = ROLE_SCOPE[sActiveRole] || null
        if (!oScope) { return null }
    } else {
        // geen (geldige) actieve rol → afleiden uit de bezeten rollen, meest-geprivilegieerd eerst.
        // Zo gedragen single-rol-gebruikers en directe API-calls zich exact zoals voorheen.
        if (req.user.is('TravelCoordinator')) { return null }
        if (req.user.is('TeamLead')) { oScope = ROLE_SCOPE.TeamLead }
        else if (req.user.is('HR'))  { oScope = ROLE_SCOPE.HR }
        if (!oScope) { return null }
    }

    const aExt = await SELECT.from('primepath.PersonExtension')
        .columns('personUserName', oScope.field)

    const oAllowed = new Set()
    aExt.forEach((oRow) => {
        if (oRow[oScope.field] === oScope.value) { oAllowed.add(oRow.personUserName) }
    })
    return oAllowed
}

module.exports = { scopedUserNames }
