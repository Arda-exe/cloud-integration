using { TripPin as external } from './external/TripPin';
using { primepath } from '../db/schema';

@requires: 'authenticated-user'
service PeopleService @(path: '/people') {

    @readonly entity People as projection on external.People;

    @restrict: [
        { grant: ['READ'],         to: 'TeamLead' },
        { grant: ['READ'],         to: 'HR' },
        { grant: ['READ','WRITE'], to: 'TravelCoordinator' }
    ]
    entity PersonExtensions as projection on primepath.PersonExtension;
}