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
            'Observation': 'subject.reference',
            'Procedure': 'subject.reference',
            'ServiceRequest': 'subject.reference',
            'CareTeam': 'subject.reference',
            'QuestionnaireResponse': 'subject.reference',
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
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'CodeSystem': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'CompartmentDefinition': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'ConceptMap': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'GraphDefinition': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'ImplementationGuide': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'MessageDefinition': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'NamingSystem': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'OperationDefinition': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'SearchParameter': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'StructureDefinition': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'StructureMap': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'TerminologyCapabilities': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            }
        }
    },
    'ValueSet': {
        'mappings': {
            'name': {
                'type': 'string',
                'field': 'name'
            },
            'url': {
                'type': 'uri',
                'field': 'url'
            }
        }
    },
    'AllergyIntolerance': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            },
            'date': {
                'type': 'datetime',
                'field': 'recordedDate'
            }
        }
    },
    'Condition': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            }
        }
    },
    'DeviceRequest': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            }
        }
    },
    'DiagnosticReport': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            },
            'date': {
                'type': 'dateTime',
                'field': 'effectiveDateTime'
            }

        }
    },
    'FamilyMemberHistory': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            },
            'date': {
                'type': 'dateTime',
                'field': 'date'
            }
        }
    },
    'List': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            },
            'date': {
                'type': 'dateTime',
                'field': 'date'
            }
        }
    },
    'Medication': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            }
        }
    },
    'MedicationAdministration': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            }
        }
    },
    'MedicationDispense': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            }
        }
    },
    'MedicationRequest': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            }
        }
    },
    'MedicationStatement': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            }
        }
    },
    'Observation': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            },
            'date': {
                'type': 'period',
                'field': 'effectivePeriod'
            }
        }
    },
    'Procedure': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            },
            'date': {
                'type': 'dateTime',
                'field': 'performedDateTime'
            }
        }
    },
    'ServiceRequest': {
        'mappings': {
            'code': {
                'type': 'token',
                'field': 'code'
            }
        }
    },
    'AuditEvent': {
        'mappings': {
            'date': {
                'type': 'instant',
                'field': 'recorded'
            }
        }
    },
    'CarePlan': {
        'mappings': {
            'date': {
                'type': 'period',
                'field': 'period'
            }
        }
    },
    'CareTeam': {
        'mappings': {
            'date': {
                'type': 'period',
                'field': 'period'
            }
        }
    },
    'ClinicalImpression': {
        'mappings': {
            'date': {
                'type': 'dateTime',
                'field': 'date'
            }
        }
    },
    'Composition': {
        'mappings': {
            'date': {
                'type': 'dateTime',
                'field': 'date'
            }
        }
    },
    'Consent': {
        'mappings': {
            'date': {
                'type': 'dateTime',
                'field': 'dateTime'
            }
        }
    },
    'Encounter': {
        'mappings': {
            'date': {
                'type': 'period',
                'field': 'period'
            }
        }
    },
    'EpisodeOfCare': {
        'mappings': {
            'date': {
                'type': 'period',
                'field': 'period'
            }
        }
    },
    'Flag': {
        'mappings': {
            'date': {
                'type': 'period',
                'field': 'period'
            }
        }
    },
    'Immunization': {
        'mappings': {
            'date': {
                'type': 'dateTime',
                'field': 'occurrenceDateTime'
            }
        }
    },
    'RiskAssessment': {
        'mappings': {
            'date': {
                'type': 'dateTime',
                'field': 'occurrenceDateTime'
            }
        }
    },
    'SupplyRequest': {
        'mappings': {
            'date': {
                'type': 'dateTime',
                'field': 'occurrenceDateTime'
            }
        }
    }
};

/*
    These queries handle "token" searches in FHIR
    The format is that we list the resourceType, then the filter name and then the type and name of field to filter
    https://www.hl7.org/fhir/searchparameter-registry.html#clinical-code
 */
const customTokenQueries = {};

/*
    These queries handle "date" searches in FHIR
    The format is that we list the resourceType, then the filter name and then the type and name of field to filter
    https://www.hl7.org/fhir/searchparameter-registry.html#clinical-date
 */
const customDateQueries = {};

module.exports = {
    customReferenceQueries: customReferenceQueries,
    customScalarQueries: customScalarQueries,
    customTokenQueries: customTokenQueries,
    customDateQueries: customDateQueries
};
