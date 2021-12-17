/**
 * This file defines the custom query filters
 * The format is we specify the filter passed in the query.  then we define the resourceType for it and mappings that
 *  map the resource we're searching for that filter and the reference property in that resource to use
 */
/**
 * This is the enum for the types of filters we support
 */
const fhirFilterTypes = {
    reference: 'reference',
    token: 'token',
    datetime: 'datetime',
    instant: 'instant',
    period: 'period',
    string: 'string',
    uri: 'uri'
};
/*
    The format is that we list the resourceType, then the query parameter and then the type and name of field to filter
    Try to keep this in list in alphabetical order to make it easier to search
 */
const customFilterQueries = {
    'Account': {
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'AllergyIntolerance': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        },
        'date': {
            'type': fhirFilterTypes.dateTime,
            'field': 'recordedDate'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'patient.reference',
            'referencedResource': 'Patient'
        }
    },
    'Appointment': {
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'participant.actor.reference',
            'referencedResource': 'Patient'
        }
    },
    'AuditEvent': {
        'date': {
            'type': fhirFilterTypes.instant,
            'field': 'recorded'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'agent.who.reference',
            'referencedResource': 'Patient'
        },
        'agent': {
            'type': fhirFilterTypes.reference,
            'field': 'agent.who.reference',
            'referencedResource': 'Person'
        }
    },
    'CapabilityStatement': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'CarePlan': {
        'date': {
            'type': fhirFilterTypes.period,
            'field': 'period'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'CareTeam': {
        'date': {
            'type': fhirFilterTypes.period,
            'field': 'period'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'Claim': {
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'patient.reference',
            'referencedResource': 'Patient'
        }
    },
    'ClinicalImpression': {
        'date': {
            'type': fhirFilterTypes.dateTime,
            'field': 'date'
        }
    },
    'CodeSystem': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'CompartmentDefinition': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'Composition': {
        'date': {
            'type': fhirFilterTypes.dateTime,
            'field': 'date'
        }
    },
    'ConceptMap': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'Condition': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'Consent': {
        'date': {
            'type': fhirFilterTypes.dateTime,
            'field': 'dateTime'
        }
    },
    'Coverage': {
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'beneficiary.reference',
            'referencedResource': 'Patient'
        }
    },
    'Device': {
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'patient.reference',
            'referencedResource': 'Patient'
        }
    },
    'DeviceRequest': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        }
    },
    'DiagnosticReport': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        },
        'date': {
            'type': fhirFilterTypes.dateTime,
            'field': 'effectiveDateTime'
        }
    },
    'DocumentReference': {
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'Encounter': {
        'date': {
            'type': fhirFilterTypes.period,
            'field': 'period'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'EpisodeOfCare': {
        'date': {
            'type': fhirFilterTypes.period,
            'field': 'period'
        }
    },
    'ExplanationOfBenefit': {
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'patient.reference',
            'referencedResource': 'Patient'
        }
    },
    'FamilyMemberHistory': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        },
        'date': {
            'type': fhirFilterTypes.dateTime,
            'field': 'date'
        }
    },
    'Flag': {
        'date': {
            'type': fhirFilterTypes.period,
            'field': 'period'
        }
    },
    'GraphDefinition': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'HealthcareService': {
        'healthcareService': {
            'type': fhirFilterTypes.string,
            'field': 'id'
        },
        'organization': {
            'type': fhirFilterTypes.reference,
            'field': 'providedBy.reference',
            'referencedResource': 'Organization'
        }
    },
    'ImplementationGuide': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'Immunization': {
        'date': {
            'type': fhirFilterTypes.dateTime,
            'field': 'occurrenceDateTime'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'patient.reference',
            'referencedResource': 'Patient'
        }
    },
    'InsurancePlan': {
        'organization': {
            'type': fhirFilterTypes.reference,
            'field': 'ownedBy.reference',
            'referencedResource': 'Organization'
        }
    },
    'Location': {
        'location': {
            'type': fhirFilterTypes.string,
            'field': 'id'
        }
    },
    'List': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        },
        'date': {
            'type': fhirFilterTypes.dateTime,
            'field': 'date'
        }
    },
    'MeasureReport': {
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'Medication': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        }
    },
    'MedicationAdministration': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        }
    },
    'MedicationDispense': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        }
    },
    'MedicationRequest': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'MedicationStatement': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        }
    },
    'MessageDefinition': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'NamingSystem': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'Observation': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        },
        'date': {
            'type': fhirFilterTypes.period,
            'field': 'effectivePeriod'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'OperationDefinition': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'Organization': {
        'organization': {
            'type': fhirFilterTypes.string,
            'field': 'id'
        }
    },
    'Patient': {
        'patient': {
            'type': fhirFilterTypes.string,
            'field': 'id'
        }
    },
    'Person': {
        'agent': {
            'type': fhirFilterTypes.string,
            'field': 'id'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'link.target.reference',
            'referencedResource': 'Patient'
        }
    },
    'Practitioner': {
        'practitioner': {
            'type': fhirFilterTypes.string,
            'field': 'id'
        }
    },
    'PractitionerRole': {
        'practitioner': {
            'type': fhirFilterTypes.reference,
            'field': 'practitioner.reference',
            'referencedResource': 'Practitioner'
        },
        'organization': {
            'type': fhirFilterTypes.reference,
            'field': 'organization.reference',
            'referencedResource': 'Organization'
        },
        'location': {
            'type': fhirFilterTypes.reference,
            'field': 'location.reference',
            'referencedResource': 'Location'
        },
        'healthcareService': {
            'type': fhirFilterTypes.reference,
            'field': 'healthcareService.reference',
            'referencedResource': 'HealthcareService'
        }
    },
    'Procedure': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        },
        'date': {
            'type': fhirFilterTypes.dateTime,
            'field': 'performedDateTime'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'QuestionnaireResponse': {
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'RelatedPerson': {
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'patient.reference',
            'referencedResource': 'Patient'
        }
    },
    'RiskAssessment': {
        'date': {
            'type': fhirFilterTypes.dateTime,
            'field': 'occurrenceDateTime'
        }
    },
    'Schedule': {
        'schedule': {
            'type': fhirFilterTypes.string,
            'field': 'id'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'actor.reference',
            'referencedResource': 'Patient'
        },
        'practitioner': {
            'type': fhirFilterTypes.reference,
            'field': 'actor.reference',
            'referencedResource': 'Practitioner'
        },
        'location': {
            'type': fhirFilterTypes.reference,
            'field': 'actor.reference',
            'referencedResource': 'Location'
        },
        'healthcareService': {
            'type': fhirFilterTypes.reference,
            'field': 'actor.reference',
            'referencedResource': 'HealthcareService'
        }
    },
    'SearchParameter': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'ServiceRequest': {
        'code': {
            'type': fhirFilterTypes.token,
            'field': 'code'
        },
        'patient': {
            'type': fhirFilterTypes.reference,
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'Slot': {
        'schedule': {
            'type': fhirFilterTypes.reference,
            'field': 'schedule.reference',
            'referencedResource': 'Schedule'
        }
    },
    'StructureDefinition': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'StructureMap': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'SupplyRequest': {
        'date': {
            'type': fhirFilterTypes.dateTime,
            'field': 'occurrenceDateTime'
        }
    },
    'TerminologyCapabilities': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        }
    },
    'ValueSet': {
        'name': {
            'type': fhirFilterTypes.string,
            'field': 'name'
        },
        'url': {
            'type': fhirFilterTypes.uri,
            'field': 'url'
        }
    }
};

module.exports = {
    fhirFilterTypes: fhirFilterTypes,
    customFilterQueries: customFilterQueries
};
