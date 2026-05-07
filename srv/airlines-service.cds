using { TripPin as external } from './external/TripPin';

service AirlinesService @(path: '/airlines') {
    @readonly entity Airlines as projection on external.Airlines;
}