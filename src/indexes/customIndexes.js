/**
 * List of custom indexes to add.  (* means these indexes should be applied to all collections)
 */
module.exports = {
    customIndexes: {
        '*': [
            {
                'id_1': [
                    'id'
                ]
            },
            {
                'meta.lastUpdated_1': [
                    'meta.lastUpdated'
                ]
            },
            {
                'meta.source_1': [
                    'meta.source'
                ]
            },
            {
                'security.system_code_1': [
                    'meta.security.system',
                    'meta.security.code'
                ]
            }
        ],
        'ExplanationOfBenefit_4_0_0': [
            {
                'patient.reference_1': [
                    'patient.reference'
                ],
            }
        ],
        'PractitionerRole_4_0_0': [
            {
                'practitioner.reference_1': [
                    'practitioner.reference'
                ],
            },
            {
                'organization.reference_1': [
                    'organization.reference'
                ],
            },
            {
                'location.reference_1': [
                    'location.reference'
                ],
            }
        ],
        'Schedule_4_0_0': [
            {
                'actor.reference_1': [
                    'actor.reference'
                ],
            }
        ],
        'Location_4_0_0': [
            {
                'managingOrganization.reference_1': [
                    'managingOrganization.reference'
                ],
            }
        ],
        'AuditEvent_4_0_0': [
            {
                'helix_audit_event_security': [
                    'meta.security.system',
                    'meta.security.code',
                    'id',
                    'meta.lastUpdated',
                ],
                'helix_auditEvent_security_access_medstar': [
                    '_access.medstar',
                    'id',
                    'meta.lastUpdated',
                ],
                'helix_auditEvent_recorded_access_medstar': [
                    '_access.medstar',
                    'id',
                    'recorded',
                ],
                'helix_auditEvent_recorded': [
                    'meta.security.system',
                    'meta.security.code',
                    'id',
                    'recorded',
                ],
                // 'helix_auditEvent_index_type': [
                //     'type.system',
                //     'type.code',
                //     'id',
                //     'meta.lastUpdated',
                // ],
                // 'helix_auditEvent_index_who': [
                //     'type.system',
                //     'type.code',
                //     'agent.who.reference',
                //     'id',
                //     'meta.lastUpdated',
                // ],
                // 'helix_auditEvent_index_entity': [
                //     'type.system',
                //     'type.code',
                //     'entity.what.reference',
                //     'id',
                //     'meta.lastUpdated',
                // ]
            }
        ],
        'Observation_4_0_0': [
            {
                'helix_observation_effective_1': [
                    'effectiveDateTime',
                    'id',
                    'subject.reference'
                ]
            },
            {
                'helix_observation_effective_2': [
                    'subject.reference',
                    'effectiveDateTime',
                    'id',
                ]
            }
        ]
    }
};
