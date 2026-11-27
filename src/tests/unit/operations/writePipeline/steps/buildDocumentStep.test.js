const { describe, test, expect, jest, afterEach } = require('@jest/globals');
const { FhirResourceWriteSerializer } = require('../../../../../fhir/fhirResourceWriteSerializer');
const { BuildDocumentStep } = require('../../../../../operations/writePipeline/steps/buildDocumentStep');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../operations/writePipeline/writeContext');
const { WRITE_FAILURE_STAGE } = require('../../../../../operations/writePipeline/writeFailure');
const { ConfigManager } = require('../../../../../utils/configManager');

/**
 * Builds a context for a synthetic request.
 */
const buildContext = () => new WriteContext({
    requestInfo: { requestId: 'request-1', headers: {} },
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: true
});

/**
 * Builds three Patient items with synthetic ids.
 */
const buildItems = () => [0, 1, 2].map(
    (index) => new WriteItem({ index, incoming: { resourceType: 'Patient', id: `patient-${index}` } })
);

/**
 * Builds a builder that records the body of each item it builds and fails none.
 */
const buildBuilder = () => {
    const builtBodies = [];
    return {
        builtBodies,
        buildAsync: async ({ item }) => {
            builtBodies.push(item.incoming);
            return null;
        }
    };
};

describe('BuildDocumentStep', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test.each([
        { itemErrorsFailItem: true, expected: 'fails only that item at the BUILD stage' },
        { itemErrorsFailItem: undefined, expected: 'rejects before any item is built' }
    ])(
        'with itemErrorsFailItem $itemErrorsFailItem, a body whose write serialization throws $expected',
        async ({ itemErrorsFailItem }) => {
            const error = new Error('synthetic serialization failure');
            jest.spyOn(FhirResourceWriteSerializer, 'serialize').mockImplementation(({ obj }) => {
                if (obj.id === 'patient-1') {
                    throw error;
                }
                return { ...obj, serialized: true };
            });
            const builder = buildBuilder();
            const step = new BuildDocumentStep({ builder, configManager: new ConfigManager() });
            const items = buildItems();

            const run = step.runAsync({
                items,
                context: buildContext(),
                profile: { name: 'fake', accessRequested: 'u', action: 'merge', itemErrorsFailItem }
            });

            if (!itemErrorsFailItem) {
                await expect(run).rejects.toBe(error);
                expect(builder.builtBodies).toStrictEqual([]);
                return;
            }
            await run;
            expect(builder.builtBodies).toStrictEqual([
                { resourceType: 'Patient', id: 'patient-0', serialized: true },
                { resourceType: 'Patient', id: 'patient-2', serialized: true }
            ]);
            expect(items.map((item) => item.status)).toStrictEqual([
                WRITE_ITEM_STATUS.ACTIVE,
                WRITE_ITEM_STATUS.FAILED,
                WRITE_ITEM_STATUS.ACTIVE
            ]);
            expect({
                stage: items[1].failure.stage,
                subject: items[1].failure.subject,
                error: items[1].failure.error
            }).toStrictEqual({
                stage: WRITE_FAILURE_STAGE.BUILD,
                subject: { id: 'patient-1', uuid: undefined, sourceAssigningAuthority: undefined, resourceType: 'Patient' },
                error
            });
        }
    );
});
