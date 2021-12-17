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
    The format is that we list the resourceType, then the query parameter and then the type and name of field to filter
    Try to keep this in list in alphabetical order to make it easier to search
 */
const customScalarQueries = {
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
    'AuditEvent': {
        'date': {
            'type': 'instant',
            'field': 'recorded'
        }
    },
    'CapabilityStatement': {
        'name': {
            'type': 'string',
            'field': 'name'
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
    'Composition': {
        'date': {
            'type': 'dateTime',
            'field': 'date'
        }
    },
    'ConceptMap': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'Condition': {
        'code': {
            'type': 'token',
            'field': 'code'
        }
    },
    'Consent': {
        'date': {
            'type': 'dateTime',
            'field': 'dateTime'
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
    'Flag': {
        'date': {
            'type': 'period',
            'field': 'period'
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
    'Immunization': {
        'date': {
            'type': 'dateTime',
            'field': 'occurrenceDateTime'
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
    'OperationDefinition': {
        'name': {
            'type': 'string',
            'field': 'name'
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
    'RiskAssessment': {
        'date': {
            'type': 'dateTime',
            'field': 'occurrenceDateTime'
        }
    },
    'SearchParameter': {
        'name': {
            'type': 'string',
            'field': 'name'
        }
    },
    'ServiceRequest': {
        'code': {
            'type': 'token',
            'field': 'code'
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
    'SupplyRequest': {
        'date': {
            'type': 'dateTime',
            'field': 'occurrenceDateTime'
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
    }
};

module.exports = {
    customReferenceQueries: customReferenceQueries,
    customScalarQueries: customScalarQueries
};
