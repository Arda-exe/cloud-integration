using { TripPin as external } from './external/TripPin';

@requires: 'authenticated-user'
service AirlinesService @(path: '/airlines') {
    @readonly entity Airlines as projection on external.Airlines;
}