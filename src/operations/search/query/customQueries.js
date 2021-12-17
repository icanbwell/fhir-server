/**
 * This file defines the custom query filters
 * The format is we specify the filter passed in the query.  then we define the resourceType for it and mappings that
 *  map the resource we're searching for that filter and the reference property in that resource to use
 */
const customReferenceQueries = {
    'patient': {
        'resourceType': 'Patient',
        'mappings': {
            'Patient': 'id',
            'AllergyIntolerance': 'patient.reference',
            'Immunization': 'patient.reference',
            'RelatedPerson': 'patient.reference',
            'Device': 'patient.reference',
            'ExplanationOfBenefit': 'patient.reference',
            'Claim': 'patient.reference',
            'Appointment': 'participant.actor.reference',
            'Account': 'subject.reference',
            'CarePlan': 'subject.reference',
            'Condition': 'subject.reference',
            'DocumentReference': 'subject.reference',
            'Encounter': 'subject.reference',
            'MedicationRequest': 'subject.reference',
            'Procedure': 'subject.reference',
            'ServiceRequest': 'subject.reference',
            'CareTeam': 'subject.reference',
            'MeasureReport': 'subject.reference',
            'Coverage': 'beneficiary.reference',
            'AuditEvent': 'agent.who.reference',
            'Person': 'link.target.reference',
            'Schedule': 'actor.reference'
        }
    },
    'practitioner': {
        'resourceType': 'Practitioner',
        'mappings': {
            'Practitioner': 'id',
            'PractitionerRole': 'practitioner.reference',
            'Schedule': 'actor.reference'
        }
    },
    'organization': {
        'resourceType': 'Organization',
        'mappings': {
            'Organization': 'id',
            'HealthcareService': 'providedBy.reference',
            'InsurancePlan': 'ownedBy.reference',
            'PractitionerRole': 'organization.reference'
        }
    },
    'location': {
        'resourceType': 'Location',
        'mappings': {
            'Location': 'id',
            'PractitionerRole': 'location.reference',
            'Schedule': 'actor.reference'
        }
    },
    'healthcareService': {
        'resourceType': 'HealthcareService',
        'mappings': {
            'HealthcareService': 'id',
            'PractitionerRole': 'healthcareService.reference',
            'Schedule': 'actor.reference'
        }
    },
    'schedule': {
        'resourceType': 'Schedule',
        'mappings': {
            'Schedule': 'id',
            'Slot': 'schedule.reference'
        }
    },
    'agent': {
        'resourceType': 'Person',
        'mappings': {
            'Person': 'id',
            'AuditEvent': 'agent.who.reference'
        }
    }
};

/*
    The format is that we list the resourceType, then the filter name and then the type and name of field to filter
 */
const customScalarQueries = {
    'CapabilityStatement': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'CodeSystem': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'CompartmentDefinition': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'ConceptMap': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'GraphDefinition': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'ImplementationGuide': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'MessageDefinition': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'NamingSystem': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'OperationDefinition': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'SearchParameter': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'StructureDefinition': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'StructureMap': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'TerminologyCapabilities': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'ValueSet': {
        'name': {
            'type': 'string',
            'field': 'name'
        },
        'url': {
            'type': 'uri',
            'field': 'url'
        }
    },
    'AllergyIntolerance': {
        'code': {
            'type': 'token',
            'field': 'code'
        },
        'date': {
            'type': 'datetime',
            'field': 'recordedDate'
        },
        'patient': {
            'type': 'reference',
            'field': 'patient.reference',
            'referencedResource': 'Patient'
        }
    },
    'Condition': {
        'code': {
            'type': 'token',
            'field': 'code'
        }
    },
    'DeviceRequest': {
        'code': {
            'type': 'token',
            'field': 'code'
        }
    },
    'DiagnosticReport': {
        'code': {
            'type': 'token',
            'field': 'code'
        },
        'date': {
            'type': 'dateTime',
            'field': 'effectiveDateTime'
        }
    },
    'FamilyMemberHistory': {
        'code': {
            'type': 'token',
            'field': 'code'
        },
        'date': {
            'type': 'dateTime',
            'field': 'date'
        }
    },
    'List': {
        'code': {
            'type': 'token',
            'field': 'code'
        },
        'date': {
            'type': 'dateTime',
            'field': 'date'
        }
    },
    'Medication': {
        'code': {
            'type': 'token',
            'field': 'code'
        }
    },
    'MedicationAdministration': {
        'code': {
            'type': 'token',
            'field': 'code'
        }
    },
    'MedicationDispense': {
        'code': {
            'type': 'token',
            'field': 'code'
        }
    },
    'MedicationRequest': {
        'code': {
            'type': 'token',
            'field': 'code'
        }
    },
    'MedicationStatement': {
        'code': {
            'type': 'token',
            'field': 'code'
        }
    },
    'Observation': {
        'code': {
            'type': 'token',
            'field': 'code'
        },
        'date': {
            'type': 'period',
            'field': 'effectivePeriod'
        },
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'Procedure': {
        'code': {
            'type': 'token',
            'field': 'code'
        },
        'date': {
            'type': 'dateTime',
            'field': 'performedDateTime'
        }
    },
    'QuestionnaireResponse': {
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'ServiceRequest': {
        'code': {
            'type': 'token',
            'field': 'code'
        }
    },
    'AuditEvent': {
        'date': {
            'type': 'instant',
            'field': 'recorded'
        }
    },
    'CarePlan': {
        'date': {
            'type': 'period',
            'field': 'period'
        }
    },
    'CareTeam': {
        'date': {
            'type': 'period',
            'field': 'period'
        }
    },
    'ClinicalImpression': {
        'date': {
            'type': 'dateTime',
            'field': 'date'
        }
    },
    'Composition': {
        'date': {
            'type': 'dateTime',
            'field': 'date'
        }
    },
    'Consent': {
        'date': {
            'type': 'dateTime',
            'field': 'dateTime'
        }
    },
    'Encounter': {
        'date': {
            'type': 'period',
            'field': 'period'
        }
    },
    'EpisodeOfCare': {
        'date': {
            'type': 'period',
            'field': 'period'
        }
    },
    'Flag': {
        'date': {
            'type': 'period',
            'field': 'period'
        }
    },
    'Immunization': {
        'date': {
            'type': 'dateTime',
            'field': 'occurrenceDateTime'
        }
    },
    'RiskAssessment': {
        'date': {
            'type': 'dateTime',
            'field': 'occurrenceDateTime'
        }
    },
    'SupplyRequest': {
        'date': {
            'type': 'dateTime',
            'field': 'occurrenceDateTime'
        }
    }
};

module.exports = {
    customReferenceQueries: customReferenceQueries,
    customScalarQueries: customScalarQueries
};
