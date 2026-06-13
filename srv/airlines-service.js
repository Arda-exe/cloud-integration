const cds = require('@sap/cds')

const BASE = cds.env.requires?.TripPin?.credentials?.url
    ?? 'https://services.odata.org/V4/TripPinService'

const proxy = async (entity, req) => {
    const rawQuery = req._.req?.url?.split('?')[1] ?? ''
    const url = rawQuery ? `${BASE}/${entity}?${rawQuery}` : `${BASE}/${entity}`
    const res = await fetch(url)
    const json = await res.json()
    return json.value ?? []
}

module.exports = cds.service.impl(async function () {
    this.on('READ', 'Airlines', req => proxy('Airlines', req))
})