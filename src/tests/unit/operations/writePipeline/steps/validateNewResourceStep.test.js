const { describe, test, expect, jest } = require('@jest/globals');
const { ConfigManager } = require('../../../../../utils/configManager');
const { ResourceValidator } = require('../../../../../operations/common/resourceValidator');
const { RemoteFhirValidator } = require('../../../../../utils/remoteFhirValidator');
const { DatabaseQueryFactory } = require('../../../../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../../../../dataLayer/databaseUpdateFactory');
const { ScopesManager } = require('../../../../../operations/security/scopesManager');
const { PatientFilterManager } = require('../../../../../fhir/patientFilterManager');
const { ValidateNewResourceStep } = require('../../../../../operations/writePipeline/steps/validateNewResourceStep');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../operations/writePipeline/writeItem');
const { WRITE_FAILURE_STAGE } = require('../../../../../operations/writePipeline/writeFailure');

/**
 * Builds a `ResourceValidator` with the real config and scopes manager; it reaches no database.
 */
const buildResourceValidator = () => new ResourceValidator({
    configManager: new ConfigManager(),
    remoteFhirValidator: Object.create(RemoteFhirValidator.prototype),
    databaseQueryFactory: Object.create(DatabaseQueryFactory.prototype),
    databaseUpdateFactory: Object.create(DatabaseUpdateFactory.prototype),
    scopesManager: Object.create(ScopesManager.prototype),
    patientFilterManager: Object.create(PatientFilterManager.prototype)
});

/**
 * Builds a Patient item with a UUID id and no owner tag, which fails the meta check, and the given
 * stored document.
 */
const buildItemWithoutOwnerTag = (stored) => {
    const item = new WriteItem({
        index: 0,
        incoming: {
            resourceType: 'Patient',
            id: '00000000-0000-4000-8000-0000000000e1',
            _uuid: '00000000-0000-4000-8000-0000000000e1',
            meta: {
                source: 'http://example.com/source',
                security: [{ system: 'https://www.icanbwell.com/access', code: 'client' }]
            }
        }
    });
    item.stored = stored;
    return item;
};

/**
 * The id of the item whose meta check throws in the cases that make one throw.
 */
const META_THROWS_ID = 'synthetic-meta-throws';

/**
 * Builds three new Patient items with an owner tag, the second with the id `META_THROWS_ID`.
 */
const buildItemsWithOwnerTag = () => ['synthetic-first', META_THROWS_ID, 'synthetic-third'].map(
    (id, index) => new WriteItem({
        index,
        incoming: {
            resourceType: 'Patient',
            id,
            _uuid: `00000000-0000-4000-8000-00000000000${index}`,
            _sourceAssigningAuthority: 'client',
            meta: {
                source: 'http://example.com/source',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'client' },
                    { system: 'https://www.icanbwell.com/owner', code: 'client' }
                ]
            }
        }
    })
);

/**
 * How an item that the step did not fail reads in the cases that make one meta check throw.
 */
const ACTIVE_WITHOUT_FAILURE = Object.freeze({
    status: WRITE_ITEM_STATUS.ACTIVE,
    stage: undefined,
    subject: undefined,
    error: undefined,
    operationOutcome: undefined
});

/**
 * Builds a `ResourceValidator` whose meta check throws the error for the item with the id
 * `META_THROWS_ID` and runs unchanged for every other item.
 */
const buildValidatorThrowingForOneItem = (error) => {
    const resourceValidator = buildResourceValidator();
    const validateResourceMetaSync =
        resourceValidator.validateResourceMetaSync.bind(resourceValidator);
    jest.spyOn(resourceValidator, 'validateResourceMetaSync').mockImplementation((resource) => {
        if (resource.id === META_THROWS_ID) {
            throw error;
        }
        return validateResourceMetaSync(resource);
    });
    return resourceValidator;
};

describe('ValidateNewResourceStep', () => {
    test.each([
        {
            name: 'no stored document',
            stored: null,
            status: WRITE_ITEM_STATUS.FAILED,
            stage: WRITE_FAILURE_STAGE.INCOMING_META
        },
        {
            name: 'a stored document',
            stored: { resourceType: 'Patient', id: '00000000-0000-4000-8000-0000000000e1' },
            status: WRITE_ITEM_STATUS.ACTIVE,
            stage: null
        }
    ])('checks the meta of an item without an owner tag only when it has $name', async ({
        stored,
        status,
        stage
    }) => {
        const item = buildItemWithoutOwnerTag(stored);
        const step = new ValidateNewResourceStep({ resourceValidator: buildResourceValidator() });

        await step.runAsync({ items: [item] });

        expect(item.status).toBe(status);
        expect(item.failure?.stage ?? null).toBe(stage);
    });

    test.each([{ itemErrorsFailItem: undefined }, { itemErrorsFailItem: false }])(
        'with itemErrorsFailItem $itemErrorsFailItem, a meta check that throws for one item rejects with its error',
        async ({ itemErrorsFailItem }) => {
            const error = new TypeError('synthetic meta check failure');
            const step = new ValidateNewResourceStep({
                resourceValidator: buildValidatorThrowingForOneItem(error)
            });

            const run = step.runAsync({
                items: buildItemsWithOwnerTag(),
                profile: { itemErrorsFailItem }
            });

            await expect(run).rejects.toBe(error);
        }
    );

    test('with itemErrorsFailItem true, a meta check that throws for one item fails only that item at INCOMING_META with the error', async () => {
        const error = new TypeError('synthetic meta check failure');
        const resourceValidator = buildValidatorThrowingForOneItem(error);
        const step = new ValidateNewResourceStep({ resourceValidator });
        const items = buildItemsWithOwnerTag();

        await step.runAsync({ items, profile: { itemErrorsFailItem: true } });

        expect(resourceValidator.validateResourceMetaSync).toHaveBeenCalledTimes(3);
        expect(items.map((item) => ({
            status: item.status,
            stage: item.failure?.stage,
            subject: item.failure?.subject,
            error: item.failure?.error,
            operationOutcome: item.failure?.operationOutcome
        }))).toStrictEqual([
            ACTIVE_WITHOUT_FAILURE,
            {
                status: WRITE_ITEM_STATUS.FAILED,
                stage: WRITE_FAILURE_STAGE.INCOMING_META,
                subject: {
                    id: META_THROWS_ID,
                    uuid: '00000000-0000-4000-8000-000000000001',
                    sourceAssigningAuthority: 'client',
                    resourceType: 'Patient'
                },
                error,
                operationOutcome: null
            },
            ACTIVE_WITHOUT_FAILURE
        ]);
    });
});
