const { describe, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../../utils/configManager');
const { ResourceValidator } = require('../../../../../operations/common/resourceValidator');
const { ValidateUpdateResultStep } = require('../../../../../operations/writePipeline/steps/validateUpdateResultStep');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../operations/writePipeline/writeContext');
const { WRITE_FAILURE_STAGE } = require('../../../../../operations/writePipeline/writeFailure');

const failedOutcome = {
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code: 'invalid', details: { text: 'synthetic failure' } }]
};

/**
 * Builds the step with a validator whose meta check and full validation return the given outcomes,
 * and records each full validation in `fullValidations`.
 */
const buildStep = ({ metaOutcome = null, fullOutcome = null, fullValidations = [] }) => {
    const resourceValidator = Object.create(ResourceValidator.prototype);
    resourceValidator.validateResourceMetaSync = () => metaOutcome;
    resourceValidator.validateResourceAsync = async (args) => {
        fullValidations.push(args);
        return fullOutcome;
    };
    return new ValidateUpdateResultStep({ resourceValidator, configManager: new ConfigManager() });
};

/**
 * Builds an item with a built document, as an update or an insert.
 */
const buildItem = (writeMode) => {
    const incoming = { resourceType: 'Patient', id: 'patient-1', meta: { versionId: '2' } };
    const item = new WriteItem({ index: 0, incoming });
    item.writeMode = writeMode;
    item.stored = writeMode === 'update' ? { resourceType: 'Patient', id: 'patient-1' } : null;
    item.candidate = { ...incoming };
    return item;
};

const context = new WriteContext({
    requestInfo: { requestId: 'request-1', path: '/4_0_0/Patient/patient-1' },
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: false,
    operationName: 'update'
});

describe('ValidateUpdateResultStep', () => {
    test('an update with a valid meta is not validated again, even if full validation would fail', async () => {
        const fullValidations = [];
        const step = buildStep({ fullOutcome: failedOutcome, fullValidations });
        const item = buildItem('update');

        await step.runAsync({ items: [item], context, profile: { accessRequested: 'u' } });

        expect(item.status).toBe(WRITE_ITEM_STATUS.ACTIVE);
        expect(fullValidations).toHaveLength(0);
    });

    test('an update whose meta check fails fails at result validation with the outcome', async () => {
        const step = buildStep({ metaOutcome: failedOutcome });
        const item = buildItem('update');

        await step.runAsync({ items: [item], context, profile: { accessRequested: 'u' } });

        expect(item.status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.RESULT_VALIDATION);
        expect(item.failure.operationOutcome).toStrictEqual(failedOutcome);
    });

    test.each([
        { name: 'a new document that passes full validation stays active', fullOutcome: null, status: WRITE_ITEM_STATUS.ACTIVE },
        { name: 'a new document that fails full validation fails with the outcome', fullOutcome: failedOutcome, status: WRITE_ITEM_STATUS.FAILED }
    ])('$name', async ({ fullOutcome, status }) => {
        const fullValidations = [];
        const step = buildStep({ fullOutcome, fullValidations });
        const item = buildItem('insert');

        await step.runAsync({ items: [item], context, profile: { accessRequested: 'u' } });

        expect(fullValidations).toHaveLength(1);
        expect(item.status).toBe(status);
    });
});
