const { describe, test, expect } = require('@jest/globals');
const {
    ADMIN_OPERATIONS,
    UnknownAdminOperationError,
    getAdminOperation
} = require('../../../../../../operations/writePipeline/operations/admin/adminOperations');

/**
 * What each of the five operations is: its change kind, the profile it runs under, whether it
 * smart merges, which of its two resources is the target and which the linked one, the two
 * lookup flags the target loader reads and the access letter the linked resource is checked with.
 */
const EXPECTED_OPERATIONS = [
    {
        name: 'createPersonToPersonLink',
        profile: 'adminLink',
        kind: 'addLink',
        smartMerge: true,
        lookupLinkTarget: true,
        createsMissingTarget: false,
        linkTargetAccess: 'r',
        target: { idParameter: 'bwellPersonId', resourceType: 'Person' },
        linkTarget: { idParameter: 'externalPersonId', resourceType: 'Person' }
    },
    {
        name: 'removePersonToPersonLink',
        profile: 'adminLink',
        kind: 'removeLink',
        smartMerge: false,
        lookupLinkTarget: false,
        createsMissingTarget: false,
        linkTargetAccess: 'r',
        target: { idParameter: 'bwellPersonId', resourceType: 'Person' },
        linkTarget: { idParameter: 'externalPersonId', resourceType: 'Person' }
    },
    {
        name: 'createPersonToPatientLink',
        profile: 'adminLink',
        kind: 'addLink',
        smartMerge: true,
        lookupLinkTarget: true,
        createsMissingTarget: true,
        linkTargetAccess: 'r',
        target: { idParameter: 'externalPersonId', resourceType: 'Person' },
        linkTarget: { idParameter: 'patientId', resourceType: 'Patient' }
    },
    {
        name: 'removePersonToPatientLink',
        profile: 'adminLink',
        kind: 'removeLink',
        smartMerge: false,
        lookupLinkTarget: false,
        createsMissingTarget: false,
        linkTargetAccess: 'r',
        target: { idParameter: 'personId', resourceType: 'Person' },
        linkTarget: { idParameter: 'patientId', resourceType: 'Patient' }
    },
    {
        name: 'updatePatientReference',
        profile: 'adminPatientReference',
        kind: 'rewritePatientReference',
        smartMerge: false,
        lookupLinkTarget: true,
        createsMissingTarget: false,
        linkTargetAccess: 'u',
        target: {
            idParameter: 'resourceId',
            resourceTypeParameter: 'resourceType',
            stripsAnyTypePrefix: true
        },
        linkTarget: { idParameter: 'patientId', resourceType: 'Patient' }
    }
];

/**
 * Returns whether the value and everything reachable from it is frozen.
 */
const isDeeplyFrozen = (value) =>
    value === null ||
    typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen));

describe('ADMIN_OPERATIONS', () => {
    test('has exactly the five admin operations, each keyed by its own name', () => {
        expect(Object.keys(ADMIN_OPERATIONS).sort()).toEqual(
            EXPECTED_OPERATIONS.map(({ name }) => name).sort()
        );
        for (const [key, operation] of Object.entries(ADMIN_OPERATIONS)) {
            expect(operation.name).toBe(key);
        }
    });

    test('is frozen all the way down', () => {
        expect(isDeeplyFrozen(ADMIN_OPERATIONS)).toBe(true);
    });

    test.each(EXPECTED_OPERATIONS)(
        '$name has the expected kind, profile, merge mode, lookups, link target access and resources',
        ({ name, ...expected }) => {
            expect(ADMIN_OPERATIONS[name]).toMatchObject(expected);
        }
    );

    test('only createPersonToPatientLink creates a missing target', () => {
        const creating = Object.values(ADMIN_OPERATIONS)
            .filter((operation) => operation.createsMissingTarget)
            .map((operation) => operation.name);
        expect(creating).toEqual(['createPersonToPatientLink']);
    });

    test('only updatePatientReference checks its linked resource with u, every other one with r', () => {
        const letters = Object.values(ADMIN_OPERATIONS).map((operation) => [
            operation.name,
            operation.linkTargetAccess
        ]);
        expect(letters).toEqual([
            ['createPersonToPersonLink', 'r'],
            ['removePersonToPersonLink', 'r'],
            ['createPersonToPatientLink', 'r'],
            ['removePersonToPatientLink', 'r'],
            ['updatePatientReference', 'u']
        ]);
    });

    test('only the two Person to Patient operations send a manual link event', () => {
        const events = Object.values(ADMIN_OPERATIONS)
            .filter((operation) => operation.manualLinkEvent)
            .map((operation) => [operation.name, operation.manualLinkEvent]);
        expect(events).toEqual([
            ['createPersonToPatientLink', { isLinking: true }],
            ['removePersonToPatientLink', { isLinking: false }]
        ]);
    });

    test.each(EXPECTED_OPERATIONS)(
        '$name has a success message and a no-op message that name only its own parameters',
        ({ name, target, linkTarget }) => {
            const operation = ADMIN_OPERATIONS[name];
            const known = new Set(
                [target.idParameter, target.resourceTypeParameter, linkTarget.idParameter].filter(
                    Boolean
                )
            );
            for (const template of Object.values(operation.messages)) {
                const placeholders = [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
                expect(placeholders.length).toBeGreaterThan(0);
                for (const placeholder of placeholders) {
                    expect(known.has(placeholder)).toBe(true);
                }
            }
            expect(typeof operation.messages.success).toBe('string');
            expect(typeof operation.messages.noOp).toBe('string');
        }
    );

    test.each(EXPECTED_OPERATIONS)(
        '$name echoes only parameters it reads',
        ({ name, target, linkTarget }) => {
            const known = new Set(
                [target.idParameter, target.resourceTypeParameter, linkTarget.idParameter].filter(
                    Boolean
                )
            );
            for (const parameter of ADMIN_OPERATIONS[name].responseParameters) {
                expect(known.has(parameter)).toBe(true);
            }
        }
    );
});

describe('getAdminOperation', () => {
    test.each(EXPECTED_OPERATIONS)('returns the definition of $name', ({ name }) => {
        expect(getAdminOperation(name)).toBe(ADMIN_OPERATIONS[name]);
    });

    test.each([
        { name: undefined },
        { name: null },
        { name: '' },
        { name: 'deletePerson' },
        { name: 'CreatePersonToPersonLink' },
        { name: 'toString' },
        { name: 'constructor' },
        { name: '__proto__' },
        { name: 42 }
    ])('throws an UnknownAdminOperationError for $name', ({ name }) => {
        let thrown;
        try {
            getAdminOperation(name);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(UnknownAdminOperationError);
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.operation).toBe(name);
        expect(thrown.message).toContain('Unknown admin operation');
    });
});
