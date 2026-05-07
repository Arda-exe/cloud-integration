using { TripPin as external } from './external/TripPin';

service PeopleService @(path: '/people') {
    @readonly entity People as projection on external.People;
}