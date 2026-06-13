const cds = require('@sap/cds')

module.exports = cds.service.impl(async function () {
    const TripPin = await cds.connect.to('TripPin')

    this.on('READ', 'PersonTrips', async (req) => {
        const where = req.query.SELECT?.where
        const userNameEntry = where?.find((w, i) => w?.ref?.[0] === 'personUserName' && where[i+2]?.val)
        const userName = userNameEntry ? where[where.indexOf(userNameEntry) + 2].val : null

        if (!userName) return []

        const res = await fetch(`https://services.odata.org/V4/TripPinService/People('${userName}')/Trips`)
        const data = await res.json()
        return data.value ?? []
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