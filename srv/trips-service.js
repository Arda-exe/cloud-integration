const cds = require('@sap/cds')
const TRIPPIN = 'https://services.odata.org/V4/TripPinService'

module.exports = cds.service.impl(async function () {
    this.on('READ', 'PersonTrips', async (req) => {
        const person = req.query.SELECT?.where?.[2]?.val || 'russellwhyte'
        const res = await fetch(`${TRIPPIN}/People('${person}')/Trips`)
        const data = await res.json()
        return data.value
    })
})