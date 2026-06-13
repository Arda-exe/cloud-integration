const cds = require('@sap/cds')

const BASE = cds.env.requires?.TripPin?.credentials?.url
    ?? 'https://services.odata.org/V4/TripPinService'

module.exports = cds.service.impl(async function () {

    this.on('READ', 'PersonTrips', async (req) => {
        const rawQuery = req._.req?.url?.split('?')[1] ?? ''
        const userName = new URLSearchParams(rawQuery).get('personUserName')
            ?? req._.req?.url?.match(/People\('([^']+)'\)/)?.[1]

        if (!userName) return []

        const query = rawQuery.replace(/personUserName[^&]*/g, '').replace(/^&|&$/g, '')
        const url = query
            ? `${BASE}/People('${userName}')/Trips?${query}`
            : `${BASE}/People('${userName}')/Trips`

        const res = await fetch(url)
        const json = await res.json()
        return json.value ?? []
    })

    this.on('approve', 'TripExtensions', async (req) => {
        const { tripId, personUserName } = req.params[0]
        await UPDATE(req.subject).set({ approvalStatus: 'approved' })
        return { message: `Trip ${tripId} goedgekeurd` }
    })

    this.on('rejectTrip', 'TripExtensions', async (req) => {
        const { tripId, personUserName } = req.params[0]
        await UPDATE(req.subject).set({ approvalStatus: 'rejected' })
        return { message: `Trip ${tripId} afgekeurd` }
    })
})