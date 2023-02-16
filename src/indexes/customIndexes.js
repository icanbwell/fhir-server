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
                    'AuditEvent_4_0_0'
                ]
            },
            {
                keys: {
                    'meta.lastUpdated': -1,
                    'id': 1
                },
                options: {
                    name: 'reverse_meta.lastUpdated_1'
                }
            },
            {
                keys: {
                    'meta.source': 1,
                    'id': 1
                },
                options: {
                    name: 'meta.source_1'
                }
            },
            {
                keys: {
                    'meta.security.system': 1,
                    'meta.security.code': 1,
                    'id': 1
                },
                options: {
                    name: 'security.system_code_1'
                },
                exclude: [
                    'AuditEvent_4_0_0'
                ]
            },
            {
                keys: {
                    '_access.medstar': 1,
                    'id': 1
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
                    'id': 1
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
                    '_access.medstar': 1,
                    'id': 1,
                    'meta.lastUpdated': 1,
                },
                options: {
                    name: 'helix_auditEvent_security_access_medstar'
                }
            },
            {
                keys: {
                    '_access.medstar': 1,
                    'id': 1,
                    'recorded': 1,
                },
                options: {
                    name: 'helix_auditEvent_recorded_access_medstar'
                }
            },
            {
                keys: {
                    'entity.what._sourceId': 1,
                    'id': 1,
                    'recorded': 1
                },
                options: {
                    name: 'helix_auditEvent_recorded_entity'
                }
            },
            {
                keys: {
                    'agent.who._sourceId': 1,
                    'id': 1,
                    'recorded': 1
                },
                options: {
                    name: 'helix_auditEvent_recorded_who'
                }
            },
        ],
        'Coverage_4_0_0': [
            {
                keys: {
                    'beneficiary._sourceId': 1,
                    'id': 1,
                },
                options: {
                    name: 'helix_coverage_1'
                }
            },
            {
                keys: {
                    'beneficiary._uuid': 1,
                    'id': 1,
                },
                options: {
                    name: 'helix_coverage_uuid'
                }
            }
        ],
        'Encounter_4_0_0': [
            {
                keys: {
                    'subject._sourceId': 1,
                    'id': 1,
                },
                options: {
                    name: 'helix_encounter_1'
                }
            },
            {
                keys: {
                    'subject._uuid': 1,
                    'id': 1,
                },
                options: {
                    name: 'helix_encounter_uuid'
                }
            }
        ],
        'ExplanationOfBenefit_4_0_0': [
            {
                keys: {
                    'patient._sourceId': 1,
                    'id': 1,
                },
                options: {
                    name: 'patient.reference_1'
                }
            },
            {
                keys: {
                    'patient._uuid': 1,
                    'id': 1,
                },
                options: {
                    name: 'patient.reference_uuid'
                }
            }
        ],
        'Location_4_0_0': [
            {
                keys: {
                    'managingOrganization._sourceId': 1,
                    'id': 1,
                },
                options: {
                    name: 'managingOrganization.reference_1'
                }
            },
            {
                keys: {
                    'managingOrganization._uuid': 1,
                    'id': 1,
                },
                options: {
                    name: 'managingOrganization.reference_uuid'
                }
            }
        ],
        'MedicationRequest_4_0_0': [
            {
                keys: {
                    'subject._sourceId': 1,
                    'id': 1,
                },
                options: {
                    name: 'helix_medication_request_1'
                }
            },
            {
                keys: {
                    'subject._uuid': 1,
                    'id': 1,
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
                    'id': 1,
                },
                options: {
                    name: 'helix_medication_dispense_1'
                }
            },
            {
                keys: {
                    'subject._uuid': 1,
                    'id': 1,
                },
                options: {
                    name: 'helix_medication_dispense_uuid'
                }
            }
        ],
        'Observation_4_0_0': [
            {
                keys: {
                    'effectiveDateTime': -1,
                    'id': 1,
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
                    'id': 1,
                },
                options: {
                    name: 'reverse_helix_observation_effective_2'
                }
            },
            {
                keys: {
                    'effectiveDateTime': -1,
                    'id': 1,
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
                    'id': 1,
                },
                options: {
                    name: 'reverse_helix_observation_effective_uuid_2'
                }
            }
        ],
        'OrganizationAffiliation_4_0_0': [
            {
                keys: {
                    'participatingOrganization._sourceId': 1,
                    'id': 1
                },
                options: {
                    name: 'helix_organization_reference_1'
                }
            },
            {
                keys: {
                    'participatingOrganization._uuid': 1,
                    'id': 1
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
                    'id': 1
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
                    'id': 1
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
                    'id': 1
                },
                options: {
                    name: 'telecom.system_code_1'
                }
            },
            {
                keys: {
                    'identifier.value': 1,
                    'identifier.system': 1,
                    'id': 1
                },
                options: {
                    name: 'identifier.value_1'
                }
            },
            {
                keys: {
                    'name.family': 1,
                    'name.given': 1,
                    'id': 1
                },
                options: {
                    name: 'name.family_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.text': 1,
                    'id': 1
                },
                options: {
                    name: 'bwell_name.text_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.family': 1,
                    'id': 1
                },
                options: {
                    name: 'bwell_name.family_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.suffix': 1,
                    'id': 1
                },
                options: {
                    name: 'bwell_name.suffix_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.given': 1,
                    'id': 1
                },
                options: {
                    name: 'bwell_name.given_1'
                }
            },
            {
                keys: {
                    '_access.bwell': 1,
                    'name.prefix': 1,
                    'id': 1
                },
                options: {
                    name: 'bwell_name.prefix_1'
                }
            }
        ],
        'PractitionerRole_4_0_0': [
            {
                keys: {
                    'practitioner._sourceId': 1,
                    'id': 1
                },
                options: {
                    name: 'practitioner.reference_1'
                }
            },
            {
                keys: {
                    'practitioner._uuid': 1,
                    'id': 1
                },
                options: {
                    name: 'practitioner.reference_uuid'
                }
            },
            {
                keys: {
                    'organization._sourceId': 1,
                    'id': 1
                },
                options: {
                    name: 'organization.reference_1'
                }
            },
            {
                keys: {
                    'organization._uuid': 1,
                    'id': 1
                },
                options: {
                    name: 'organization.reference_uuid'
                }
            },
            {
                keys: {
                    'location._sourceId': 1,
                    'id': 1
                },
                options: {
                    name: 'location.reference_1'
                }
            },
            {
                keys: {
                    'location._uuid': 1,
                    'id': 1
                },
                options: {
                    name: 'location.reference_uuid'
                }
            }
        ],
        'Schedule_4_0_0': [
            {
                keys: {
                    'actor._sourceId': 1,
                    'id': 1
                },
                options: {
                    name: 'actor.reference_1'
                }
            },
            {
                keys: {
                    'actor._uuid': 1,
                    'id': 1
                },
                options: {
                    name: 'actor.reference_uuid'
                }
            }
        ],
        'Task_4_0_0': [
            {
                keys: {
                    'for._sourceId': 1,
                    'status': 1,
                    'id': 1,
                },
                options: {
                    name: 'for_reference_status_1'
                }
            },
            {
                keys: {
                    'for._uuid': 1,
                    'status': 1,
                    'id': 1,
                },
                options: {
                    name: 'for_reference_status_uuid'
                }
            }
        ]
    }
};
