using { TripPin as external } from './external/TripPin';
using { primepath } from '../db/schema';

@requires: 'authenticated-user'
service TripsService @(path: '/trips') {

    @readonly entity PersonTrips as projection on external.Trip {
        *,
        '' as personUserName : String
    };

    @restrict: [
        { grant: ['READ'],                                to: 'TeamLead' },
        { grant: ['READ'],                                to: 'HR' },
        { grant: ['READ','WRITE','approve','rejectTrip'], to: 'TravelCoordinator' }
    ]
    entity TripExtensions as projection on primepath.TripExtension actions {
        action approve();
        action rejectTrip();
    };
}