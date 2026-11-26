const { describe, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../../utils/configManager');
const { ResourceValidator } = require('../../../../../operations/common/resourceValidator');
const { ValidateAgainstStoredStep } = require('../../../../../operations/writePipeline/steps/validateAgainstStoredStep');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../operations/writePipeline/writeContext');
const { WRITE_FAILURE_STAGE } = require('../../../../../operations/writePipeline/writeFailure');

const failedOutcome = {
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code: 'invalid', details: { text: 'synthetic failure' } }]
};

const context = new WriteContext({
    requestInfo: { requestId: 'request-1', path: '/4_0_0/Patient/patient-1' },
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: false,
    operationName: 'update'
});

/**
 * Builds the step with a validator whose `validateResourceAsync` returns `outcome`, or throws
 * `error`, and records each call in `validations`.
 */
const buildStep = ({ outcome = null, error = null, validations = [] } = {}) => {
    const resourceValidator = Object.create(ResourceValidator.prototype);
    resourceValidator.validateResourceAsync = async (args) => {
        validations.push(args);
        if (error) {
            throw error;
        }
        return outcome;
    };
    return new ValidateAgainstStoredStep({ resourceValidator, configManager: new ConfigManager() });
};

/**
 * Builds an item with the given stored document, or none.
 */
const buildItem = ({ stored }) => {
    const item = new WriteItem({
        index: 0,
        incoming: { resourceType: 'Patient', id: 'patient-1', active: true }
    });
    item.stored = stored;
    return item;
};

const STORED = { resourceType: 'Patient', id: 'patient-1', meta: { versionId: '1' } };

describe('ValidateAgainstStoredStep', () => {
    test('validates the body against the stored document with the profile\'s access letter', async () => {
        const validations = [];
        const step = buildStep({ validations });
        const item = buildItem({ stored: STORED });

        await step.runAsync({ items: [item], context, profile: { accessRequested: 'u' } });

        expect(item.status).toBe(WRITE_ITEM_STATUS.ACTIVE);
        expect(validations).toHaveLength(1);
        expect(validations[0]).toMatchObject({
            accessRequested: 'u',
            base_version: '4_0_0',
            resourceType: 'Patient',
            path: '/4_0_0/Patient/patient-1',
            resourceObj: item.incoming,
            currentResource: STORED
        });
        expect(validations[0].resourceToValidate).toMatchObject({ resourceType: 'Patient', id: 'patient-1' });
    });

    test('validates a copy of the body and leaves the incoming resource as it was', async () => {
        const validations = [];
        const step = buildStep({ validations });
        const item = buildItem({ stored: STORED });

        await step.runAsync({ items: [item], context, profile: { accessRequested: 'u' } });

        expect(validations[0].resourceToValidate).not.toBe(item.incoming);
        expect(item.incoming).toStrictEqual({ resourceType: 'Patient', id: 'patient-1', active: true });
    });

    test.each([
        { name: 'no stored document', stored: null },
        { name: 'a stored document without meta', stored: { resourceType: 'Patient', id: 'patient-1' } }
    ])('skips an item with $name', async ({ stored }) => {
        const validations = [];
        const step = buildStep({ outcome: failedOutcome, validations });
        const item = buildItem({ stored });

        await step.runAsync({ items: [item], context, profile: { accessRequested: 'u' } });

        expect(item.status).toBe(WRITE_ITEM_STATUS.ACTIVE);
        expect(validations).toHaveLength(0);
    });

    test('fails the item at stored validation with the outcome', async () => {
        const step = buildStep({ outcome: failedOutcome });
        const item = buildItem({ stored: STORED });

        await step.runAsync({ items: [item], context, profile: { accessRequested: 'u' } });

        expect(item.status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.STORED_VALIDATION);
        expect(item.failure.operationOutcome).toStrictEqual(failedOutcome);
        expect(item.failure.error).toBeNull();
        expect(item.failure.subject).toMatchObject({ resourceType: 'Patient', id: 'patient-1' });
    });

    test('fails the item with the error when validation throws', async () => {
        const error = new Error('validator failed');
        const step = buildStep({ error });
        const item = buildItem({ stored: STORED });

        await step.runAsync({ items: [item], context, profile: { accessRequested: 'u' } });

        expect(item.status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.STORED_VALIDATION);
        expect(item.failure.error).toBe(error);
    });

    test('validates every item and fails only the ones that do not pass', async () => {
        const resourceValidator = Object.create(ResourceValidator.prototype);
        resourceValidator.validateResourceAsync = async ({ resourceObj }) =>
            (resourceObj.id === 'patient-2' ? failedOutcome : null);
        const step = new ValidateAgainstStoredStep({ resourceValidator, configManager: new ConfigManager() });
        const items = ['patient-1', 'patient-2', 'patient-3'].map((id, index) => {
            const item = new WriteItem({ index, incoming: { resourceType: 'Patient', id } });
            item.stored = { ...STORED, id };
            return item;
        });

        await step.runAsync({ items, context, profile: { accessRequested: 'u' } });

        expect(items.map((item) => item.status)).toStrictEqual([
            WRITE_ITEM_STATUS.ACTIVE,
            WRITE_ITEM_STATUS.FAILED,
            WRITE_ITEM_STATUS.ACTIVE
        ]);
    });
});
