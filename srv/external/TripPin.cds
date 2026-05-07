/* checksum : acfa667cd924c7d7c7c0700fd99b0863 */
/** TripPin service is a sample service for OData V4. */
@cds.external : true
@odata.containment : true
@Core.DereferenceableIDs : true
@Core.ConventionalIDs : true
@Capabilities.ConformanceLevel.![#] : 'Advanced'
@Capabilities.SupportedFormats : [
  'application/json;odata.metadata=full;IEEE754Compatible=false;odata.streaming=true',
  'application/json;odata.metadata=minimal;IEEE754Compatible=false;odata.streaming=true',
  'application/json;odata.metadata=none;IEEE754Compatible=false;odata.streaming=true'
]
@Capabilities.AsynchronousRequestsSupported : true
@Capabilities.BatchContinueOnErrorSupported : false
@Capabilities.FilterFunctions : [
  'contains',
  'endswith',
  'startswith',
  'length',
  'indexof',
  'substring',
  'tolower',
  'toupper',
  'trim',
  'concat',
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'round',
  'floor',
  'ceiling',
  'cast',
  'isof'
]
service TripPin {
  @cds.external : true
  function GetNearestAirport(
    lat : Double not null,
    lon : Double not null
  ) returns Airports not null;

  @cds.external : true
  action ResetDataSource();

  @cds.external : true
  @cds.persistence.skip : true
  @open : true
  entity PlanItem {
    @Core.Permissions : #Read
    key PlanItemId : Integer not null;
    ConfirmationCode : String;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    StartsAt : DateTime;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    EndsAt : DateTime;
    @odata.Type : 'Edm.Duration'
    Duration : String;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @open : true
  entity PublicTransportation : PlanItem {
    SeatNumber : String;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Flight : PublicTransportation {
    FlightNumber : String not null;
    ![From] : Association to one Airports {  };
    To : Association to one Airports {  };
    Airline : Association to one Airlines {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @open : true
  entity Event : PlanItem {
    Description : String;
    OccursAt : EventLocation not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Trip {
    @Core.Permissions : #Read
    key TripId : Integer not null;
    ShareId : UUID;
    Description : String;
    Name : String not null;
    @Measures.ISOCurrency : 'USD'
    @Measures.Scale.$Cast : '2'
    @Measures.Scale.$Type : 'Edm.Int64'
    @odata.Type : 'Edm.Single'
    Budget : Double not null;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    StartsAt : DateTime not null;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    EndsAt : DateTime not null;
    Tags : many String not null;
    Photos : Association to many Photos {  };
    PlanItems : Composition of many PlanItem {  };
  } actions {
    function GetInvolvedPeople() returns many People not null;
  };

  @cds.external : true
  type City {
    CountryRegion : String not null;
    Name : String not null;
    Region : String not null;
  };

  @cds.external : true
  @open : true
  type Location {
    Address : String not null;
    City : City not null;
  };

  @cds.external : true
  @open : true
  type EventLocation : Location {
    BuildingInfo : String;
  };

  @cds.external : true
  @open : true
  type AirportLocation : Location {
    @odata.Type : 'Edm.GeographyPoint'
    Loc : String not null;
  };

  @cds.external : true
  type PersonGender : Integer enum {
    Male = 0;
    Female = 1;
    Unknown = 2;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @Core.AcceptableMediaTypes : [ 'image/jpeg' ]
  entity Photos {
    @Core.Permissions : #Read
    key Id : Integer64 not null;
    Name : String;
    @Core.MediaType : 'application/octet-stream'
    blob : LargeBinary;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @open : true
  entity People {
    @Core.Permissions : #Read
    key UserName : String not null;
    FirstName : String not null;
    LastName : String not null;
    Emails : many String;
    AddressInfo : many Location;
    Gender : PersonGender;
    @Core.Computed : true
    Concurrency : Integer64 not null;
    Friends : Association to many People {  };
    Trips : Composition of many Trip {  };
    Photo : Association to one Photos {  };
  } actions {
    action ShareTrip(
      userName : String not null,
      tripId : Integer not null
    );
    function GetFavoriteAirline() returns Airlines not null;
    function GetFriendsTrips(
      userName : String not null
    ) returns many Trip not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Airlines {
    @Core.Permissions : #Read
    key AirlineCode : String not null;
    Name : String not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Airports {
    @Core.Permissions : #Read
    key IcaoCode : String not null;
    Name : String not null;
    @Core.Immutable : true
    IataCode : String not null;
    Location : AirportLocation not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @open : true
  @odata.singleton : true
  entity Me {
    @Core.Permissions : #Read
    key UserName : String not null;
    FirstName : String not null;
    LastName : String not null;
    Emails : many String;
    AddressInfo : many Location;
    Gender : PersonGender;
    @Core.Computed : true
    Concurrency : Integer64 not null;
    Friends : Association to many People {  };
    Trips : Composition of many Trip {  };
    Photo : Association to one Photos {  };
  } actions {
    action ShareTrip(
      userName : String not null,
      tripId : Integer not null
    );
    function GetFavoriteAirline() returns Airlines not null;
    function GetFriendsTrips(
      userName : String not null
    ) returns many Trip not null;
  };
};

