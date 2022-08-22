# Change Event Tracking

This FHIR server can (optionally) send events to a Kafka queue whenever a patient or a resource is changed.

## Using change events

This functionality can be enabled by setting the following environment variables:

1. ENABLE_EVENTS_KAFKA: "1"
2. KAFKA_CLIENT_ID: "fhir-server"
3. KAFKA_URLS: "kafka:9092"

Note that KAFKA_URLS can be a comma separated list.

## Format of change events

Change events follow the FHIR Audit Event Schema.

### Topic supported
business.events: 
(new user registered, new user added, onboarding, new client added, Patient Change Event, etc..)

### Header of event

Two fields are set in the event:

1. b3 (Unique tracking number of the FHIR request that generated this event)
2. version (version of FHIR event used. R4 or STU3)

### Content of event
The content is specified in FHIR Audit Event schema.

```json
{
  "resourceType": "AuditEvent",
  "id": "c6aaddac-7114-4398-9145-02b154fb966d",
  "action": "U",
  "period": {
    "start": "2022-08-22",
    "end": "2022-08-22"
  },
  "purposeOfEvent": [
    {
      "coding": [
        {
          "system": "https://www.icanbwell.com/event-purpose",
          "code": "Patient Change"
        }
      ]
    }
  ],
  "agent": [
    {
      "who": {
        "reference": "Patient/2354"
      }
    }
  ]
}
```

See `_createMessage` function for an example:
[src/utils/changeEventProducer.js](src/utils/changeEventProducer.js)

## Contributing
The code for this is at [src/utils/changeEventProducer.js](src/utils/changeEventProducer.js)
