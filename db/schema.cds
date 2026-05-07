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