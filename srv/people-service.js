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

        return fetchAllPages(`${BASE}/People`)
    })
})