const { describe, test, expect } = require('@jest/globals');
const { buildContextDataForHybridStorage } = require('./contextDataBuilder');

describe('contextDataBuilder', () => {
    describe('buildContextDataForHybridStorage', () => {
        test.each([
            [
                'Group with members',
                'Group',
                {
                    id: 'group-1',
                    resourceType: 'Group',
                    member: [
                        { entity: { reference: 'Patient/1' } },
                        { entity: { reference: 'Patient/2' } }
                    ]
                },
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
                null
            ],
            [
                'Patient resource',
                'Patient',
                {
                    id: 'patient-1',
                    resourceType: 'Patient'
                },
                null
            ],
            [
                'Observation resource',
                'Observation',
                {
                    id: 'obs-1',
                    resourceType: 'Observation'
                },
                null
            ]
        ])('%s', (_, resourceType, resource, expected) => {
            const result = buildContextDataForHybridStorage(resourceType, resource);
            expect(result).toEqual(expected);
        });
    });
});
