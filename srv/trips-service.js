const cds = require('@sap/cds')

const BASE = cds.env.requires?.TripPin?.credentials?.url
    ?? 'https://services.odata.org/V4/TripPinService'

module.exports = cds.service.impl(async function () {

    this.on('READ', 'PersonTrips', async (req) => {
        const filterParam = req._.req?.query?.['$filter'] ?? ''
        const match = filterParam.match(/personUserName eq '([^']+)'/)
        const userName = match?.[1]
        if (!userName) return []
        const res = await fetch(`${BASE}/People('${encodeURIComponent(userName)}')/Trips`)
        const json = await res.json()
        return json.value ?? []
    })

    this.on('approve', 'TripExtensions', async (req) => {
        await UPDATE(req.subject).set({ approvalStatus: 'approved' })
    })

    this.on('rejectTrip', 'TripExtensions', async (req) => {
        await UPDATE(req.subject).set({ approvalStatus: 'rejected' })
    })
})