const { describe, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../../utils/configManager');
const { ResourceValidator } = require('../../../../../operations/common/resourceValidator');
const { ValidateResultStep } = require('../../../../../operations/writePipeline/steps/validateResultStep');
const { WriteItem } = require('../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../operations/writePipeline/writeContext');

/**
 * Builds the step with a validator that passes the meta check and records each full validation in
 * `fullValidations`; `stepOptions` are passed to the step's constructor.
 */
const buildStep = ({ fullValidations, stepOptions = {} }) => {
    const resourceValidator = Object.create(ResourceValidator.prototype);
    resourceValidator.validateResourceMetaSync = () => null;
    resourceValidator.validateResourceAsync = async (args) => {
        fullValidations.push(args);
        return null;
    };
    return new ValidateResultStep({
        resourceValidator,
        configManager: new ConfigManager(),
        ...stepOptions
    });
};

/**
 * Builds an item with a built document, as an update or an insert.
 */
const buildItem = (writeMode) => {
    const incoming = { resourceType: 'Person', id: 'person-1', meta: { versionId: '2' } };
    const item = new WriteItem({ index: 0, incoming });
    item.writeMode = writeMode;
    item.stored = writeMode === 'update' ? { resourceType: 'Person', id: 'person-1' } : null;
    item.candidate = { ...incoming };
    return item;
};

const context = new WriteContext({
    requestInfo: { requestId: 'request-1', path: '/4_0_0/Person/person-1' },
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: false,
    operationName: 'update'
});

describe('ValidateResultStep', () => {
    test.each([
        { writeMode: 'update', stepOptions: {}, expected: true },
        { writeMode: 'insert', stepOptions: {}, expected: true },
        { writeMode: 'update', stepOptions: { checkPatientReference: true }, expected: true },
        { writeMode: 'insert', stepOptions: { checkPatientReference: true }, expected: true },
        { writeMode: 'update', stepOptions: { checkPatientReference: false }, expected: false },
        { writeMode: 'insert', stepOptions: { checkPatientReference: false }, expected: false }
    ])(
        'passes checkPatientReference $expected to the validator for $writeMode with step options $stepOptions',
        async ({ writeMode, stepOptions, expected }) => {
            const fullValidations = [];
            const step = buildStep({ fullValidations, stepOptions });
            const item = buildItem(writeMode);

            await step.runAsync({ items: [item], context, profile: { accessRequested: 'u' } });

            expect(fullValidations).toHaveLength(1);
            expect(fullValidations[0].checkPatientReference).toBe(expected);
        }
    );

    test('an update still runs the meta check when the patient reference check is off', async () => {
        const metaChecks = [];
        const fullValidations = [];
        const step = buildStep({ fullValidations, stepOptions: { checkPatientReference: false } });
        step.resourceValidator.validateResourceMetaSync = (resource) => {
            metaChecks.push(resource);
            return null;
        };
        const item = buildItem('update');

        await step.runAsync({ items: [item], context, profile: { accessRequested: 'u' } });

        expect(metaChecks).toStrictEqual([item.candidate]);
        expect(fullValidations).toHaveLength(1);
    });
});
