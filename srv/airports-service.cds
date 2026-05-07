using { TripPin as external } from './external/TripPin';

@requires: 'authenticated-user'
service AirportsService @(path: '/airports') {
    @readonly entity Airports as projection on external.Airports;
}