const cds = require('@sap/cds')

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

        if (entityPath.includes("('")) {
            const res = await fetch(`${BASE}/${entityPath}`)
            const json = await res.json()
            return json.value ?? json
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
            seen[p.UserName] = true
            return true
        })
    })
})