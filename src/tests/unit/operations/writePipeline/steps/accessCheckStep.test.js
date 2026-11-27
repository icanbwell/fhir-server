const { describe, test, expect } = require('@jest/globals');
const { AccessCheckStep } = require('../../../../../operations/writePipeline/steps/accessCheckStep');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../operations/writePipeline/writeContext');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../../../../operations/writePipeline/writeFailure');

/**
 * Builds a Patient item with the given index and a synthetic id.
 */
const buildItem = ({ index }) => new WriteItem({
    index,
    incoming: { resourceType: 'Patient', id: `patient-${index}` }
});

/**
 * Builds the access checker the step calls: it records the arguments of each call and returns the
 * given entries.
 */
const buildAccessChecker = ({ entries }) => {
    const calls = [];
    return {
        calls,
        checkAsync: async (args) => {
            calls.push(args);
            return entries;
        }
    };
};

/**
 * Builds a context for a synthetic request.
 */
const buildContext = () => new WriteContext({
    requestInfo: { requestId: 'request-1' },
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: false
});

describe('AccessCheckStep', () => {
    test.each(['u', 'c'])(
        'calls the checker once with the items, the context and the profile accessRequested %s',
        async (accessRequested) => {
            const accessChecker = buildAccessChecker({ entries: [null, null] });
            const step = new AccessCheckStep({ accessChecker });
            const items = [buildItem({ index: 0 }), buildItem({ index: 1 })];
            const context = buildContext();

            await step.runAsync({ items, context, profile: { name: 'fake', accessRequested } });

            expect(accessChecker.calls).toHaveLength(1);
            expect(accessChecker.calls[0].accessRequested).toBe(accessRequested);
            expect(accessChecker.calls[0].items).toBe(items);
            expect(accessChecker.calls[0].context).toBe(context);
        }
    );

    test('fails only the items whose entry is a failure', async () => {
        const failure = new WriteFailure({
            stage: WRITE_FAILURE_STAGE.ACCESS,
            subject: { id: 'patient-1', resourceType: 'Patient' },
            operationOutcome: { resourceType: 'OperationOutcome', issue: [] }
        });
        const accessChecker = buildAccessChecker({ entries: [null, failure] });
        const step = new AccessCheckStep({ accessChecker });
        const items = [buildItem({ index: 0 }), buildItem({ index: 1 })];

        await step.runAsync({
            items,
            context: buildContext(),
            profile: { name: 'fake', accessRequested: 'c' }
        });

        expect(items.map((item) => item.status)).toStrictEqual([
            WRITE_ITEM_STATUS.ACTIVE,
            WRITE_ITEM_STATUS.FAILED
        ]);
        expect(items[1].failure).toBe(failure);
    });

    test.each([
        { itemErrorsFailItem: true, expected: 'checks each item alone and fails only the item that throws' },
        { itemErrorsFailItem: undefined, expected: 'rejects' }
    ])(
        'with itemErrorsFailItem $itemErrorsFailItem, a checker that throws for the batch $expected',
        async ({ itemErrorsFailItem }) => {
            const error = new Error('synthetic access check failure');
            const forbidden = new WriteFailure({
                stage: WRITE_FAILURE_STAGE.ACCESS,
                subject: { id: 'patient-2', resourceType: 'Patient' },
                operationOutcome: { resourceType: 'OperationOutcome', issue: [] }
            });
            const items = [buildItem({ index: 0 }), buildItem({ index: 1 }), buildItem({ index: 2 })];
            const calls = [];
            const accessChecker = {
                checkAsync: async (args) => {
                    calls.push(args);
                    if (args.items.includes(items[1])) {
                        throw error;
                    }
                    return args.items.map((item) => (item === items[2] ? forbidden : null));
                }
            };
            const step = new AccessCheckStep({ accessChecker });
            const context = buildContext();

            const run = step.runAsync({
                items,
                context,
                profile: { name: 'fake', accessRequested: 'u', itemErrorsFailItem }
            });

            if (!itemErrorsFailItem) {
                await expect(run).rejects.toBe(error);
                expect(calls).toHaveLength(1);
                expect(items.every((item) => item.isActive)).toBe(true);
                return;
            }
            await run;
            expect(calls.map((call) => ({
                items: call.items.map((item) => item.index),
                sameContext: call.context === context,
                accessRequested: call.accessRequested
            }))).toStrictEqual([
                { items: [0, 1, 2], sameContext: true, accessRequested: 'u' },
                { items: [0], sameContext: true, accessRequested: 'u' },
                { items: [1], sameContext: true, accessRequested: 'u' },
                { items: [2], sameContext: true, accessRequested: 'u' }
            ]);
            expect(items.map((item) => item.status)).toStrictEqual([
                WRITE_ITEM_STATUS.ACTIVE,
                WRITE_ITEM_STATUS.FAILED,
                WRITE_ITEM_STATUS.FAILED
            ]);
            expect({
                stage: items[1].failure.stage,
                subject: items[1].failure.subject,
                error: items[1].failure.error,
                operationOutcome: items[1].failure.operationOutcome
            }).toStrictEqual({
                stage: WRITE_FAILURE_STAGE.ACCESS,
                subject: { id: 'patient-1', uuid: undefined, sourceAssigningAuthority: undefined, resourceType: 'Patient' },
                error,
                operationOutcome: null
            });
            expect(items[2].failure).toBe(forbidden);
        }
    );
});
