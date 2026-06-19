namespace primepath;

entity TripExtension {
    key tripId           : Integer;
    key personUserName   : String(100);

    approvalStatus       : String(20) default 'pending';
    company              : String(100);
    team                 : String(100);
    notes                : String(500);
    createdAt            : DateTime;
    createdBy            : String(100);
}

entity OwnTrip {
    key tripId        : UUID;
    personUserName    : String(100);
    name              : String(200);
    startsAt          : DateTime;
    endsAt            : DateTime;
    budget            : Decimal(10,2);
    description       : String(1000);
    destination       : String(200);
    approvalStatus    : String(20) default 'pending';
    company           : String(100);
    team              : String(100);
    // gedeelde id over de per-medewerker kopieën van één multi-medewerker trip (spiegelt
    // TripPin's ShareId): util/tripGroups groepeert kopieën met hetzelfde shareId tot één trip.
    shareId           : String(36);
}

entity OwnFlight {
    key flightId     : UUID;
    tripId           : UUID;
    flightNumber     : String(20);
    airlineName      : String(100);
    seatNumber       : String(10);
    startsAt         : DateTime;
    endsAt           : DateTime;
    fromIata         : String(10);
    fromName         : String(100);
    toIata           : String(10);
    toName           : String(100);
}

entity PersonExtension {
    key personUserName : String(100);
    department         : String(100);
    team               : String(100);
    company            : String(100);
    status             : String(20) default 'available';
}