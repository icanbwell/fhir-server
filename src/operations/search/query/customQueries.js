/**
 * This file defines the custom query filters
 * The format is we specify the filter passed in the query.  then we define the resourceType for it and mappings that
 *  map the resource we're searching for that filter and the reference property in that resource to use
 */
/*
    The format is that we list the resourceType, then the query parameter and then the type and name of field to filter
    Try to keep this in list in alphabetical order to make it easier to search
 */
const customFilterQueries = {
    'Account': {
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
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
    'Appointment': {
        'patient': {
            'type': 'reference',
            'field': 'participant.actor.reference',
            'referencedResource': 'Patient'
        }
    },
    'AuditEvent': {
        'date': {
            'type': 'instant',
            'field': 'recorded'
        },
        'patient': {
            'type': 'reference',
            'field': 'agent.who.reference',
            'referencedResource': 'Patient'
        },
        'agent': {
            'type': 'reference',
            'field': 'agent.who.reference',
            'referencedResource': 'Person'
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
        },
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'CareTeam': {
        'date': {
            'type': 'period',
            'field': 'period'
        },
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'Claim': {
        'patient': {
            'type': 'reference',
            'field': 'patient.reference',
            'referencedResource': 'Patient'
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
        },
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'Consent': {
        'date': {
            'type': 'dateTime',
            'field': 'dateTime'
        }
    },
    'Coverage': {
        'patient': {
            'type': 'reference',
            'field': 'beneficiary.reference',
            'referencedResource': 'Patient'
        }
    },
    'Device': {
        'patient': {
            'type': 'reference',
            'field': 'patient.reference',
            'referencedResource': 'Patient'
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
    'DocumentReference': {
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'Encounter': {
        'date': {
            'type': 'period',
            'field': 'period'
        },
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'EpisodeOfCare': {
        'date': {
            'type': 'period',
            'field': 'period'
        }
    },
    'ExplanationOfBenefit': {
        'patient': {
            'type': 'reference',
            'field': 'patient.reference',
            'referencedResource': 'Patient'
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
    'HealthcareService': {
        'healthcareService': {
            'type': 'string',
            'field': 'id'
        },
        'organization': {
            'type': 'reference',
            'field': 'providedBy.reference',
            'referencedResource': 'Organization'
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
        },
        'patient': {
            'type': 'reference',
            'field': 'patient.reference',
            'referencedResource': 'Patient'
        }
    },
    'InsurancePlan': {
        'organization': {
            'type': 'reference',
            'field': 'ownedBy.reference',
            'referencedResource': 'Organization'
        }
    },
    'Location': {
        'location': {
            'type': 'string',
            'field': 'id'
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
    'MeasureReport': {
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
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
        },
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
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
    'Organization': {
        'organization': {
            'type': 'string',
            'field': 'id'
        }
    },
    'Patient': {
        'patient': {
            'type': 'string',
            'field': 'id'
        }
    },
    'Person': {
        'agent': {
            'type': 'string',
            'field': 'id'
        },
        'patient': {
            'type': 'reference',
            'field': 'link.target.reference',
            'referencedResource': 'Patient'
        }
    },
    'Practitioner': {
        'practitioner': {
            'type': 'string',
            'field': 'id'
        }
    },
    'PractitionerRole': {
        'practitioner': {
            'type': 'reference',
            'field': 'practitioner.reference',
            'referencedResource': 'Practitioner'
        },
        'organization': {
            'type': 'reference',
            'field': 'organization.reference',
            'referencedResource': 'Organization'
        },
        'location': {
            'type': 'reference',
            'field': 'location.reference',
            'referencedResource': 'Location'
        },
        'healthcareService': {
            'type': 'reference',
            'field': 'healthcareService.reference',
            'referencedResource': 'HealthcareService'
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
        },
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'QuestionnaireResponse': {
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'RelatedPerson': {
        'patient': {
            'type': 'reference',
            'field': 'patient.reference',
            'referencedResource': 'Patient'
        }
    },
    'RiskAssessment': {
        'date': {
            'type': 'dateTime',
            'field': 'occurrenceDateTime'
        }
    },
    'Schedule': {
        'schedule': {
            'type': 'string',
            'field': 'id'
        },
        'patient': {
            'type': 'reference',
            'field': 'actor.reference',
            'referencedResource': 'Patient'
        },
        'practitioner': {
            'type': 'reference',
            'field': 'actor.reference',
            'referencedResource': 'Practitioner'
        },
        'location': {
            'type': 'reference',
            'field': 'actor.reference',
            'referencedResource': 'Location'
        },
        'healthcareService': {
            'type': 'reference',
            'field': 'actor.reference',
            'referencedResource': 'HealthcareService'
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
        },
        'patient': {
            'type': 'reference',
            'field': 'subject.reference',
            'referencedResource': 'Patient'
        }
    },
    'Slot': {
        'schedule': {
            'type': 'reference',
            'field': 'schedule.reference',
            'referencedResource': 'Schedule'
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
    customFilterQueries: customFilterQueries
};
