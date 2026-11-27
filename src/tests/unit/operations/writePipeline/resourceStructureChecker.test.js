const { describe, test, expect } = require('@jest/globals');
const { MergeManager } = require('../../../../operations/merge/mergeManager');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { ResourceStructureChecker } = require('../../../../operations/writePipeline/resourceStructureChecker');
const { WRITE_FAILURE_STAGE } = require('../../../../operations/writePipeline/writeFailure');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../operations/writePipeline/writeItem');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

const UUID_A = '00000000-0000-4000-8000-00000000000a';
const OWNER_REQUIRED =
    'Either id passed in resource should be uuid or meta.security tag with system: https://www.icanbwell.com/owner or https://www.icanbwell.com/sourceAssigningAuthority should be present';

/**
 * Builds a synthetic resource of the type with the id and the security tags given as
 * `[system, code]` pairs.
 */
const resourceOf = ({ resourceType = 'Patient', id, security = [] }) => ({
    resourceType,
    ...(id !== undefined && { id }),
    meta: { security: security.map(([system, code]) => ({ system, code })) }
});

/**
 * A checker on the merge manager's error builder and the scopes manager's tag checks.
 */
const checker = new ResourceStructureChecker({
    mergeManager: Object.create(MergeManager.prototype),
    scopesManager: Object.create(ScopesManager.prototype)
});

describe('ResourceStructureChecker', () => {
    test.each([
        {
            name: 'a resource with no id',
            resource: resourceOf({ id: undefined }),
            expected: { diagnostics: 'resource is missing id', expression: ['Patient'] }
        },
        {
            name: 'a resource with no resourceType',
            resource: (({ resourceType, ...rest }) => rest)(resourceOf({ id: UUID_A })),
            expected: {
                diagnostics: 'resource is missing resourceType',
                expression: [`undefined/${UUID_A}`]
            }
        },
        {
            name: 'a resourceType that is not a stored type',
            resource: resourceOf({ resourceType: 'Parameters', id: UUID_A }),
            expected: {
                diagnostics: 'resourceType is not supported',
                expression: [`Parameters/${UUID_A}`]
            }
        },
        {
            name: 'a non-UUID id with neither an owner nor a source assigning authority tag',
            resource: resourceOf({
                id: 'patient-1',
                security: [[SecurityTagSystem.access, 'client-a']]
            }),
            expected: { diagnostics: OWNER_REQUIRED, expression: ['Patient/patient-1'] }
        },
        {
            name: 'a non-UUID id with an owner tag',
            resource: resourceOf({ id: 'patient-1', security: [[SecurityTagSystem.owner, 'client-a']] }),
            expected: null
        },
        {
            name: 'a non-UUID id with a source assigning authority tag',
            resource: resourceOf({
                id: 'patient-1',
                security: [[SecurityTagSystem.sourceAssigningAuthority, 'client-a']]
            }),
            expected: null
        },
        {
            name: 'a UUID id with no tags',
            resource: resourceOf({ id: UUID_A }),
            expected: null
        }
    ])('fails $name at the structure stage only when it has a structural error', ({ resource, expected }) => {
        const item = new WriteItem({ index: 0, incoming: resource });

        checker.failItemsWithStructuralError({ items: [item] });

        if (expected === null) {
            expect(item.status).toBe(WRITE_ITEM_STATUS.ACTIVE);
            expect(checker.findStructuralError(resource)).toBeNull();
            return;
        }
        expect(item.status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.STRUCTURE);
        expect(item.failure.subject).toStrictEqual({
            id: resource.id,
            uuid: undefined,
            sourceAssigningAuthority: undefined,
            resourceType: resource.resourceType
        });
        expect(item.failure.operationOutcome.issue).toStrictEqual([
            {
                severity: 'error',
                code: 'exception',
                details: { text: 'Error merging: ' + JSON.stringify(resource) },
                ...expected
            }
        ]);
    });
});
