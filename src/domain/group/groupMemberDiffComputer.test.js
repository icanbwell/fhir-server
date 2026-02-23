const { describe, test, expect } = require('@jest/globals');
const { GroupMemberDiffComputer } = require('./groupMemberDiffComputer');

describe('GroupMemberDiffComputer', () => {
    describe('compute', () => {
        test.each([
            [
                'adding new members',
                new Set(['Patient/1']),
                [
                    { entity: { reference: 'Patient/1' } },
                    { entity: { reference: 'Patient/2' } },
                    { entity: { reference: 'Patient/3' } }
                ],
                {
                    additions: [
                        { entity: { reference: 'Patient/2' } },
                        { entity: { reference: 'Patient/3' } }
                    ],
                    removals: []
                }
            ],
            [
                'removing members',
                new Set(['Patient/1', 'Patient/2', 'Patient/3']),
                [
                    { entity: { reference: 'Patient/1' } }
                ],
                {
                    additions: [],
                    removals: [
                        { entity: { reference: 'Patient/2' } },
                        { entity: { reference: 'Patient/3' } }
                    ]
                }
            ],
            [
                'adding and removing',
                new Set(['Patient/1', 'Patient/2']),
                [
                    { entity: { reference: 'Patient/1' } },
                    { entity: { reference: 'Patient/3' } }
                ],
                {
                    additions: [
                        { entity: { reference: 'Patient/3' } }
                    ],
                    removals: [
                        { entity: { reference: 'Patient/2' } }
                    ]
                }
            ],
            [
                'no changes',
                new Set(['Patient/1', 'Patient/2']),
                [
                    { entity: { reference: 'Patient/1' } },
                    { entity: { reference: 'Patient/2' } }
                ],
                {
                    additions: [],
                    removals: []
                }
            ],
            [
                'empty current, adding members',
                new Set(),
                [
                    { entity: { reference: 'Patient/1' } },
                    { entity: { reference: 'Patient/2' } }
                ],
                {
                    additions: [
                        { entity: { reference: 'Patient/1' } },
                        { entity: { reference: 'Patient/2' } }
                    ],
                    removals: []
                }
            ],
            [
                'removing all members',
                new Set(['Patient/1', 'Patient/2']),
                [],
                {
                    additions: [],
                    removals: [
                        { entity: { reference: 'Patient/1' } },
                        { entity: { reference: 'Patient/2' } }
                    ]
                }
            ],
            [
                'null incoming members',
                new Set(['Patient/1']),
                null,
                {
                    additions: [],
                    removals: [
                        { entity: { reference: 'Patient/1' } }
                    ]
                }
            ],
            [
                'members without entity reference ignored',
                new Set(['Patient/1']),
                [
                    { entity: { reference: 'Patient/1' } },
                    { entity: {} },
                    { inactive: true }
                ],
                {
                    additions: [],
                    removals: []
                }
            ]
        ])('%s', (_, currentReferences, incomingMembers, expected) => {
            const result = GroupMemberDiffComputer.compute(currentReferences, incomingMembers);

            expect(result.additions.length).toBe(expected.additions.length);
            expect(result.removals.length).toBe(expected.removals.length);

            result.additions.forEach((addition, idx) => {
                expect(addition.entity.reference).toBe(expected.additions[idx].entity.reference);
            });

            const removalRefs = result.removals.map(r => r.entity.reference).sort();
            const expectedRemovalRefs = expected.removals.map(r => r.entity.reference).sort();
            expect(removalRefs).toEqual(expectedRemovalRefs);
        });
    });
});
