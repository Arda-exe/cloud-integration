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
}