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

    this.on('READ', 'PlanItems', async (req) => {
        const filterParam = req._.req?.query?.['$filter'] ?? ''
        const userMatch = filterParam.match(/personUserName eq '([^']+)'/)
        const tripMatch = filterParam.match(/tripId eq (\d+)/)
        const userName = userMatch?.[1]
        const tripId = tripMatch?.[1]
        if (!userName || !tripId) return []

        const url = `${BASE}/People('${encodeURIComponent(userName)}')/Trips(${tripId})/PlanItems/Microsoft.OData.SampleService.Models.TripPin.Flight?$expand=From,To,Airline`
        const res = await fetch(url)
        const json = await res.json()

        return (json.value ?? []).map(item => ({
            PlanItemId:        item.PlanItemId,
            personUserName:    userName,
            tripId:            parseInt(tripId),
            ConfirmationCode:  item.ConfirmationCode ?? '',
            StartsAt:          item.StartsAt,
            EndsAt:            item.EndsAt,
            Duration:          item.Duration ?? '',
            FlightNumber:      item.FlightNumber ?? '',
            SeatNumber:        item.SeatNumber ?? '',
            fromIata:          item.From?.IataCode ?? '',
            fromName:          item.From?.Name ?? '',
            fromCity:          item.From?.Address?.City?.Name ?? '',
            toIata:            item.To?.IataCode ?? '',
            toName:            item.To?.Name ?? '',
            toCity:            item.To?.Address?.City?.Name ?? '',
            airlineCode:       item.Airline?.AirlineCode ?? '',
            airlineName:       item.Airline?.Name ?? ''
        }))
    })

    this.on('approve', 'TripExtensions', async (req) => {
        await UPDATE(req.subject).set({ approvalStatus: 'approved' })
    })

    this.on('rejectTrip', 'TripExtensions', async (req) => {
        await UPDATE(req.subject).set({ approvalStatus: 'rejected' })
    })
})