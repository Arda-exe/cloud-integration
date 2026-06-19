const cds = require('@sap/cds')

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

    // Pure leesproxy → delegeer naar de TripPin remote service (resolvet via de Destination op BTP).
    // Enkel-entiteit (lezen op key) gaat 1-op-1 door; een collectie pagineren we volledig.
    this.on('READ', 'Airlines', (req) => {
        if (req.query?.SELECT?.one) return tripin.run(req.query)
        return fetchAll(tripin, 'Airlines')
    })
})
