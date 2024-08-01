/**
 * This file defines the custom query filters
 */
const { SearchParameterDefinition } = require('../../searchParameters/searchParameterTypes');
/**
 * This is the enum for the types of filters we support
 * @type {Object.<string, SearchParameterDefinitionType>}
 */
const fhirFilterTypes = {
    /**
     * example usage: ?param=id1 where id1 is the id of the resource we're finding references to
     */
    reference: 'reference',
    /**
     * example usage: ?param={system}|{code} will require both to match
     * example usage: ?param={system}| will match only on system
     * example usage: ?param=code will match only on code
     */
    token: 'token',
    /**
     * example usage: ?param=lt{date}&date=gt{date}
     * can also pass in exact date e.g., ?param={date}
     */
    date: 'date',
    /**
     * example usage: ?param=lt{date}&date=gt{date}
     * can also pass in exact date e.g., ?param={date}
     */
    datetime: 'datetime',
    /**
     * example usage: ?param=lt{date}&date=gt{date}
     * can also pass in exact date e.g., ?param={date}
     */
    instant: 'instant',
    /**
     * example usage: ?param=lt{date}&date=gt{date}
     * can also pass in exact date e.g., ?param={date}
     */
    period: 'period',
    /**
     *     example usage: ?param=bar
     *     can also pass in multiple values separated by comma which are combined in an OR e.g., ?param=bar1,bar2
     */
    string: 'string',
    /**
     *     example usage: ?param=bar
     *     can also pass in multiple values separated by comma which are combined in an OR e.g., ?param=bar1,bar2
     */
    uri: 'uri',
    /**
     * usage: ?param=imran@hotmail.com
     */
    email: 'email',
    /**
     * usage: ?param=4086669999
     */
    phone: 'phone',
    /**
     * usage: ?param=url
     */
    canonical: 'canonical',
    /**
     * usage: ?param=<lt...>number|system|code
     */
    quantity: 'quantity',
    /**
     * usage: ?param=<lt...>number
     */
    number: 'number'
};
/**
 Try to keep this in list in alphabetical order to make it easier to search
 Follow the FHIR standard for any additions

 From: https://www.hl7.org/fhir/searchparameter-registry.html

 Format of items in this list:
 '{resourceType or * if this applies to all resources}': {
        '{queryParameter}': {
            'type': {type of filter},
            'field': '{field name in resourceType to filter}',
            'target': '{if type is reference then the resourceType of the referenced resource}'
        }
    },

 */
/**
 *
 * @type {Object.<string, Object.<string, SearchParameterDefinition>>}
 */
const customFilterQueries = {
    Account: {
        patient: new SearchParameterDefinition(
            {
                type: fhirFilterTypes.reference,
                field: 'subject.reference',
                target: ['Patient']
            }
        )
    },
    AllergyIntolerance: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'recordedDate'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        }),
        type: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'type'
        })
    },
    Appointment: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'participant.actor.reference',
            target: ['Patient']
        })
    },
    AuditEvent: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.instant,
            field: 'recorded'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'agent.who.reference',
            target: ['Patient']
        }),
        agent: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'agent.who.reference',
            target: ['Person']
        })
    },
    CapabilityStatement: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    CarePlan: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.period,
            field: 'period'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    CareTeam: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.period,
            field: 'period'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    Claim: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        })
    },
    ClinicalImpression: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    CodeSystem: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    CompartmentDefinition: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    Composition: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        }),
        type: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'type'
        })
    },
    ConceptMap: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    Condition: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    Consent: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'dateTime'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        })
    },
    Coverage: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'beneficiary.reference',
            target: ['Patient']
        })
    },
    DetectedIssue: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        })
    },
    Device: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        })
    },
    DeviceRequest: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    DeviceUseStatement: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    DiagnosticReport: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'effectiveDateTime'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    DocumentManifest: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        }),
        type: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'type'
        })
    },
    DocumentReference: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        }),
        type: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'type'
        })
    },
    Encounter: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.period,
            field: 'period'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        }),
        type: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'type'
        })
    },
    EpisodeOfCare: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.period,
            field: 'period'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        }),
        type: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'type'
        })
    },
    ExplanationOfBenefit: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        })
    },
    FamilyMemberHistory: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        })
    },
    Flag: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.period,
            field: 'period'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    Goal: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    GraphDefinition: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    HealthcareService: {
        healthcareService: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'id'
        }),
        organization: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'providedBy.reference',
            target: ['Organization']
        })
    },
    ImagingStudy: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    ImplementationGuide: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    Immunization: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'occurrenceDateTime'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        })
    },
    InsurancePlan: {
        organization: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'ownedBy.reference',
            target: ['Organization']
        })
    },
    Location: {
        location: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'id'
        })
    },
    List: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    MeasureReport: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    Medication: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        })
    },
    MedicationAdministration: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        })

    },
    MedicationDispense: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        })

    },
    MedicationRequest: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        })
    },
    MedicationStatement: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        })
    },
    MessageDefinition: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    NamingSystem: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        })
    },
    NutritionOrder: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        })
    },
    Observation: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.period,
            field: 'effectivePeriod'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    OperationDefinition: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    Organization: {
        organization: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'id'
        })
    },
    Patient: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'id'
        }),
        birthdate: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'birthDate'
        }),
        email: new SearchParameterDefinition({
            type: fhirFilterTypes.email,
            field: 'telecom'
        }),
        phone: new SearchParameterDefinition({
            type: fhirFilterTypes.phone,
            field: 'telecom'
        })
    },
    Person: {
        agent: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'id'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'link.target.reference',
            target: ['Patient']
        }),
        birthdate: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'birthDate'
        }),
        email: new SearchParameterDefinition({
            type: fhirFilterTypes.email,
            field: 'telecom'
        }),
        phone: new SearchParameterDefinition({
            type: fhirFilterTypes.phone,
            field: 'telecom'
        })
    },
    Practitioner: {
        practitioner: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'id'
        }),
        email: new SearchParameterDefinition({
            type: fhirFilterTypes.email,
            field: 'telecom'
        }),
        phone: new SearchParameterDefinition({
            type: fhirFilterTypes.phone,
            field: 'telecom'
        })
    },
    PractitionerRole: {
        practitioner: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'practitioner.reference',
            target: ['Practitioner']
        }),
        organization: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'organization.reference',
            target: ['Organization']
        }),
        location: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'location.reference',
            target: ['Location']
        }),
        healthcareService: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'healthcareService.reference',
            target: ['HealthcareService']
        }),
        email: new SearchParameterDefinition({
            type: fhirFilterTypes.email,
            field: 'telecom'
        }),
        phone: new SearchParameterDefinition({
            type: fhirFilterTypes.phone,
            field: 'telecom'
        })
    },
    Procedure: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'performedDateTime'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    QuestionnaireResponse: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    RelatedPerson: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        }),
        birthdate: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'birthDate'
        }),
        email: new SearchParameterDefinition({
            type: fhirFilterTypes.email,
            field: 'telecom'
        }),
        phone: new SearchParameterDefinition({
            type: fhirFilterTypes.phone,
            field: 'telecom'
        })
    },
    RiskAssessment: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'occurrenceDateTime'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    Schedule: {
        schedule: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'id'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'actor.reference',
            target: ['Patient']
        }),
        practitioner: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'actor.reference',
            target: ['Practitioner']
        }),
        location: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'actor.reference',
            target: ['Location']
        }),
        healthcareService: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'actor.reference',
            target: ['HealthcareService']
        })
    },
    SearchParameter: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    ServiceRequest: {
        code: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'code'
        }),
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'subject.reference',
            target: ['Patient']
        })
    },
    Slot: {
        schedule: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'schedule.reference',
            target: ['Schedule']
        })
    },
    StructureDefinition: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    StructureMap: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    SupplyRequest: {
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'occurrenceDateTime'
        })
    },
    SupplyDelivery: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        })
    },
    Task: {
        period: new SearchParameterDefinition({
            type: fhirFilterTypes.period,
            field: 'executionPeriod'
        })
    },
    TerminologyCapabilities: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    ValueSet: {
        name: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'name'
        }),
        date: new SearchParameterDefinition({
            type: fhirFilterTypes.dateTime,
            field: 'date'
        }),
        url: new SearchParameterDefinition({
            type: fhirFilterTypes.uri,
            field: 'url'
        }),
        status: new SearchParameterDefinition({
            type: fhirFilterTypes.string,
            field: 'status'
        }),
        version: new SearchParameterDefinition({
            type: fhirFilterTypes.token,
            field: 'version'
        })
    },
    VisionPrescription: {
        patient: new SearchParameterDefinition({
            type: fhirFilterTypes.reference,
            field: 'patient.reference',
            target: ['Patient']
        })
    }
};

module.exports = {
    fhirFilterTypes,
    customFilterQueries
};
