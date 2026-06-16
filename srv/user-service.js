const cds = require('@sap/cds')

// De rollen die in xs-security.json / de mocked auth gedefinieerd zijn.
const ROLES = ['TravelCoordinator', 'TeamLead', 'HR']

module.exports = cds.service.impl(function () {

    // GET /user/whoami() → { id, roles }
    // req.user.is(role) werkt zowel voor mocked auth (lokaal) als XSUAA (BTP).
    this.on('whoami', (req) => {
        return {
            id: req.user.id,
            roles: ROLES.filter((sRole) => req.user.is(sRole))
        }
    })
})
