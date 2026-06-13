const cds = require('@sap/cds')

const BASE = cds.env.requires?.TripPin?.credentials?.url
    ?? 'https://services.odata.org/V4/TripPinService'

const proxy = async (entity, req) => {
    const rawUrl = req._.req?.url ?? ''
    const entityIndex = rawUrl.indexOf('/' + entity)
    if (entityIndex >= 0) {
        const entityPath = rawUrl.substring(entityIndex + 1)
        const url = `${BASE}/${entityPath}`
        const res = await fetch(url)
        const json = await res.json()
        return json.value ?? json
    }
    const res = await fetch(`${BASE}/${entity}`)
    const json = await res.json()
    return json.value ?? []
}

module.exports = cds.service.impl(async function () {
    this.on('READ', 'Airlines', req => proxy('Airlines', req))
})