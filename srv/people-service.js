const cds = require('@sap/cds')
const { scopedUserNames } = require('./scope')

// TripPin pagineert server-side (±8 per pagina) en het CAP remote-service volgt @odata.nextLink
// NIET automatisch, dus halen we alle pagina's zelf op via de remote service (die op BTP via de
// Destination resolvet) met $skip tot een lege pagina terugkomt. Géén hardcoded URL, géén fetch.
const fetchAll = async (tripin, entity) => {
    const aAll = []
    let iSkip = 0
    for (;;) {
        const oPage = await tripin.send({ method: 'GET', path: `${entity}?$skip=${iSkip}` })
        const aRows = Array.isArray(oPage) ? oPage : (oPage?.value ?? [])
        if (!aRows.length) break
        aAll.push(...aRows)
        iSkip += aRows.length
    }
    return aAll
}

module.exports = cds.service.impl(async function () {
    const tripin = await cds.connect.to('TripPin')

    this.on('READ', 'People', async (req) => {
        // rol-scoping: null = alles (TravelCoordinator), anders de toegelaten UserNames
        const oAllowed = await scopedUserNames(req)

        // enkel-entiteit (EmployeeDetail bindElement, lezen op key) → delegeer naar de remote service
        if (req.query?.SELECT?.one) {
            const oPerson = await tripin.run(req.query)
            // deep-link naar een persoon buiten de scope → 404
            if (oAllowed && oPerson && !oAllowed.has(oPerson.UserName)) {
                return req.reject(404)
            }
            return oPerson
        }

        // TripPin is een publieke, schrijfbare demo-service en raakt vervuild door test-
        // accounts van derden (JdbcUser-/JdbcName-, soms met DUPLICAAT-keys). Duplicaat-keys
        // laten het OData V4-model de hele /People-collectie afwijzen ("data laadt niet"),
        // dus filteren we de junk en ontdubbelen we defensief op UserName.
        const aAll = await fetchAll(tripin, 'People')
        const seen = {}
        return aAll.filter((p) => {
            if (!p || !p.UserName || /^Jdbc/i.test(p.UserName) || seen[p.UserName]) {
                return false
            }
            // buiten de rol-scope → niet teruggeven
            if (oAllowed && !oAllowed.has(p.UserName)) {
                return false
            }
            seen[p.UserName] = true
            return true
        })
    })

    // PersonExtension (team/company-store, DB-entiteit) ook scopen → een TeamLead/HR kan niet via
    // de rauwe /people/PersonExtensions-URL ieders team/company opvragen. Sentinel ' ' = leeg.
    this.before('READ', 'PersonExtensions', async (req) => {
        const oAllowed = await scopedUserNames(req)
        if (!oAllowed) { return }
        req.query.where('personUserName in', oAllowed.size ? [...oAllowed] : [' '])
    })
})