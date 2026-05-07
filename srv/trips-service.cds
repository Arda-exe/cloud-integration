using { TripPin as external } from './external/TripPin';
using { primepath } from '../db/schema';

service TripsService @(path: '/trips') {

    @readonly entity PersonTrips as projection on external.Trip;

    entity TripExtensions as projection on primepath.TripExtension actions {
        action approve();
        action reject();
    };
}