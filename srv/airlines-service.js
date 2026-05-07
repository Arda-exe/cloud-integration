const cds = require('@sap/cds')
const TRIPPIN = 'https://services.odata.org/V4/TripPinService'

module.exports = cds.service.impl(async function () {
    this.on('READ', 'Airlines', async () => {
        const res = await fetch(`${TRIPPIN}/Airlines`)
        const data = await res.json()
        return data.value
    })
})