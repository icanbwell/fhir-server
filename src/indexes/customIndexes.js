/**
 * List of custom indexes to add.  (* means these indexes should be applied to all collections)
 * @description All options described here: https://www.mongodb.com/docs/manual/reference/method/db.collection.createIndex/
 */
module.exports = {
    customIndexes: {
        '*': [
            {
                keys: {
                    'id': 1
                },
                options: {
                    // unique: true,
                    name: 'id_1'
                },
                exclude: [
                    'AuditEvent_4_0_0',
                    'Practitioner_4_0_0'
                ]
            },
            {
                keys: {
                    'meta.lastUpdated': -1,
                    '_sourceId': 1
                },
                options: {
                    name: 'reverse_meta.lastUpdated_1'
                },
                exclude: [
                    'AuditEvent_4_0_0'
                ]
            },
            {
                keys: {
                    'meta.source': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'meta.source_1'
                },
                exclude: [
                    'AuditEvent_4_0_0'
                ]
            },
            {
                keys: {
                    'meta.security.system': 1,
                    'meta.security.code': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'security.system_code_1'
                },
                exclude: [
                    'AuditEvent_4_0_0',
                    'Practitioner_4_0_0'
                ]
            },
            {
                keys: {
                    '_access.medstar': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'security._access_medstar'
                },
                exclude: [
                    'AuditEvent_4_0_0'
                ]
            },
            {
                keys: {
                    '_access.Thedacare': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'security._access_Thedacare'
                },
                exclude: [
                    'AuditEvent_4_0_0'
                ]
            },
            {
                keys: {
                    '_sourceId': 1,
                    '_sourceAssigningAuthority': 1,
                    '_uuid': 1,
                },
                options: {
                    name: 'sourceId._sourceAssigningAuthority'
                },
                exclude: [
                    'AuditEvent_4_0_0'
                ]
            },
            {
                keys: {
                    '_uuid': 1,
                },
                options: {
                    name: 'uuid'
                }
            },
            {
                keys: {
                    '_sourceId': 1,
                    '_uuid': 1,
                },
                options: {
                    name: 'sourceId'
                },
                exclude: [
                    'AuditEvent_4_0_0'
                ]
            },
        ],
        '*_History': [
            {
                keys: {
                    'id': 1
                },
                options: {
                    // unique: true,
                    name: 'id_1'
                }
            },
            {
                keys: {
                    'resource._uuid': 1,
                    'resource.meta.versionId': 1
                },
                options: {
                    // unique: true,
                    name: 'resource_by_uuid'
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
        'Account_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'account.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'account.subjectSourceid_uuid'
                }
            }
        ],
        'AllergyIntolerance_4_0_0': [
            {
                keys: {
                    'patient._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'allergyIntolerance.patientUuid_uuid'
                }
            },
            {
                keys: {
                    'patient._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'allergyIntolerance.patientSourceid_uuid'
                }
            }
        ],
        'Appointment_4_0_0': [
            {
                keys: {
                    'participant.actor._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'appointment.participantActorUuid_uuid'
                }
            },
            {
                keys: {
                    'participant.actor._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'appointment_participantActorSourceid_uuid'
                }
            }
        ],
        'AuditEvent_4_0_0': [
            {
                keys: {
                    'id': 1
                },
                options: {
                    // unique: true,
                    name: 'id_1'
                }
            },
            {
                keys: {
                    'recorded': 1,
                    '_access.medstar': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_auditEvent_recorded_access_medstar'
                }
            },
            {
                keys: {
                    'recorded': 1,
                    'entity.what._sourceId': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_auditEvent_recorded_entity'
                }
            },
            {
                keys: {
                    'recorded': 1,
                    'agent.who._sourceId': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_auditEvent_recorded_who'
                }
            },
            {
                keys: {
                    'recorded': 1,
                    '_uuid': 1,
                },
                options: {
                    name: 'helix_auditEvent_recorded_uuid'
                }
            },
            {
                keys: {
                    'recorded': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_auditEvent_recorded_sourceId'
                }
            },

        ],
        'Basic_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'basic.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'basic.subjectSourceid_uuid'
                }
            }
        ],
        'CarePlan_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'carePlan.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'carePlan.subjectSourceid_uuid'
                }
            }
        ],
        'CareTeam_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'careTeam.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'careTeam.subjectSourceid_uuid'
                }
            }
        ],
        'ChargeItem_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'chargeItem.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'chargeItem.subjectSourceid_uuid'
                }
            }
        ],
        'Claim_4_0_0': [
            {
                keys: {
                    'patient._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'claim.patientUuid_uuid'
                }
            },
            {
                keys: {
                    'patient._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'claim.patientSourceid_uuid'
                }
            }
        ],
        'ClaimResponse_4_0_0': [
            {
                keys: {
                    'patient._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'claimResponse.patientUuid_uuid'
                }
            },
            {
                keys: {
                    'patient._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'claimResponse.patientSourceid_uuid'
                }
            }
        ],
        'Condition_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'condition.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'condition.subjectSourceid_uuid'
                }
            }
        ],
        'Consent_4_0_0': [
            {
               keys: {
                    'patient._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'consent_graphql_1'
                }
            }
        ],
        'Contract_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'contract.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'contract.subjectSourceid_uuid'
                }
            }
        ],
        'Communication_4_0_0': [
            {
               keys: {
                    'status': 1,
                    'category.coding.system': 1,
                    'category.coding.code': 1,
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'health_notifications'
                }
            }
        ],
        'Coverage_4_0_0': [
            {
                keys: {
                    'beneficiary._sourceId': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_coverage_1'
                }
            },
            {
                keys: {
                    'beneficiary._uuid': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_coverage_uuid'
                }
            }
        ],
        'CoverageEligibilityRequest_4_0_0': [
            {
                keys: {
                    'patient._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'coverageEligibilityRequest.patientUuid_uuid'
                }
            },
            {
                keys: {
                    'patient._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'coverageEligibilityRequest.patientSourceid_uuid'
                }
            }
        ],
        'CoverageEligibilityResponse_4_0_0': [
            {
                keys: {
                    'patient._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'coverageEligibilityResponse.patientUuid_uuid'
                }
            },
            {
                keys: {
                    'patient._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'coverageEligibilityResponse.patientSourceid_uuid'
                }
            }
        ],
        'DiagnosticReport_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'diagnoticReport.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'diagnoticReport.subjectSourceid_uuid'
                }
            }
        ],
        'DocumentReference_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1,
                },
                options: {
                    name: 'patient_verification_1'
                }
            },
        ],
        'Encounter_4_0_0': [
            {
                keys: {
                    'subject._sourceId': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_encounter_1'
                }
            },
            {
                keys: {
                    'subject._uuid': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_encounter_uuid'
                }
            },
            {
                keys: {
                    '_access.Thedacare': 1,
                    'meta.source': 1,
                    '_uuid': 1,
                    'meta.lastUpdated': 1,
                },
                options: {
                    name: 'access_Thedacare.meta_source.uuid.meta_lastUpdated'
                }
            }
        ],
        'EnrollmentRequest_4_0_0': [
            {
                keys: {
                    'candidate._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'enrollmentRequest.candidateUuid_uuid'
                }
            },
            {
                keys: {
                    'candidate._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'enrollmentRequest.candidateSourceid_uuid'
                }
            }
        ],
        'EpisodeOfCare_4_0_0': [
            {
                keys: {
                    'patient._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'episodeOfCare.patientUuid_uuid'
                }
            },
            {
                keys: {
                    'patient._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'episodeOfCare.patientSourceid_uuid'
                }
            }
        ],
        'ExplanationOfBenefit_4_0_0': [
            {
                keys: {
                    'patient._sourceId': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'patient.reference_1'
                }
            },
            {
                keys: {
                    'patient._uuid': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'patient.reference_uuid'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    '_uuid': 1,
                    'meta.lastUpdated': 1
                },
                options: {
                    name: 'access_bwell.uuid.meta_lastUpdated'
                }
            }
        ],
        'Flag_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'flag.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'flag.subjectSourceid_uuid'
                }
            }
        ],
        'ImagingStudy_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'imagingStudy.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'imagingStudy.subjectSourceid_uuid'
                }
            }
        ],
        'Immunization_4_0_0': [
            {
                keys: {
                    'patient._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'immunization_patient_uuid'
                }
            },
            {
                keys: {
                    'patient._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'immunization_patient_sourceId'
                }
            }
        ],
        'Invoice_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'invoice.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'invoice.subjectSourceid_uuid'
                }
            }
        ],
        'HealthcareService_4_0_0': [
            {
                keys: {
                    'providedBy._uuid': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'providedBy.reference_1'
                }
            },
            {
                keys: {
                    'providedBy._uuid': 1,
                    'providedBy._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'healthcareService.providedBy_uuid_sourceId_uuid'
                }
            }
        ],
        'List_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'list.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'list.subjectSourceid_uuid'
                }
            }
        ],
        'Location_4_0_0': [
            {
                keys: {
                    'managingOrganization._sourceId': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'managingOrganization.reference_1'
                }
            },
            {
                keys: {
                    'managingOrganization._uuid': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'managingOrganization.reference_uuid'
                }
            }
        ],
        'MeasureReport_4_0_0': [
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'measureReport.subject_sourceId_uuid'
                }
            },
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'measureReport.subject_uuid_uuid'
                }
            }
        ],
        'MedicationAdministration_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'medicationAdministration.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'medicationAdministration.subjectSourceid_uuid'
                }
            }
        ],
        'MedicationRequest_4_0_0': [
            {
                keys: {
                    'subject._sourceId': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_medication_request_1'
                }
            },
            {
                keys: {
                    'subject._uuid': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_medication_request_uuid'
                }
            }
        ],
        'MedicationDispense_4_0_0': [
            {
                keys: {
                    'subject._sourceId': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_medication_dispense_1'
                }
            },
            {
                keys: {
                    'subject._uuid': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'helix_medication_dispense_uuid'
                }
            }
        ],
        'MedicationStatement_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                },
                options: {
                    name: 'helix_medication_statement_1'
                }
            }
        ],
        'Observation_4_0_0': [
            {
                keys: {
                    'effectiveDateTime': -1,
                    '_sourceId': 1,
                    'subject._sourceId': 1
                },
                options: {
                    name: 'reverse_helix_observation_effective_1'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    'effectiveDateTime': -1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'reverse_helix_observation_effective_2'
                }
            },
            {
                keys: {
                    'effectiveDateTime': -1,
                    '_sourceId': 1,
                    'subject._uuid': 1
                },
                options: {
                    name: 'reverse_helix_observation_effective_uuid_1'
                }
            },
            {
                keys: {
                    'subject._uuid': 1,
                    'effectiveDateTime': -1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'reverse_helix_observation_effective_uuid_2'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    '_uuid': -1,
                    'meta.lastUpdated': 1,
                },
                options: {
                    name: 'access_bwell.uuid.meta_lastUpdated'
                }
            }
        ],
        'Organization_4_0_0': [
            {
                keys: {
                    'type.coding.code': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'organization_type_code_1'
                }
            },
            {
                keys: {
                    'identifier.system': 1,
                    'identifier.value': 1,
                    '_sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'organization.identifierSystemValue_sourceId_uuid'
                }
            }
        ],
        'OrganizationAffiliation_4_0_0': [
            {
                keys: {
                    'participatingOrganization._sourceId': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'helix_organization_reference_1'
                }
            },
            {
                keys: {
                    'participatingOrganization._uuid': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'helix_organization_reference_uuid'
                }
            }
        ],
        'Patient_4_0_0': [
            {
                keys: {
                    'identifier.value': 1,
                    'identifier.system': 1,
                    '_sourceId': 1
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
                    '_sourceId': 1
                },
                options: {
                    name: 'name.given_1'
                }
            }
        ],
        'Person_4_0_0': [
            {
                keys: {
                    'telecom.system': 1,
                    'telecom.code': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'telecom.system_code_1'
                }
            },
            {
                keys: {
                    'identifier.value': 1,
                    'identifier.system': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'identifier.value_1'
                }
            },
            {
                keys: {
                    'name.family': 1,
                    'name.given': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'name.family_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.text': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'bwell_name.text_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.family': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'bwell_name.family_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.suffix': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'bwell_name.suffix_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.given': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'bwell_name.given_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.prefix': 1,
                    '_sourceId': 1
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
                    name: 'person.linkTargetReference'
                }
            },
            {
                keys: {
                    'link.target._uuid': 1,
                    '_uuid': 1

                },
                options: {
                    name: 'person.linkTarget_uuid_uuid'
                }
            },
            {
                keys: {
                    'link.target._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'person.linkTarget_sourceId_uuid'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    '_uuid': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'person.bwell.uuid.sourceId'
                }
            },
            {
                keys: {
                    'meta.security.code': 1,
                    '_uuid': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'person.meta_security_code.uuid.sourceId'
                }
            },
            {
                keys: {
                    'address.postalCode': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'person.address_postalCode_uuid'
                }
            }
        ],
        'Practitioner_4_0_0': [
            {
                keys: {
                    'id': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'practitioner.id_uuid'
                }
            },
            {
                keys: {
                    'name.family': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'practitioner.name_family.uuid'
                }
            },
            {
                keys: {
                    '_sourceAssigningAuthority': 1
                },
                options: {
                    name: 'practition.sourceAssigningAuthority'
                }
            },
            {
                keys: {
                    'meta.security.system': 1,
                    'meta.security.code': 1,
                    '_sourceId': 1,
                    'id': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'practitioner.metaSecuritySystemCode_sourceIdId_uuid'
                },
            }
        ],
        'PractitionerRole_4_0_0': [
            {
                keys: {
                    'practitioner._sourceId': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'practitioner.reference_1'
                }
            },
            {
                keys: {
                    'practitioner._uuid': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'practitioner.reference_uuid'
                }
            },
            {
                keys: {
                    'organization._sourceId': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'organization.reference_1'
                }
            },
            {
                keys: {
                    'organization._uuid': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'organization.reference_uuid'
                }
            },
            {
                keys: {
                    'location._sourceId': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'location.reference_1'
                }
            },
            {
                keys: {
                    'location._uuid': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'location.reference_uuid'
                }
            },
            {
                keys: {
                    '_access.medstar': 1,
                    '_uuid': 1,
                },
                options: {
                    name: 'security._access_medstar_1_uuid_1',
                }
            }
        ],
        'Procedure_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'procedure.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'procedure.subjectSourceid_uuid'
                }
            }
        ],
        'Provenance_4_0_0': [
            {
                keys: {
                    'target._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'provenance.targetUuid_uuid'
                }
            },
            {
                keys: {
                    'target._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'provenance.targetSourceid_uuid'
                }
            }
        ],
        'QuestionnaireResponse_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    'questionnaire': 1,
                    'status': 1,
                    'authored': -1,
                    '_uuid': 1
                },
                options: {
                    name: 'consent_graphql_1'
                }
            }
        ],
        'RelatedPerson_4_0_0': [
            {
                keys: {
                    'patient._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'related_person_patient_uuid'
                }
            },
            {
                keys: {
                    'patient._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'related_person_patient_sourceId'
                }
            }
        ],
        'Schedule_4_0_0': [
            {
                keys: {
                    'actor._sourceId': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'actor.reference_1'
                }
            },
            {
                keys: {
                    'actor._uuid': 1,
                    '_sourceId': 1
                },
                options: {
                    name: 'actor.reference_uuid'
                }
            }
        ],
        'ServiceRequest_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'serviceRequest.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'serviceRequest.subjectSourceid_uuid'
                }
            }
        ],
        'Specimen_4_0_0': [
            {
                keys: {
                    'subject._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'specimen.subjectUuid_uuid'
                }
            },
            {
                keys: {
                    'subject._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'specimen.subjectSourceid_uuid'
                }
            }
        ],
        'SupplyDelivery_4_0_0': [
            {
                keys: {
                    'patient._uuid': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'supplyDelivery.patientUuid_uuid'
                }
            },
            {
                keys: {
                    'patient._sourceId': 1,
                    '_uuid': 1
                },
                options: {
                    name: 'supplyDelivery.patientSourceid_uuid'
                }
            }
        ],
        'Task_4_0_0': [
            {
                keys: {
                    'for._sourceId': 1,
                    'status': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'for_reference_status_1'
                }
            },
            {
                keys: {
                    'for._uuid': 1,
                    'status': 1,
                    '_sourceId': 1,
                },
                options: {
                    name: 'for_reference_status_uuid'
                }
            }
        ],
        'Vitals_4_0_0': [
            {
                keys: {
                    'category.coding.code': 1,
                    'subject._uuid': 1,
                    'subject.sourceId': 1,
                    'effectiveDateTime': -1,
                    '_uuid': 1
                },
                options: {
                    name: 'health_vitals_1'
                }
            }
        ]
    }
};
