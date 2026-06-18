const cds = require('@sap/cds')
const { scopedUserNames } = require('./scope')

const BASE = cds.env.requires?.TripPin?.credentials?.url
    ?? 'https://services.odata.org/V4/TripPinService'

const fetchAllPages = async (url) => {
    let results = []
    let nextUrl = url
    while (nextUrl) {
        const res = await fetch(nextUrl)
        const json = await res.json()
        results = results.concat(json.value ?? [])
        nextUrl = json['@odata.nextLink'] ?? null
    }
    return results
}

module.exports = cds.service.impl(async function () {
    this.on('READ', 'People', async (req) => {
        const rawUrl = req._.req?.url ?? ''
        const entityIndex = rawUrl.indexOf('/People')
        const entityPath = rawUrl.substring(entityIndex + 1)

        // rol-scoping: null = alles (TravelCoordinator), anders de toegelaten UserNames
        const oAllowed = await scopedUserNames(req)

        if (entityPath.includes("('")) {
            const res = await fetch(`${BASE}/${entityPath}`)
            const json = await res.json()
            const oPerson = json.value ?? json
            // deep-link naar een persoon buiten de scope (EmployeeDetail bindElement) → 404
            if (oAllowed && oPerson && !oAllowed.has(oPerson.UserName)) {
                return req.reject(404)
            }
            return oPerson
        }

        // TripPin is een publieke, schrijfbare demo-service en raakt vervuild door test-
        // accounts van derden (JdbcUser-/JdbcName-, soms met DUPLICAAT-keys). Duplicaat-keys
        // laten het OData V4-model de hele /People-collectie afwijzen ("data laadt niet"),
        // dus filteren we de junk en ontdubbelen we defensief op UserName.
        const aAll = await fetchAllPages(`${BASE}/People`)
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