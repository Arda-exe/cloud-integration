namespace primepath;

entity TripExtension {
    key tripId       : Integer;        
    key personId     : String(100);    

    approvalStatus   : String(20) default 'pending'; // pending | approved | rejected
    company          : String(100);
    team             : String(100);
    notes            : String(500);
}