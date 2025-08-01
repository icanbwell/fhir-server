const { ACCESS_LOGS_COLLECTION_NAME, CONSENT_OF_LINKED_PERSON_INDEX } = require('../constants');

/**
 * List of custom indexes to add.  (* means these indexes should be applied to all collections)
 * @description All options described here: https://www.mongodb.com/docs/manual/reference/method/db.collection.createIndex/
 */
module.exports = {
    customIndexes: {
        '*': [
            {
                keys: {
                    id: 1
                },
                options: {
                    // unique: true,
                    name: 'id_1'
                },
                exclude: [
                    'AuditEvent_4_0_0',
                    'Practitioner_4_0_0',
                    ACCESS_LOGS_COLLECTION_NAME
                ]
            },
            {
                keys: {
                    'meta.source': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.source_1'
                },
                exclude: [
                    'AuditEvent_4_0_0',
                    ACCESS_LOGS_COLLECTION_NAME
                ]
            },
            {
                keys: {
                    'meta.security.system': 1,
                    'meta.security.code': 1,
                    _uuid: 1
                },
                options: {
                    name: 'security.system_code_1'
                },
                exclude: [
                    'AuditEvent_4_0_0',
                    ACCESS_LOGS_COLLECTION_NAME
                ]
            },
            ...(
                    (
                        process.env.ACCESS_TAGS_INDEXED &&
                        process.env.ACCESS_TAGS_INDEXED.split(',').map((item) => item.trim())
                    ) || []
                ).map(client => ({
                    keys: {
                        [`_access.${client}`]: 1,
                        _uuid: 1
                    },
                    options: {
                        name: `_access_${client}_1._uuid_1`
                    },
                    exclude: [
                        'AuditEvent_4_0_0',
                        'Organization_4_0_0',
                        'Practitioner_4_0_0',
                        ACCESS_LOGS_COLLECTION_NAME
                    ]
            })),
            {
                keys: {
                    'subject._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'subjectUuid_uuid'
                },
                include: [
                    'Account_4_0_0', 'AdverseEvent_4_0_0', 'Basic_4_0_0', 'CarePlan_4_0_0', 'CareTeam_4_0_0', 'ChargeItem_4_0_0',
                    'ClinicalImpression_4_0_0', 'Condition_4_0_0', 'Contract_4_0_0', 'Communication_4_0_0', 'CommunicationRequest_4_0_0',
                    'Composition_4_0_0', 'DeviceRequest_4_0_0', 'DeviceUseStatement_4_0_0', 'DiagnosticReport_4_0_0',
                    'DocumentManifest_4_0_0', 'DocumentReference_4_0_0', 'Encounter_4_0_0', 'Flag_4_0_0', 'Goal_4_0_0', 'GuidanceResponse_4_0_0',
                    'ImagingStudy_4_0_0', 'Invoice_4_0_0', 'List_4_0_0', 'MeasureReport_4_0_0', 'Media_4_0_0',
                    'MedicationAdministration_4_0_0', 'MedicationDispense_4_0_0', 'MedicationRequest_4_0_0', 'MedicationStatement_4_0_0',
                    'Procedure_4_0_0', 'RequestGroup_4_0_0', 'RiskAssessment_4_0_0', 'ServiceRequest_4_0_0', 'Specimen_4_0_0'
                ],
                exclude: [
                    ACCESS_LOGS_COLLECTION_NAME
                ]
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'subjectSourceId_uuid'
                },
                include: [
                    'Account_4_0_0', 'AdverseEvent_4_0_0', 'Basic_4_0_0', 'CarePlan_4_0_0', 'CareTeam_4_0_0', 'ChargeItem_4_0_0',
                    'ClinicalImpression_4_0_0', 'Condition_4_0_0', 'Contract_4_0_0', 'Communication_4_0_0', 'CommunicationRequest_4_0_0',
                    'Composition_4_0_0', 'DeviceRequest_4_0_0', 'DeviceUseStatement_4_0_0', 'DiagnosticReport_4_0_0',
                    'DocumentManifest_4_0_0', 'DocumentReference_4_0_0', 'Encounter_4_0_0', 'Flag_4_0_0', 'Goal_4_0_0', 'GuidanceResponse_4_0_0',
                    'ImagingStudy_4_0_0', 'Invoice_4_0_0', 'List_4_0_0', 'MeasureReport_4_0_0', 'Media_4_0_0',
                    'MedicationAdministration_4_0_0', 'MedicationDispense_4_0_0', 'MedicationRequest_4_0_0', 'MedicationStatement_4_0_0',
                    'Procedure_4_0_0', 'RequestGroup_4_0_0', 'RiskAssessment_4_0_0', 'ServiceRequest_4_0_0', 'Specimen_4_0_0'
                ],
                exclude: [
                    ACCESS_LOGS_COLLECTION_NAME
                ]
            },
            {
                keys: {
                    'patient._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'patientUuid_uuid'
                },
                include: [
                    'AllergyIntolerance_4_0_0', 'BodyStructure_4_0_0', 'Claim_4_0_0', 'ClaimResponse_4_0_0', 'Consent_4_0_0',
                    'CoverageEligibilityRequest_4_0_0', 'CoverageEligibilityResponse_4_0_0', 'DetectedIssue_4_0_0',
                    'Device_4_0_0', 'ExplanationOfBenefit_4_0_0', 'EpisodeOfCare_4_0_0', 'FamilyMemberHistory_4_0_0', 'Immunization_4_0_0',
                    'ImmunizationEvaluation_4_0_0', 'ImmunizationRecommendation_4_0_0', 'MolecularSequence_4_0_0',
                    'NutritionOrder_4_0_0', 'RelatedPerson_4_0_0', 'SupplyDelivery_4_0_0', 'VisionPrescription_4_0_0'
                ],
                exclude: [
                    ACCESS_LOGS_COLLECTION_NAME
                ]
            },
            {
                keys: {
                    'patient._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'patientSourceId_uuid'
                },
                include: [
                    'AllergyIntolerance_4_0_0', 'BodyStructure_4_0_0', 'Claim_4_0_0', 'ClaimResponse_4_0_0', 'Consent_4_0_0',
                    'CoverageEligibilityRequest_4_0_0', 'CoverageEligibilityResponse_4_0_0', 'DetectedIssue_4_0_0',
                    'Device_4_0_0', 'ExplanationOfBenefit_4_0_0', 'EpisodeOfCare_4_0_0', 'FamilyMemberHistory_4_0_0', 'Immunization_4_0_0',
                    'ImmunizationEvaluation_4_0_0', 'ImmunizationRecommendation_4_0_0', 'MolecularSequence_4_0_0',
                    'NutritionOrder_4_0_0', 'RelatedPerson_4_0_0', 'SupplyDelivery_4_0_0', 'VisionPrescription_4_0_0'
                ],
                exclude: [
                    ACCESS_LOGS_COLLECTION_NAME
                ]
            },
            {
                keys: {
                    _uuid: 1
                },
                options: {
                    name: 'uuid',
                    unique: true
                },
                exclude: [
                    'AuditEvent_4_0_0',
                    'InternalAuditEvent_4_0_0',
                    ACCESS_LOGS_COLLECTION_NAME
                ]
            },
            {
                keys: {
                    _sourceId: 1,
                    _uuid: 1
                },
                options: {
                    name: 'sourceId'
                },
                exclude: [
                    'AuditEvent_4_0_0',
                    ACCESS_LOGS_COLLECTION_NAME
                ]
            }
        ],
        '*_History': [
            {
                keys: {
                    id: 1
                },
                options: {
                    // unique: true,
                    name: 'id_1'
                }
            },
            {
                keys: {
                    _ref: 1
                },
                options: {
                    name: 'ref_1'
                },
                include: ['Binary_4_0_0']
            },
            {
                keys: {
                    'resource._uuid': 1
                },
                options: {
                    // unique: true,
                    name: 'resource_uuid_1'
                }
            },
            {
                keys: {
                    'resource.meta.lastUpdated': 1
                },
                options: {
                    name: 'history_resource_lastUpdated'
                }
            }
        ],
        Appointment_4_0_0: [
            {
                keys: {
                    'participant.actor._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'participantActorUuid_uuid'
                }
            },
            {
                keys: {
                    'participant.actor._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'participantActorSourceid_uuid'
                }
            }
        ],
        AppointmentResponse_4_0_0: [
            {
                keys: {
                    'actor._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'actorUuid_uuid'
                }
            },
            {
                keys: {
                    'actor._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'actorSourceid_uuid'
                }
            }
        ],
        AuditEvent_4_0_0: [
            {
                keys: {
                    recorded: -1
                },
                options: {
                    name: 'recorded_1'
                }
            }
        ],
        [ACCESS_LOGS_COLLECTION_NAME]: [
            {
                keys: {
                    'meta.id': 1
                },
                options: {
                    name: 'meta.id_1'
                }
            },
            {
                keys: {
                    timestamp: -1
                },
                options: {
                    name: 'timestamp_1',
                    expireAfterSeconds: process.env.ACCESS_LOGS_EXPIRE_TIME ? Number(process.env.ACCESS_LOGS_EXPIRE_TIME) : 30 * 24 * 60 * 60
                }
            }
        ],
        BiologicallyDerivedProduct_4_0_0: [
            {
                keys: {
                    'collection.source._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'collectionSourceUuid_uuid'
                }
            },
            {
                keys: {
                    'collection.source._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'collectionSourceSourceid_uuid'
                }
            }
        ],
        ChargeItem_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        CodeSystem_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        Communication_4_0_0: [
            {
                keys: {
                    status: 1,
                    'category.coding.system': 1,
                    'category.coding.code': 1,
                    'subject._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'health_notifications'
                }
            }
        ],
        Condition_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        Coverage_4_0_0: [
            {
                keys: {
                    'beneficiary._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'helix_coverage_1'
                }
            },
            {
                keys: {
                    'beneficiary._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'helix_coverage_uuid'
                }
            },
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        DocumentReference_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        Encounter_4_0_0: [
            ...(
                    (
                        process.env.ACCESS_TAGS_INDEXED_ENCOUNTER &&
                        process.env.ACCESS_TAGS_INDEXED_ENCOUNTER.split(',').map((item) => item.trim())
                    ) || []
                ).map(client => ({
                    keys: {
                        [`_access.${client}`]: 1,
                        'meta.source': 1,
                        _uuid: 1,
                        'meta.lastUpdated': 1
                    },
                    options: {
                        name: `_access_${client}_1.meta_source_1._uuid_1.meta_lastUpdated_1`
                    }
            })),
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        EnrollmentRequest_4_0_0: [
            {
                keys: {
                    'candidate._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'candidateUuid_uuid'
                }
            },
            {
                keys: {
                    'candidate._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'candidateSourceid_uuid'
                }
            }
        ],
        ExplanationOfBenefit_4_0_0: [
            ...(
                    (
                        process.env.ACCESS_TAGS_INDEXED_EXPLANATIONOFBENEFIT &&
                        process.env.ACCESS_TAGS_INDEXED_EXPLANATIONOFBENEFIT.split(',').map((item) => item.trim())
                    ) || []
                ).map(client => ({
                    keys: {
                        [`_access.${client}`]: 1,
                        _uuid: 1,
                        'meta.lastUpdated': 1
                    },
                    options: {
                        name: `_access_${client}_1._uuid_1.meta_lastUpdated_1`
                    }
            }))
        ],
        Group_4_0_0: [
            {
                keys: {
                    'member.entity._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'memberEntityUuid_uuid'
                }
            },
            {
                keys: {
                    'member.entity._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'memberEntitySourceid_uuid'
                }
            }
        ],
        HealthcareService_4_0_0: [
            {
                keys: {
                    'providedBy._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'providedBy.reference_1'
                }
            },
            {
                keys: {
                    'location._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'location._uuid_1'
                }
            },
            {
                keys: {
                    'location._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'location._sourceId_1'
                }
            },
            {
                keys: {
                    'providedBy._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'providedBy._sourceId'
                }
            }
        ],
        Library_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        Location_4_0_0: [
            {
                keys: {
                    'identifier.system': 1,
                    'identifier.value': 1,
                    _uuid: 1
                },
                options: {
                    name: 'identifier.system_1_value_1_uuid_1'
                }
            },
            {
                keys: {
                    'managingOrganization._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'managingOrganization.reference_1'
                }
            },
            {
                keys: {
                    'managingOrganization._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'managingOrganization.reference_uuid'
                }
            }
        ],
        Measure_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        MeasureReport_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        MedicationDispense_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        MedicationRequest_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        Observation_4_0_0: [
            {
                keys: {
                    'subject._sourceId': 1,
                    _uuid: 1,
                    effectiveDateTime: -1
                },
                options: {
                    name: 'subject__sourceId._uuid.effectiveDateTime-1'
                }
            },
            {
                keys: {
                    'subject._uuid': 1,
                    _uuid: 1,
                    effectiveDateTime: -1
                },
                options: {
                    name: 'subject__uuid._uuid.effectiveDateTime-1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    _uuid: -1,
                    'meta.lastUpdated': 1
                },
                options: {
                    name: 'access_bwell.uuid.meta_lastUpdated'
                }
            },
            {
                keys: {
                    'category.coding.code': 1,
                    effectiveDateTime: -1,
                    _uuid: 1
                },
                options: {
                    name: 'category_coding_code.effectiveDateTime._uuid_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'meta.lastUpdated': 1,
                    _uuid: 1
                },
                options: {
                    name: '_access.bwell_1_meta.lastUpdated_1__uuid_1'
                }
            }
        ],
        Organization_4_0_0: [
            {
                keys: {
                    'type.coding.code': 1,
                    _uuid: 1
                },
                options: {
                    name: 'type_code_1'
                }
            },
            {
                keys: {
                    'identifier.system': 1,
                    'identifier.value': 1,
                    _uuid: 1
                },
                options: {
                    name: 'identifierSystemValue_uuid'
                }
            },
            ...(
                    (
                        process.env.ACCESS_TAGS_INDEXED_ORGANIZATION &&
                        process.env.ACCESS_TAGS_INDEXED_ORGANIZATION.split(',').map((item) => item.trim())
                    ) || []
                ).map(client => ({
                    keys: {
                        [`_access.${client}`]: 1,
                        _uuid: 1
                    },
                    options: {
                        name: `_access_${client}_1._uuid_1`
                    }
            }))
        ],
        OrganizationAffiliation_4_0_0: [
            {
                keys: {
                    'participatingOrganization._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'helix_organization_reference_1'
                }
            },
            {
                keys: {
                    'participatingOrganization._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'helix_organization_reference_uuid'
                }
            }
        ],
        Patient_4_0_0: [
            {
                keys: {
                    'identifier.value': 1,
                    'identifier.system': 1,
                    _uuid: 1
                },
                options: {
                    name: 'identifier.value_1'
                }
            },
            {
                keys: {
                    'name.family': 1,
                    'name.given': 1
                },
                options: {
                    name: 'name.family_1'
                }
            },
            {
                keys: {
                    'name.given': 1,
                    _uuid: 1
                },
                options: {
                    name: 'name.given_1'
                }
            },
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            },
            {
                keys: {
                    'link.other._uuid': 1
                },
                options: {
                    name: 'link.other._uuid_1'
                }
            }
        ],
        Person_4_0_0: [
            {
                keys: {
                    'telecom.system': 1,
                    'telecom.value': 1,
                    _uuid: 1
                },
                options: {
                    name: 'telecom.system_value_1'
                }
            },
            {
                keys: {
                    'identifier.value': 1,
                    'identifier.system': 1,
                    _uuid: 1
                },
                options: {
                    name: 'identifier.value_1'
                }
            },
            {
                keys: {
                    'name.family': 1,
                    'name.given': 1,
                    _uuid: 1
                },
                options: {
                    name: 'name.family_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.text': 1,
                    _uuid: 1
                },
                options: {
                    name: 'bwell_name.text_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.family': 1,
                    _uuid: 1
                },
                options: {
                    name: 'bwell_name.family_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.suffix': 1,
                    _uuid: 1
                },
                options: {
                    name: 'bwell_name.suffix_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.given': 1,
                    _uuid: 1
                },
                options: {
                    name: 'bwell_name.given_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.prefix': 1,
                    _uuid: 1
                },
                options: {
                    name: 'bwell_name.prefix_1'
                }
            },
            {
                keys: {
                    'link.target.reference': 1
                },
                options: {
                    name: 'linkTargetReference'
                }
            },
            {
                keys: {
                    'link.target._uuid': 1,
                    _uuid: 1

                },
                options: {
                    name: 'linkTarget_uuid_uuid'
                }
            },
            {
                keys: {
                    'link.target._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'linkTarget_sourceId_uuid'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'bwell.uuid'
                }
            },
            {
                keys: {
                    'meta.security.code': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta_security_code.uuid'
                }
            },
            {
                keys: {
                    'address.postalCode': 1,
                    _uuid: 1
                },
                options: {
                    name: 'address_postalCode_uuid'
                }
            },
            {
                keys: {
                    birthDate: 1,
                    _uuid: 1
                },
                options: {
                    name: 'birthDate_uuid'
                }
            },
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        Practitioner_4_0_0: [
            {
                keys: {
                    id: 1,
                    _uuid: 1
                },
                options: {
                    name: 'id_uuid'
                }
            },
            {
                keys: {
                    'name.family': 1,
                    _uuid: 1
                },
                options: {
                    name: 'name_family.uuid'
                }
            },
            {
                keys: {
                    _sourceAssigningAuthority: 1
                },
                options: {
                    name: 'sourceAssigningAuthority'
                }
            },
            {
                keys: {
                    'identifier.system': 1,
                    'identifier.value': 1,
                    _uuid: 1
                },
                options: {
                    name: 'identifier_system.identifier_value._uuid'
                }
            },
            ...(
                    (
                        process.env.ACCESS_TAGS_INDEXED_PRACTITIONER &&
                        process.env.ACCESS_TAGS_INDEXED_PRACTITIONER.split(',').map((item) => item.trim())
                    ) || []
                ).map(client => ({
                    keys: {
                        [`_access.${client}`]: 1,
                        _uuid: 1
                    },
                    options: {
                        name: `_access_${client}_1._uuid_1`
                    }
            }))
        ],
        PractitionerRole_4_0_0: [
            {
                keys: {
                    'practitioner._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'practitioner.reference_1'
                }
            },
            {
                keys: {
                    'practitioner._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'practitioner.reference_uuid'
                }
            },
            {
                keys: {
                    'organization._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'organization.reference_1'
                }
            },
            {
                keys: {
                    'organization._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'organization.reference_uuid'
                }
            },
            {
                keys: {
                    'location._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'location.reference_1'
                }
            },
            {
                keys: {
                    'location._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'location.reference_uuid'
                }
            },
            ...(
                    (
                        process.env.ACCESS_TAGS_INDEXED_PRACTITIONER_ROLE &&
                        process.env.ACCESS_TAGS_INDEXED_PRACTITIONER_ROLE.split(',').map((item) => item.trim())
                    ) || []
                ).map(client => ({
                    keys: {
                        [`_access.${client}`]: 1,
                        _uuid: 1
                    },
                    options: {
                        name: `_access_${client}_1._uuid_1`
                    }
            }))
        ],
        Procedure_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        Provenance_4_0_0: [
            {
                keys: {
                    'target._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'targetUuid_uuid'
                }
            },
            {
                keys: {
                    'target._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'targetSourceid_uuid'
                }
            }
        ],
        Questionaire_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        QuestionnaireResponse_4_0_0: [
            {
                keys: {
                    'subject._uuid': 1,
                    questionnaire: 1,
                    status: 1,
                    authored: -1,
                    _uuid: 1
                },
                options: {
                    name: 'consent_graphql_1'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    questionnaire: 1,
                    status: 1,
                    authored: -1,
                    _uuid: 1
                },
                options: {
                    name: 'consent_graphql_sourceId'
                }
            },
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        ResearchSubject_4_0_0: [
            {
                keys: {
                    'individual._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'individualUuid_uuid'
                }
            },
            {
                keys: {
                    'individual._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'individualSourceid_uuid'
                }
            }
        ],
        Schedule_4_0_0: [
            {
                keys: {
                    'actor._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'actor.reference_1'
                }
            },
            {
                keys: {
                    'actor._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'actor.reference_uuid'
                }
            }
        ],
        Subscription_4_0_0: [
            {
                keys: {
                    'extension.url': 1,
                    'extension.valueString': 1,
                    _uuid: 1
                },
                options: {
                    name: 'extension.url_1_extension.valueString_1_uuid_1'
                }
            }
        ],
        SubscriptionStatus_4_0_0: [
            {
                keys: {
                    'subscription._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'subscription.uuid_1_uuid_1'
                }
            },
            {
                keys: {
                    'extension.url': 1,
                    'extension.valueString': 1,
                    _uuid: 1
                },
                options: {
                    name: 'extension.url_1_extension.valueString_1_uuid_1'
                }
            }
        ],
        SubscriptionTopic_4_0_0: [
            {
                keys: {
                    'identifier.system': 1,
                    'identifier.value': 1,
                    _uuid: 1
                },
                options: {
                    name: 'identifier.system_1_identifier.value_1_uuid_1'
                }
            }
        ],
        SupplyRequest_4_0_0: [
            {
                keys: {
                    'requester._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'requesterUuid_uuid'
                }
            },
            {
                keys: {
                    'requester._sourceId': 1,
                    _uuid: 1
                },
                options: {
                    name: 'requesterSourceid_uuid'
                }
            }
        ],
        Task_4_0_0: [
            {
                keys: {
                    'for._sourceId': 1,
                    status: 1,
                    _uuid: 1
                },
                options: {
                    name: 'for_reference_status_1'
                }
            },
            {
                keys: {
                    'for._uuid': 1,
                    status: 1,
                    _uuid: 1
                },
                options: {
                    name: 'for_reference_status_uuid'
                }
            },
            {
                keys: {
                    'identifier.system': 1,
                    'identifier.value': 1
                },
                options: {
                    name: 'identifier.system_1_identifier.value_1'
                }
            },
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            },
            {
                keys: {
                    'identifier.system': 1,
                    'identifier.value': 1,
                    _uuid: 1
                },
                options: {
                    name: 'identifier.system_1_value_1__uuid_1'
                }
            },
            {
                keys: {
                    'focus._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'focus_uuid_uuid'
                }
            },
            {
                keys: {
                    'for._uuid': 1,
                    _uuid: 1
                },
                options: {
                    name: 'for_uuid_uuid'
                }
            }
       ],
        ValueSet_4_0_0: [
            {
                keys: {
                    'meta.lastUpdated': 1,
                    '_access.bwell': 1,
                    _uuid: 1
                },
                options: {
                    name: 'meta.lastUpdated_1__access.bwell_1__uuid_1'
                }
            }
        ],
        Vitals_4_0_0: [
            {
                keys: {
                    'category.coding.code': 1,
                    'subject._uuid': 1,
                    effectiveDateTime: -1,
                    _uuid: 1
                },
                options: {
                    name: 'health_vitals_1'
                }
            }
        ],
        Consent_4_0_0: [
            {
                keys: {
                    status: 1,
                    'patient._uuid': 1
                },
                options: {
                    name: CONSENT_OF_LINKED_PERSON_INDEX
                }
            }
        ]
    }
};
