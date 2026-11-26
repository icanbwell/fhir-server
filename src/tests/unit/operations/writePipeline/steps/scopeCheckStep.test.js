const { describe, test, expect, jest } = require('@jest/globals');
const { ScopesValidator } = require('../../../../../operations/security/scopesValidator');
const { ScopeCheckStep } = require('../../../../../operations/writePipeline/steps/scopeCheckStep');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../operations/writePipeline/writeItem');
const { WRITE_FAILURE_STAGE } = require('../../../../../operations/writePipeline/writeFailure');
const { WriteContext } = require('../../../../../operations/writePipeline/writeContext');

const context = new WriteContext({
    requestInfo: { requestId: 'request-1' },
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: true
});

const profile = { name: 'merge', accessRequested: 'u', action: 'merge' };

/**
 * Builds a scopes validator that forbids the given resource types and allows the rest.
 */
const buildScopesValidator = (forbiddenResourceTypes) => {
    const scopesValidator = Object.create(ScopesValidator.prototype);
    scopesValidator.isScopesValidAsync = jest.fn(async ({ resourceType }) =>
        forbiddenResourceTypes.includes(resourceType)
            ? { issue: [{ severity: 'error', code: 'forbidden', details: { text: `no access to ${resourceType}` } }] }
            : undefined
    );
    return scopesValidator;
};

/**
 * Builds one active item per resource type, with synthetic ids.
 */
const buildItems = (resourceTypes) => resourceTypes.map(
    (resourceType, index) => new WriteItem({ index, incoming: { resourceType, id: `id-${index}` } })
);

describe('ScopeCheckStep', () => {
    test('checks the scopes once per resource type, with the profile and the context', async () => {
        const scopesValidator = buildScopesValidator([]);
        const step = new ScopeCheckStep({ scopesValidator });
        const items = buildItems(['Patient', 'Observation', 'Patient', 'Observation', 'Patient']);

        await step.runAsync({ items, context, profile });

        expect(scopesValidator.isScopesValidAsync.mock.calls.map(([args]) => args)).toStrictEqual([
            { requestInfo: context.requestInfo, resourceType: 'Patient', accessRequested: 'u', action: 'merge', base_version: '4_0_0' },
            { requestInfo: context.requestInfo, resourceType: 'Observation', accessRequested: 'u', action: 'merge', base_version: '4_0_0' }
        ]);
        expect(items.every((item) => item.isActive)).toBe(true);
    });

    test('fails every item of a forbidden resource type at the SCOPE stage and leaves the rest active', async () => {
        const scopesValidator = buildScopesValidator(['Observation']);
        const step = new ScopeCheckStep({ scopesValidator });
        const items = buildItems(['Patient', 'Observation', 'Observation']);

        await step.runAsync({ items, context, profile });

        expect(scopesValidator.isScopesValidAsync).toHaveBeenCalledTimes(2);
        expect(items.map((item) => item.status)).toStrictEqual([
            WRITE_ITEM_STATUS.ACTIVE,
            WRITE_ITEM_STATUS.FAILED,
            WRITE_ITEM_STATUS.FAILED
        ]);
        expect(items.slice(1).map((item) => ({
            stage: item.failure.stage,
            subject: item.failure.subject,
            text: item.failure.operationOutcome.issue[0].details.text
        }))).toStrictEqual([
            {
                stage: WRITE_FAILURE_STAGE.SCOPE,
                subject: { id: 'id-1', uuid: undefined, sourceAssigningAuthority: undefined, resourceType: 'Observation' },
                text: 'no access to Observation'
            },
            {
                stage: WRITE_FAILURE_STAGE.SCOPE,
                subject: { id: 'id-2', uuid: undefined, sourceAssigningAuthority: undefined, resourceType: 'Observation' },
                text: 'no access to Observation'
            }
        ]);
    });
});
