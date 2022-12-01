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
                    'meta.lastUpdated': 1
                },
                options: {
                    name: 'meta.lastUpdated_1'
                }
            },
            {
                keys: {
                    'meta.source': 1
                },
                options: {
                    name: 'meta.source_1'
                }
            },
            {
                keys: {
                    'meta.security.system': 1,
                    'meta.security.code': 1
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
                    '_sourceAssigningAuthority.medstar': 1,
                },
                options: {
                    name: 'sourceId._access_medstar'
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
        'ExplanationOfBenefit_4_0_0': [
            {
                keys: {
                    'patient.reference': 1
                },
                options: {
                    name: 'patient.reference_1'
                }
            }
        ],
        'PractitionerRole_4_0_0': [
            {
                keys: {
                    'practitioner.reference': 1
                },
                options: {
                    name: 'practitioner.reference_1'
                }
            },
            {
                keys: {
                    'organization.reference': 1
                },
                options: {
                    name: 'organization.reference_1'
                }
            },
            {
                keys: {
                    'location.reference': 1
                },
                options: {
                    name: 'location.reference_1'
                }
            }
        ],
        'Schedule_4_0_0': [
            {
                keys: {
                    'actor.reference': 1
                },
                options: {
                    name: 'actor.reference_1'
                }
            }
        ],
        'Location_4_0_0': [
            {
                keys: {
                    'managingOrganization.reference': 1
                },
                options: {
                    name: 'managingOrganization.reference_1'
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
                    'entity.what.reference': 1,
                    'id': 1,
                    'recorded': 1
                },
                options: {
                    name: 'helix_auditEvent_recorded_entity'
                }
            },
            {
                keys: {
                    'agent.who.reference': 1,
                    'id': 1,
                    'recorded': 1
                },
                options: {
                    name: 'helix_auditEvent_recorded_who'
                }
            },
        ],
        'Observation_4_0_0': [
            {
                keys: {
                    'effectiveDateTime': 1,
                    'id': 1,
                    'subject.reference': 1
                },
                options: {
                    name: 'helix_observation_effective_1'
                }
            },
            {
                keys: {
                    'subject.reference': 1,
                    'effectiveDateTime': 1,
                    'id': 1,
                },
                options: {
                    name: 'helix_observation_effective_2'
                }
            }
        ],
        'Person_4_0_0': [
            {
                keys: {
                    'telecom.system': 1,
                    'telecom.code': 1
                },
                options: {
                    name: 'telecom.system_code_1'
                }
            },
            {
                keys: {
                    'identifier.value': 1,
                    'identifier.system': 1,
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
            }
        ],
        'Patient_4_0_0': [
            {
                keys: {
                    'identifier.value': 1,
                    'identifier.system': 1
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
            }
        ],
        'Task_4_0_0': [
            {
                keys: {
                    'for.reference': 1,
                    'status': 1,
                    'id': 1,
                },
                options: {
                    name: 'for_reference_status_1'
                }
            }
        ]
    }
};
