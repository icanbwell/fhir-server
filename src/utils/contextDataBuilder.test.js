const { describe, test, expect } = require('@jest/globals');
const { buildContextDataForHybridStorage } = require('./contextDataBuilder');

describe('contextDataBuilder', () => {
    describe('buildContextDataForHybridStorage', () => {
        test.each([
            [
                'Group with members (no configManager)',
                'Group',
                {
                    id: 'group-1',
                    resourceType: 'Group',
                    member: [
                        { entity: { reference: 'Patient/1' } },
                        { entity: { reference: 'Patient/2' } }
                    ]
                },
                null,
                {
                    groupMembers: [
                        { entity: { reference: 'Patient/1' } },
                        { entity: { reference: 'Patient/2' } }
                    ],
                    resourceType: 'Group',
                    resourceId: 'group-1'
                }
            ],
            [
                'Group with empty members array',
                'Group',
                {
                    id: 'group-2',
                    resourceType: 'Group',
                    member: []
                },
                null,
                {
                    groupMembers: [],
                    resourceType: 'Group',
                    resourceId: 'group-2'
                }
            ],
            [
                'Group without member field',
                'Group',
                {
                    id: 'group-3',
                    resourceType: 'Group'
                },
                null,
                {
                    groupMembers: [],
                    resourceType: 'Group',
                    resourceId: 'group-3'
                }
            ],
            [
                'Patient resource',
                'Patient',
                {
                    id: 'patient-1',
                    resourceType: 'Patient'
                },
                null,
                null
            ],
            [
                'Observation resource',
                'Observation',
                {
                    id: 'obs-1',
                    resourceType: 'Observation'
                },
                null,
                null
            ]
        ])('%s', (_, resourceType, resource, configManager, expected) => {
            const result = buildContextDataForHybridStorage(resourceType, resource, null, configManager);
            expect(result).toEqual(expected);
        });

        test('Group with config + header sets useMongoGroupMembers flag', () => {
            const resource = {
                id: 'group-4',
                resourceType: 'Group',
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const configManager = { enableMongoGroupMembers: true };
            const requestInfo = { headers: { subgroupmemberrequest: 'true' } };
            const result = buildContextDataForHybridStorage('Group', resource, requestInfo, configManager);
            expect(result).toEqual({
                groupMembers: [{ entity: { reference: 'Patient/1' } }],
                resourceType: 'Group',
                resourceId: 'group-4',
                useMongoGroupMembers: true
            });
        });

        test('Group with config enabled but no header does not set flag', () => {
            const resource = {
                id: 'group-5',
                resourceType: 'Group',
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const configManager = { enableMongoGroupMembers: true };
            const result = buildContextDataForHybridStorage('Group', resource, null, configManager);
            expect(result).not.toHaveProperty('useMongoGroupMembers');
        });

        test('Group with header but config disabled does not set flag', () => {
            const resource = {
                id: 'group-6',
                resourceType: 'Group',
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const configManager = { enableMongoGroupMembers: false };
            const requestInfo = { headers: { subgroupmemberrequest: 'true' } };
            const result = buildContextDataForHybridStorage('Group', resource, requestInfo, configManager);
            expect(result).not.toHaveProperty('useMongoGroupMembers');
        });
    });
});
