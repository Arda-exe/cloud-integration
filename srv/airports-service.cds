using { TripPin as external } from './external/TripPin';

service AirportsService @(path: '/airports') {
    @readonly entity Airports as projection on external.Airports;
}