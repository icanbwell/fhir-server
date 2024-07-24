# Change Event Tracking

This FHIR server can (optionally) send events to a Kafka queue whenever a patient or a resource is changed.

## Using change events

This functionality can be enabled by setting the following environment variables:

1. ENABLE_EVENTS_KAFKA: "1"
2. KAFKA_CLIENT_ID: "fhir-server"
3. KAFKA_URLS: "kafka:9092"

Note that KAFKA_URLS can be a comma separated list.

Use the mentioned environment variable to enable kafka events for more Fhir resources: ```KAFKA_ENABLED_RESOURCES```
[NOTE: Default value is: "Consent,ExportStatus"]

## Format of change events

Change events follow the FHIR Audit Event Schema.

### Topic supported

business.events:
(new user registered, new user added, onboarding, new client added, Patient Change Event, etc..)

Topic name can be changed using the below environment variables:-
1. ```KAFKA_PATIENT_CHANGE_TOPIC```: Used to set topic name for events created for Patient/Person resource
2. ```KAFKA_RESOURCE_CHANGE_TOPIC```: Used to set topic name for events created for kafka enabled Fhir resources
Note: Default values for both above variables is set to: ```business.events```

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

When DatabaseBulkInserter inserts or updates a resource, it calls ChangeEventProducer to fire events
```javascript
        // fire change events
        if (!bulkInsertUpdateEntry.skipped && resourceType !== 'AuditEvent' && !useHistoryCollection) {
            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => await this.changeEventProducer.fireEventsAsync({
                    requestId,
                    eventType: bulkInsertUpdateEntry.isCreateOperation ? 'C' : 'U',
                    resourceType: resourceType,
                    doc: bulkInsertUpdateEntry.resource
                })
            });
        }
```
PostRequestProcessor is used to fire the events AFTER the response has been returned to the caller.  This is to avoid slowing down responses while we do post request processing tasks.

