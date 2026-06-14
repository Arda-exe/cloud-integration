const cds = require('@sap/cds')
const express = require('express')
const path = require('path')

cds.on('bootstrap', (app) => {
    app.use('/dashboard/webapp', express.static(
        path.join(__dirname, 'app/dashboard/webapp')
    ))
})

module.exports = cds.server