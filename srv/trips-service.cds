using { TripPin as external } from './external/TripPin';
using { primepath } from '../db/schema';

@requires: 'authenticated-user'
service TripsService @(path: '/trips') {

    @readonly entity PersonTrips as projection on external.Trip {
        *,
        '' as personUserName : String
    };

    @readonly @cds.persistence.skip entity PlanItems {
        key PlanItemId     : Integer;
        key personUserName : String(100);
        key tripId         : Integer;
        ConfirmationCode   : String;
        StartsAt           : DateTime;
        EndsAt             : DateTime;
        Duration           : String;
        FlightNumber       : String;
        SeatNumber         : String;
        fromIata           : String;
        fromName           : String;
        fromCity           : String;
        toIata             : String;
        toName             : String;
        toCity             : String;
        airlineCode        : String;
        airlineName        : String;
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

    @restrict: [
        { grant: ['READ'],          to: 'TeamLead' },
        { grant: ['READ'],          to: 'HR' },
        { grant: ['READ','WRITE'],  to: 'TravelCoordinator' }
    ]
    entity OwnTrips as projection on primepath.OwnTrip;
}