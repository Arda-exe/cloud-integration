using { TripPin as external } from './external/TripPin';

@requires: 'authenticated-user'
service PeopleService @(path: '/people') {
    @readonly entity People as projection on external.People;
}