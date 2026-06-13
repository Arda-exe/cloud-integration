const cds = require('@sap/cds')

const BASE = cds.env.requires?.TripPin?.credentials?.url
    ?? 'https://services.odata.org/V4/TripPinService'

module.exports = cds.service.impl(async function () {

this.on('READ', 'PersonTrips', async (req) => {
    const filterParam = req._.req?.query?.['$filter'] 
        ?? req.query?.SELECT?.where?.toString() 
        ?? ''
    
    console.log('FILTER:', filterParam)
    

    const match = filterParam.match(/personUserName eq '([^']+)'/)
    const userName = match?.[1]
    
    console.log('USERNAME:', userName)
    
    if (!userName) return []
    
    const res = await fetch(`${BASE}/People('${userName}')/Trips`)
    const json = await res.json()
    console.log('TRIPS COUNT:', json.value?.length)
    return json.value ?? []
})
})
