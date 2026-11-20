const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => ({
    ...jest.requireActual('../../../../operations/common/logging'),
    logInfo: jest.fn(),
    logError: jest.fn()
}));

const httpContext = require('express-http-context');
const { logInfo, logError } = require('../../../../operations/common/logging');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../../../constants');
const {
    BadRequestError,
    NotFoundError,
    PreconditionFailedError
} = require('../../../../utils/httpErrors');
const { FastDatabaseBulkInserter } = require('../../../../dataLayer/fastDatabaseBulkInserter');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { CustomTracer } = require('../../../../utils/customTracer');
const { WritePipeline, WRITE_STEP_NAMES } = require('../../../../operations/writePipeline/writePipeline');
const { MERGE_WRITE_PROFILE } = require('../../../../operations/writePipeline/operations/merge/profile');
const { CREATE_WRITE_PROFILE } = require('../../../../operations/writePipeline/operations/create/profile');
const { UPDATE_WRITE_PROFILE } = require('../../../../operations/writePipeline/operations/update/profile');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../operations/writePipeline/writeItem');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../../../operations/writePipeline/writeFailure');
const { WriteContext } = require('../../../../operations/writePipeline/writeContext');
const { ScopeCheckStep } = require('../../../../operations/writePipeline/steps/scopeCheckStep');
const { IdentifyStep } = require('../../../../operations/writePipeline/steps/identifyStep');
const { PrepareBodyStep } = require('../../../../operations/writePipeline/steps/prepareBodyStep');
const { ValidateIncomingStep } = require('../../../../operations/writePipeline/steps/validateIncomingStep');
const { FindExistingStep } = require('../../../../operations/writePipeline/steps/findExistingStep');
const { ValidateNewResourceStep } = require('../../../../operations/writePipeline/steps/validateNewResourceStep');
const { AccessCheckStep } = require('../../../../operations/writePipeline/steps/accessCheckStep');
const { ValidateAgainstStoredStep } = require('../../../../operations/writePipeline/steps/validateAgainstStoredStep');
const { BuildDocumentStep } = require('../../../../operations/writePipeline/steps/buildDocumentStep');
const { ValidateResultStep } = require('../../../../operations/writePipeline/steps/validateResultStep');
const { AttachmentsStep } = require('../../../../operations/writePipeline/steps/attachmentsStep');
const { NoOpStep } = require('../../../../operations/writePipeline/steps/noOpStep');
const { WriteStep } = require('../../../../operations/writePipeline/steps/writeStep');
const { WriteAuditor } = require('../../../../operations/writePipeline/writeAuditor');
const {
    WriteResponder,
    WRITE_RESPONDER_METHOD_NAMES
} = require('../../../../operations/writePipeline/writeResponder');

/**
 * Each step's name, its `WritePipeline` constructor key and its class, in run order.
 */
const STEP_DEFINITIONS = Object.freeze([
    { name: 'scopeCheck', key: 'scopeCheckStep', type: ScopeCheckStep },
    { name: 'identify', key: 'identifyStep', type: IdentifyStep },
    { name: 'prepareBody', key: 'prepareBodyStep', type: PrepareBodyStep },
    { name: 'validateIncoming', key: 'validateIncomingStep', type: ValidateIncomingStep },
    { name: 'findExisting', key: 'findExistingStep', type: FindExistingStep },
    { name: 'validateNewResource', key: 'validateNewResourceStep', type: ValidateNewResourceStep },
    { name: 'accessBeforeBuild', key: 'accessCheckStep', type: AccessCheckStep },
    { name: 'validateAgainstStored', key: 'validateAgainstStoredStep', type: ValidateAgainstStoredStep },
    { name: 'buildDocument', key: 'buildDocumentStep', type: BuildDocumentStep },
    { name: 'validateResult', key: 'validateResultStep', type: ValidateResultStep },
    { name: 'accessOnResult', key: 'accessOnResultStep', type: AccessCheckStep },
    { name: 'attachments', key: 'attachmentsStep', type: AttachmentsStep },
    { name: 'noOpCheck', key: 'noOpStep', type: NoOpStep },
    { name: 'write', key: 'writeStep', type: WriteStep }
]);

/**
 * Builds `count` active Patient items with synthetic ids.
 */
const buildItems = (count) => Array.from(
    { length: count },
    (_, index) => new WriteItem({ index, incoming: { resourceType: 'Patient', id: `patient-${index}` } })
);

/**
 * Builds a `SCOPE` failure for the item, with an empty OperationOutcome.
 */
const buildFailure = (item) => new WriteFailure({
    stage: WRITE_FAILURE_STAGE.SCOPE,
    subject: WriteFailure.subjectOf(item.incoming),
    operationOutcome: { resourceType: 'OperationOutcome', issue: [] }
});

/**
 * Builds a `merge` context for the given request info, without smart merge.
 */
const buildContext = (requestInfo = { requestId: 'request-1' }) => new WriteContext({
    requestInfo,
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: false
});

/**
 * Builds a valid fake profile; `settings` overrides or adds settings.
 */
const buildProfile = (settings = {}) => ({ name: 'fake', accessRequested: 'u', action: 'fake', ...settings });

/**
 * The fake profile every `buildPipeline` pipeline can run unless the test gives its own profiles.
 */
const FAKE_PROFILE = Object.freeze(buildProfile());

/**
 * Builds a variant registry from a map of step names to variant names. Each variant is a fake step
 * that records `<step>.<variant>` in `calls` when it runs.
 */
const buildStepVariants = (registered, calls = []) => Object.fromEntries(
    Object.entries(registered).map(([stepName, variantNames]) => [
        stepName,
        Object.fromEntries(variantNames.map((variantName) => [
            variantName,
            {
                runAsync: jest.fn(async () => {
                    calls.push(`${stepName}.${variantName}`);
                })
            }
        ]))
    ])
);

/**
 * Builds a `WritePipeline` with fake steps, bulk inserter, auditor and logging manager that record
 * each call in `calls`. Each step runs its function in `behaviors`, if any, and `received` keeps
 * the items each step got. The default write step also has a fake `afterFlushAsync` hook that
 * records `afterFlushAsync`. `stepVariants` is the pipeline's variant registry, none by default, and
 * `profiles` are the profiles it can run, `FAKE_PROFILE` and the merge profile by default.
 */
const buildPipeline = ({
    behaviors = {},
    calls = [],
    stepVariants = {},
    profiles = [FAKE_PROFILE, MERGE_WRITE_PROFILE]
} = {}) => {
    const received = {};
    const steps = {};
    const stepsByName = {};
    for (const { name, key, type } of STEP_DEFINITIONS) {
        const step = Object.create(type.prototype);
        step.runAsync = jest.fn(async ({ items: stepItems }) => {
            calls.push(name);
            received[name] = stepItems;
            if (behaviors[name]) {
                await behaviors[name](stepItems);
            }
        });
        steps[key] = step;
        stepsByName[name] = step;
    }
    steps.writeStep.afterFlushAsync = jest.fn(async () => {
        calls.push('afterFlushAsync');
    });
    const databaseBulkInserter = Object.create(FastDatabaseBulkInserter.prototype);
    databaseBulkInserter.executeAsync = jest.fn(async () => {
        calls.push('executeAsync');
        return [];
    });
    const writeAuditor = Object.create(WriteAuditor.prototype);
    writeAuditor.auditAsync = jest.fn(async () => {
        calls.push('writeAuditor.auditAsync');
    });
    const fhirLoggingManager = Object.create(FhirLoggingManager.prototype);
    fhirLoggingManager.logOperationSuccessAsync = jest.fn(async () => {
        calls.push('logOperationSuccessAsync');
    });
    fhirLoggingManager.logOperationFailureAsync = jest.fn(async () => {
        calls.push('logOperationFailureAsync');
    });
    const pipeline = new WritePipeline({
        ...steps,
        stepVariants,
        profiles,
        databaseBulkInserter,
        writeAuditor,
        fhirLoggingManager,
        customTracer: new CustomTracer()
    });
    return { pipeline, calls, received, stepsByName, databaseBulkInserter, writeAuditor, fhirLoggingManager };
};

/**
 * A fake responder whose methods record their names in `calls`. `readAsync` returns `read`, and
 * `outputs` sets what `failureResults`, `results` and `toResponse` return.
 */
class FakeResponder extends WriteResponder {
    /**
     * Keeps the call log, the read and the outputs.
     * @param {string[]} calls
     * @param {{context: WriteContext, items: WriteItem[], requestErrors: Object[], wasIncomingAList: boolean}} read
     * @param {{failureResults?: Object[], results?: Object[], toResponse?: *}} outputs
     */
    constructor ({ calls, read, outputs }) {
        super();
        this.calls = calls;
        this.read = read;
        this.outputs = outputs;
    }

    /**
     * Records the call and returns `read`.
     * @returns {Promise<{context: WriteContext, items: WriteItem[], requestErrors: Object[], wasIncomingAList: boolean}>}
     */
    async readAsync () {
        this.calls.push('readAsync');
        return this.read;
    }

    /**
     * Records the call and returns `outputs.failureResults`, or none.
     * @returns {Object[]}
     */
    failureResults () {
        this.calls.push('failureResults');
        return this.outputs.failureResults ?? [];
    }

    /**
     * Records the call and returns `outputs.results`, or none.
     * @returns {Object[]}
     */
    results () {
        this.calls.push('results');
        return this.outputs.results ?? [];
    }

    /**
     * Records the call and returns `outputs.toResponse`.
     * @returns {*}
     */
    toResponse () {
        this.calls.push('toResponse');
        return this.outputs.toResponse;
    }

    /**
     * Records the call.
     * @returns {void}
     */
    recordMetrics () {
        this.calls.push('recordMetrics');
    }
}

/**
 * Builds a `FakeResponder` that reads the given context, items and request errors, with a spy on
 * each of its methods.
 */
const buildResponder = ({ calls, context, items, requestErrors = [], wasIncomingAList = true, outputs = {} }) => {
    const responder = new FakeResponder({ calls, read: { context, items, requestErrors, wasIncomingAList }, outputs });
    for (const method of WRITE_RESPONDER_METHOD_NAMES) {
        jest.spyOn(responder, method);
    }
    return responder;
};

describe('WritePipeline', () => {
    let httpContextSetSpy;

    beforeEach(() => {
        logInfo.mockReset();
        logError.mockReset();
        httpContextSetSpy = jest.spyOn(httpContext, 'set').mockImplementation(() => undefined);
    });

    afterEach(() => {
        httpContextSetSpy.mockRestore();
    });

    test.each([
        { name: 'a fake profile', profile: FAKE_PROFILE, stepsOff: [] },
        {
            name: 'the merge profile',
            profile: MERGE_WRITE_PROFILE,
            stepsOff: ['validateAgainstStored', 'accessOnResult']
        }
    ])('processAsync runs the fourteen steps in WRITE_STEP_NAMES order, less the steps off, for $name', async ({
        profile,
        stepsOff
    }) => {
        const { pipeline, calls } = buildPipeline();

        await pipeline.processAsync({ profile, context: buildContext(), items: buildItems(2) });

        expect(WRITE_STEP_NAMES).toStrictEqual([
            'scopeCheck',
            'identify',
            'prepareBody',
            'validateIncoming',
            'findExisting',
            'validateNewResource',
            'accessBeforeBuild',
            'validateAgainstStored',
            'buildDocument',
            'validateResult',
            'accessOnResult',
            'attachments',
            'noOpCheck',
            'write'
        ]);
        expect(Object.isFrozen(WRITE_STEP_NAMES)).toBe(true);
        expect(calls).toStrictEqual(WRITE_STEP_NAMES.filter((name) => !stepsOff.includes(name)));
    });

    test.each([
        { profile: CREATE_WRITE_PROFILE },
        { profile: UPDATE_WRITE_PROFILE },
        { profile: MERGE_WRITE_PROFILE }
    ])('the $profile.name profile turns the accessOnResult step off', ({ profile }) => {
        expect(profile.off).toContain('accessOnResult');
    });

    test('runs the accessOnResult step on the active items after validateResult and before attachments', async () => {
        const { pipeline, calls, received } = buildPipeline({
            behaviors: {
                validateResult: (stepItems) => stepItems[0].fail({ failure: buildFailure(stepItems[0]) })
            }
        });
        const items = buildItems(2);

        await pipeline.processAsync({ profile: FAKE_PROFILE, context: buildContext(), items });

        expect(calls.slice(calls.indexOf('validateResult'))).toStrictEqual([
            'validateResult',
            'accessOnResult',
            'attachments',
            'noOpCheck',
            'write'
        ]);
        expect(received.accessOnResult).toStrictEqual([items[1]]);
    });

    test('passes the items, the context and the profile to every step', async () => {
        const { pipeline, stepsByName } = buildPipeline();
        const profile = FAKE_PROFILE;
        const context = buildContext();
        const items = buildItems(2);

        await pipeline.processAsync({ profile, context, items });

        for (const name of WRITE_STEP_NAMES) {
            expect(stepsByName[name].runAsync).toHaveBeenCalledTimes(1);
            expect(stepsByName[name].runAsync.mock.calls[0][0]).toEqual({
                items,
                context,
                profile: { ...profile, off: [], variants: {} }
            });
        }
    });

    test('passes every step a frozen copy of the profile, so a later change to the profile is not seen', async () => {
        const profile = buildProfile({ off: [] });
        const { pipeline, stepsByName } = buildPipeline({
            profiles: [profile],
            behaviors: {
                scopeCheck: () => {
                    profile.accessRequested = 'r';
                    profile.off.push('validateIncoming');
                }
            }
        });

        await pipeline.processAsync({ profile, context: buildContext(), items: buildItems(1) });

        const seenByValidate = stepsByName.validateIncoming.runAsync.mock.calls[0][0].profile;
        expect(seenByValidate).not.toBe(profile);
        expect(seenByValidate.accessRequested).toBe('u');
        expect(seenByValidate.off).toStrictEqual([]);
        expect(Object.isFrozen(seenByValidate)).toBe(true);
        expect(Object.isFrozen(seenByValidate.off)).toBe(true);
    });

    test.each([
        {
            name: 'a variants setting that is a string',
            variants: 'insert',
            registered: { buildDocument: ['insert'] },
            message: 'Write profile "fake" setting "variants" must be an object of step names to variant names'
        },
        {
            name: 'a variants setting that is an array',
            variants: ['insert'],
            registered: { buildDocument: ['insert'] },
            message: 'Write profile "fake" setting "variants" must be an object of step names to variant names'
        },
        {
            name: 'a variant for a step with no variants registered',
            variants: { noOpCheck: 'x' },
            registered: { buildDocument: ['insert'] },
            message: 'Write profile "fake" names a variant for step(s) without variants: noOpCheck'
        },
        {
            name: 'a variant for a step name that does not exist',
            variants: { notAStep: 'x' },
            registered: { buildDocument: ['insert'] },
            message: 'Write profile "fake" names a variant for step(s) without variants: notAStep'
        },
        {
            name: 'a variant that is not registered for its step',
            variants: { buildDocument: 'copy' },
            registered: { buildDocument: ['insert'] },
            message: 'Write profile "fake" names unknown variant(s): buildDocument.copy'
        },
        {
            name: 'a variant name that is an inherited property',
            variants: { buildDocument: 'constructor' },
            registered: { buildDocument: ['insert'] },
            message: 'Write profile "fake" names unknown variant(s): buildDocument.constructor'
        }
    ])('throws when constructed with a profile that has $name', ({ variants, registered, message }) => {
        expect(() => buildPipeline({
            stepVariants: buildStepVariants(registered),
            profiles: [buildProfile({ variants })]
        })).toThrow(message);
    });

    test('runs the named variant instead of the default step', async () => {
        const calls = [];
        const stepVariants = buildStepVariants({ buildDocument: ['copy', 'insert'] }, calls);
        const profile = buildProfile({ variants: { buildDocument: 'copy' } });
        const { pipeline, stepsByName } = buildPipeline({ calls, stepVariants, profiles: [profile] });
        const context = buildContext();
        const items = buildItems(2);

        await pipeline.processAsync({ profile, context, items });

        expect(calls).toStrictEqual(
            WRITE_STEP_NAMES.map((name) => (name === 'buildDocument' ? 'buildDocument.copy' : name))
        );
        expect(stepsByName.buildDocument.runAsync).not.toHaveBeenCalled();
        expect(stepVariants.buildDocument.insert.runAsync).not.toHaveBeenCalled();
        expect(stepVariants.buildDocument.copy.runAsync).toHaveBeenCalledTimes(1);
        expect(stepVariants.buildDocument.copy.runAsync.mock.calls[0][0]).toEqual({
            items,
            context,
            profile: { ...profile, off: [], variants: { buildDocument: 'copy' } }
        });
    });

    test('runs the default step when the profile names no variant, even if variants are registered', async () => {
        const calls = [];
        const { pipeline } = buildPipeline({
            calls,
            stepVariants: buildStepVariants({ buildDocument: ['copy'] }, calls)
        });

        await pipeline.processAsync({
            profile: FAKE_PROFILE,
            context: buildContext(),
            items: buildItems(2)
        });

        expect(calls).toStrictEqual(WRITE_STEP_NAMES);
    });

    test('does not run a named variant when the profile turns its step off', async () => {
        const calls = [];
        const profile = buildProfile({ off: ['buildDocument'], variants: { buildDocument: 'copy' } });
        const { pipeline } = buildPipeline({
            calls,
            stepVariants: buildStepVariants({ buildDocument: ['copy'] }, calls),
            profiles: [profile]
        });

        await pipeline.processAsync({
            profile,
            context: buildContext(),
            items: buildItems(2)
        });

        expect(calls).toStrictEqual(WRITE_STEP_NAMES.filter((name) => name !== 'buildDocument'));
    });

    test("passes the profile's variants in the frozen profile copy", async () => {
        const profile = buildProfile({ variants: { buildDocument: 'copy' } });
        const calls = [];
        const { pipeline, stepsByName } = buildPipeline({
            calls,
            stepVariants: buildStepVariants({ buildDocument: ['copy'] }, calls),
            profiles: [profile],
            behaviors: {
                scopeCheck: () => {
                    profile.variants.buildDocument = 'insert';
                }
            }
        });

        await pipeline.processAsync({ profile, context: buildContext(), items: buildItems(1) });

        const seenByNextStep = stepsByName.findExisting.runAsync.mock.calls[0][0].profile;
        expect(seenByNextStep.variants).toStrictEqual({ buildDocument: 'copy' });
        expect(seenByNextStep.variants).not.toBe(profile.variants);
        expect(Object.isFrozen(seenByNextStep.variants)).toBe(true);
        expect(calls).toContain('buildDocument.copy');
    });

    test.each([
        {
            name: 'a stepVariants that is not an object',
            stepVariants: null,
            message: 'WritePipeline stepVariants must be an object of step names to variant objects'
        },
        {
            name: 'a step whose variants are not an object',
            stepVariants: { buildDocument: null },
            message: 'WritePipeline stepVariants must be an object of step names to variant objects'
        },
        {
            name: 'a step that is not in WRITE_STEP_NAMES',
            stepVariants: { notAStep: { copy: { runAsync: jest.fn() } } },
            message: 'WritePipeline stepVariants names unknown step(s): notAStep'
        },
        {
            name: 'a variant without a runAsync function',
            stepVariants: { buildDocument: { copy: { runAsync: 'not a function' } } },
            message: 'WritePipeline step variant "buildDocument.copy" needs a runAsync function'
        },
        {
            name: 'a write variant without an afterFlushAsync function',
            stepVariants: { write: { copy: { runAsync: jest.fn() } } },
            message: 'WritePipeline step variant "write.copy" needs an afterFlushAsync function'
        },
        {
            name: 'a write variant whose afterFlushAsync is not a function',
            stepVariants: { write: { copy: { runAsync: jest.fn(), afterFlushAsync: 'not a function' } } },
            message: 'WritePipeline step variant "write.copy" needs an afterFlushAsync function'
        }
    ])('throws when constructed with $name', ({ stepVariants, message }) => {
        expect(() => buildPipeline({ stepVariants })).toThrow(message);
    });

    test('accepts a write variant with an afterFlushAsync function and a variant of another step without one', () => {
        const stepVariants = {
            write: { copy: { runAsync: jest.fn(), afterFlushAsync: jest.fn() } },
            buildDocument: { copy: { runAsync: jest.fn() } }
        };

        const { pipeline } = buildPipeline({ stepVariants });

        expect(Object.keys(pipeline.stepVariants)).toStrictEqual(['write', 'buildDocument']);
    });

    test('freezes a copy of stepVariants, so a later change to the argument is not seen', () => {
        const stepVariants = buildStepVariants({ buildDocument: ['copy'] });

        const { pipeline } = buildPipeline({ stepVariants });
        stepVariants.buildDocument.insert = { runAsync: jest.fn() };
        stepVariants.write = { copy: { runAsync: jest.fn() } };

        expect(Object.isFrozen(pipeline.stepVariants)).toBe(true);
        expect(Object.isFrozen(pipeline.stepVariants.buildDocument)).toBe(true);
        expect(Object.keys(pipeline.stepVariants)).toStrictEqual(['buildDocument']);
        expect(Object.keys(pipeline.stepVariants.buildDocument)).toStrictEqual(['copy']);
    });

    test.each(WRITE_STEP_NAMES.map((name) => ({ name })))(
        'does not run $name when the profile turns it off',
        async ({ name }) => {
            const profile = buildProfile({ off: [name] });
            const { pipeline, calls, stepsByName } = buildPipeline({ profiles: [profile] });

            await pipeline.processAsync({
                profile,
                context: buildContext(),
                items: buildItems(2)
            });

            expect(calls).toStrictEqual(WRITE_STEP_NAMES.filter((stepName) => stepName !== name));
            expect(stepsByName[name].runAsync).not.toHaveBeenCalled();
        }
    );

    test('passes only active items to later steps', async () => {
        const { pipeline, received } = buildPipeline({
            behaviors: {
                scopeCheck: (stepItems) => stepItems[0].fail({ failure: buildFailure(stepItems[0]) })
            }
        });
        const items = buildItems(2);

        await pipeline.processAsync({ profile: FAKE_PROFILE, context: buildContext(), items });

        expect(received.scopeCheck).toStrictEqual(items);
        expect(received.identify).toStrictEqual([items[1]]);
        expect(received.write).toStrictEqual([items[1]]);
    });

    test('does not pass items that arrive already failed to any step', async () => {
        const { pipeline, received } = buildPipeline();
        const items = buildItems(2);
        items[0].fail({ failure: buildFailure(items[0]) });

        await pipeline.processAsync({ profile: FAKE_PROFILE, context: buildContext(), items });

        expect(received.scopeCheck).toStrictEqual([items[1]]);
        expect(received.write).toStrictEqual([items[1]]);
    });

    test('does not pass unchanged or queued items to later steps', async () => {
        const { pipeline, received } = buildPipeline({
            behaviors: {
                buildDocument: (stepItems) => {
                    stepItems[0].markUnchanged();
                    stepItems[1].markQueued();
                }
            }
        });
        const items = buildItems(3);

        await pipeline.processAsync({ profile: FAKE_PROFILE, context: buildContext(), items });

        expect(received.buildDocument).toStrictEqual(items);
        expect(received.validateResult).toStrictEqual([items[2]]);
        expect(received.write).toStrictEqual([items[2]]);
    });

    test('returns every item and leaves each failure on its item', async () => {
        const items = buildItems(2);
        const failure = buildFailure(items[1]);
        const { pipeline } = buildPipeline({
            behaviors: {
                scopeCheck: (stepItems) => stepItems[1].fail({ failure })
            }
        });

        const result = await pipeline.processAsync({ profile: FAKE_PROFILE, context: buildContext(), items });

        expect(result).toStrictEqual({ items });
        expect(result.items[1].failure).toBe(failure);
        expect(result.items[1].status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(result.items[0].failure).toBeNull();
        expect(result.items[0].status).toBe(WRITE_ITEM_STATUS.ACTIVE);
    });

    test('runs no further step once no item is active', async () => {
        const { pipeline, calls, received } = buildPipeline({
            behaviors: {
                scopeCheck: (stepItems) => stepItems.forEach((item) => item.fail({ failure: buildFailure(item) }))
            }
        });

        await pipeline.processAsync({ profile: FAKE_PROFILE, context: buildContext(), items: buildItems(2) });

        expect(calls).toStrictEqual(['scopeCheck']);
        expect(received.write).toBeUndefined();
    });

    test('runs no step for an empty batch', async () => {
        const { pipeline, calls } = buildPipeline();

        const result = await pipeline.processAsync({ profile: FAKE_PROFILE, context: buildContext(), items: [] });

        expect(calls).toStrictEqual([]);
        expect(result).toStrictEqual({ items: [] });
    });

    const invalidProfiles = [
        {
            name: 'an unknown setting',
            profile: buildProfile({ readItems: {}, audit: {} }),
            message: 'Write profile "fake" has unknown setting(s): readItems, audit'
        },
        {
            name: 'an unknown step in off',
            profile: buildProfile({ off: ['validateIncoming', 'checkScope', 'bogus'] }),
            message: 'Write profile "fake" turns off unknown step(s): checkScope, bogus'
        },
        {
            name: 'missing string settings',
            profile: { name: 'fake', accessRequested: '', action: 1 },
            message: 'Write profile "fake" needs string setting(s): accessRequested, action'
        },
        {
            name: 'an off setting that is not an array',
            profile: buildProfile({ off: 'validateIncoming' }),
            message: 'Write profile "fake" setting "off" must be an array of step names'
        }
    ];

    test.each(invalidProfiles)('throws when constructed with a profile that has $name', ({ profile, message }) => {
        expect(() => buildPipeline({ profiles: [profile] })).toThrow(new Error(message));
    });

    test('throws when constructed with profiles that are not an array', () => {
        expect(() => buildPipeline({ profiles: { fake: FAKE_PROFILE } })).toThrow(
            new Error('WritePipeline profiles must be an array of write profiles')
        );
    });

    test.each([
        { entry: 'processAsync' },
        { entry: 'runAsync' }
    ])('$entry rejects a profile the pipeline was not constructed with before running any step', async ({ entry }) => {
        const { pipeline, calls, fhirLoggingManager } = buildPipeline();
        const profile = buildProfile();
        const items = buildItems(1);
        items[0].fail({ failure: buildFailure(items[0]) });
        const context = buildContext();
        const responder = buildResponder({ calls, context, items });

        const run = entry === 'processAsync'
            ? pipeline.processAsync({ profile, context, items })
            : pipeline.runAsync({
                profile,
                responder,
                requestInfo: context.requestInfo,
                parsedArgs: new ParsedArgs({ base_version: '4_0_0' }),
                resourceType: 'Patient'
            });

        await expect(run).rejects.toThrow(
            new Error('Write profile "fake" is not registered with the WritePipeline')
        );
        expect(calls).toStrictEqual([]);
        expect(logInfo).not.toHaveBeenCalled();
        expect(logError).not.toHaveBeenCalled();
        expect(fhirLoggingManager.logOperationFailureAsync).not.toHaveBeenCalled();
    });

    test('does not log when no item fails', async () => {
        const { pipeline } = buildPipeline();

        await pipeline.processAsync({ profile: FAKE_PROFILE, context: buildContext(), items: buildItems(2) });

        expect(logInfo).not.toHaveBeenCalled();
        expect(logError).not.toHaveBeenCalled();
    });

    test.each([
        {
            name: 'an outcome failure on an item that arrives failed',
            stepName: 'readItems',
            stage: WRITE_FAILURE_STAGE.STRUCTURE,
            failsWithError: false,
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: 'synthetic diagnostics',
                details: { text: 'synthetic resource content' },
                expression: ['Patient/patient-0']
            }],
            expectedIssues: [{ severity: 'error', code: 'exception', expression: ['Patient/patient-0'] }],
            headers: undefined,
            expectedOriginService: 'unknown'
        },
        {
            name: 'an outcome failure in a step',
            stepName: 'validateIncoming',
            stage: WRITE_FAILURE_STAGE.INCOMING_SCHEMA,
            failsWithError: false,
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    diagnostics: 'synthetic diagnostics',
                    details: { text: 'synthetic resource content' },
                    expression: ['Patient.name']
                },
                { severity: 'warning', code: 'informational', expression: ['Patient.gender'] }
            ],
            expectedIssues: [
                { severity: 'error', code: 'invalid', expression: ['Patient.name'] },
                { severity: 'warning', code: 'informational', expression: ['Patient.gender'] }
            ],
            headers: { 'origin-service': 'synthetic-service' },
            expectedOriginService: 'synthetic-service'
        },
        {
            name: 'an outcome failure without issues',
            stepName: 'accessBeforeBuild',
            stage: WRITE_FAILURE_STAGE.ACCESS,
            failsWithError: false,
            issue: undefined,
            expectedIssues: [],
            headers: {},
            expectedOriginService: 'unknown'
        },
        {
            name: 'an error failure in a step',
            stepName: 'write',
            stage: WRITE_FAILURE_STAGE.WRITE,
            failsWithError: true,
            issue: undefined,
            expectedIssues: undefined,
            headers: { 'origin-service': 'synthetic-service' },
            expectedOriginService: 'synthetic-service'
        }
    ])('logs each failed item once, after the step that failed it: $name', async ({
        stepName,
        stage,
        failsWithError,
        issue,
        expectedIssues,
        headers,
        expectedOriginService
    }) => {
        const subject = { id: 'patient-0', uuid: 'uuid-0', sourceAssigningAuthority: 'client', resourceType: 'Patient' };
        const error = new Error('synthetic failure');
        const failure = failsWithError
            ? new WriteFailure({ stage, subject, error })
            : new WriteFailure({ stage, subject, operationOutcome: { resourceType: 'OperationOutcome', issue } });
        const items = buildItems(2);
        const behaviors = {};
        if (stepName === 'readItems') {
            items[0].fail({ failure });
        } else {
            behaviors[stepName] = (stepItems) => stepItems[0].fail({ failure });
        }
        const { pipeline, calls } = buildPipeline({ behaviors });
        logInfo.mockImplementation(() => calls.push('logInfo'));
        logError.mockImplementation(() => calls.push('logError'));
        const context = buildContext({ requestId: 'request-1', headers });

        await pipeline.processAsync({ profile: FAKE_PROFILE, context, items });

        const expectedFields = {
            operation: 'fake',
            step: stepName,
            stage,
            resourceType: 'Patient',
            id: 'patient-0',
            uuid: 'uuid-0',
            sourceAssigningAuthority: 'client',
            originService: expectedOriginService
        };
        const expectedLevel = failsWithError ? 'logError' : 'logInfo';
        expect(calls).toStrictEqual(
            ['readItems', ...WRITE_STEP_NAMES]
                .flatMap((name) => (name === stepName ? [name, expectedLevel] : [name]))
                .filter((name) => name !== 'readItems')
        );
        if (failsWithError) {
            expect(logError).toHaveBeenCalledTimes(1);
            expect(logError).toHaveBeenCalledWith('Write step failed for resource', { ...expectedFields, error });
            expect(logInfo).not.toHaveBeenCalled();
        } else {
            expect(logInfo).toHaveBeenCalledTimes(1);
            expect(logInfo).toHaveBeenCalledWith(
                'Write check failed for resource',
                { ...expectedFields, issues: expectedIssues }
            );
            expect(logError).not.toHaveBeenCalled();
            for (const loggedIssue of logInfo.mock.calls[0][1].issues) {
                expect(loggedIssue).not.toHaveProperty('diagnostics');
                expect(loggedIssue).not.toHaveProperty('details');
            }
        }
    });

    test.each([
        {
            name: 'a BadRequestError, which is a client error',
            error: new BadRequestError(new Error('synthetic bad request')),
            expectedLogger: logInfo,
            otherLogger: logError
        },
        {
            name: 'a NotFoundError, which is a client error',
            error: new NotFoundError(new Error('synthetic not found')),
            expectedLogger: logInfo,
            otherLogger: logError
        },
        {
            name: 'a PreconditionFailedError, which update logs as info',
            error: new PreconditionFailedError('synthetic precondition failure'),
            expectedLogger: logInfo,
            otherLogger: logError
        },
        {
            name: 'an error without a log level',
            error: new Error('synthetic failure'),
            expectedLogger: logError,
            otherLogger: logInfo
        },
        {
            name: 'an error whose log level is not info',
            error: Object.assign(new Error('synthetic failure'), { logLevel: 'error' }),
            expectedLogger: logError,
            otherLogger: logInfo
        }
    ])('logs an error failure for $name at the level of the error', async ({ error, expectedLogger, otherLogger }) => {
        const items = buildItems(1);
        const failure = new WriteFailure({
            stage: WRITE_FAILURE_STAGE.WRITE,
            subject: WriteFailure.subjectOf(items[0].incoming),
            error
        });
        const { pipeline } = buildPipeline({
            behaviors: { write: (stepItems) => stepItems[0].fail({ failure }) }
        });

        await pipeline.processAsync({ profile: FAKE_PROFILE, context: buildContext(), items });

        expect(expectedLogger).toHaveBeenCalledTimes(1);
        expect(expectedLogger).toHaveBeenCalledWith(
            'Write step failed for resource',
            expect.objectContaining({ operation: 'fake', step: 'write', stage: WRITE_FAILURE_STAGE.WRITE, error })
        );
        expect(otherLogger).not.toHaveBeenCalled();
    });

    test.each([
        { name: 'logInfo', logger: logInfo, failure: (item) => buildFailure(item) },
        {
            name: 'logError',
            logger: logError,
            failure: (item) => new WriteFailure({
                stage: WRITE_FAILURE_STAGE.WRITE,
                subject: WriteFailure.subjectOf(item.incoming),
                error: new Error('synthetic failure')
            })
        }
    ])('keeps running and returns the items when $name throws', async ({ logger, failure }) => {
        const items = buildItems(4);
        items[0].fail({ failure: failure(items[0]) });
        const { pipeline, calls } = buildPipeline({
            behaviors: {
                scopeCheck: (stepItems) => stepItems
                    .slice(0, 2)
                    .forEach((item) => item.fail({ failure: failure(item) }))
            }
        });
        logger.mockImplementation(() => {
            throw new Error('synthetic logger failure');
        });

        const result = await pipeline.processAsync({ profile: FAKE_PROFILE, context: buildContext(), items });

        expect(logger).toHaveBeenCalledTimes(3);
        expect(calls).toStrictEqual(WRITE_STEP_NAMES);
        expect(result.items).toStrictEqual(items);
        expect(result.items.map((item) => item.status)).toStrictEqual([
            WRITE_ITEM_STATUS.FAILED,
            WRITE_ITEM_STATUS.FAILED,
            WRITE_ITEM_STATUS.FAILED,
            WRITE_ITEM_STATUS.ACTIVE
        ]);
    });

    test('lets a step error propagate and stops the later steps', async () => {
        const { pipeline, calls } = buildPipeline({
            behaviors: {
                buildDocument: () => {
                    throw new Error('step failed');
                }
            }
        });

        await expect(
            pipeline.processAsync({ profile: FAKE_PROFILE, context: buildContext(), items: buildItems(2) })
        ).rejects.toThrow('step failed');
        expect(calls).toStrictEqual(WRITE_STEP_NAMES.slice(0, WRITE_STEP_NAMES.indexOf('buildDocument') + 1));
    });

    test('runAsync reads, runs the steps, executes, audits, logs and responds in order', async () => {
        const {
            pipeline, calls, received, stepsByName, databaseBulkInserter, writeAuditor, fhirLoggingManager
        } = buildPipeline();
        httpContextSetSpy.mockImplementation(() => calls.push('httpContext.set'));
        const requestInfo = { requestId: 'request-1', headers: {} };
        const parsedArgs = new ParsedArgs({ base_version: '4_0_0' });
        const context = buildContext(requestInfo);
        const items = buildItems(2);
        const requestErrors = [{ id: 'request-error' }];
        const executedResults = [{ id: 'patient-0', created: true }];
        const failureResults = [{ id: 'failure-result' }];
        const results = [{ id: 'result' }];
        const response = { resourceType: 'Bundle' };
        databaseBulkInserter.executeAsync.mockImplementation(async () => {
            calls.push('executeAsync');
            return executedResults;
        });
        const responder = buildResponder({
            calls,
            context,
            items,
            requestErrors,
            wasIncomingAList: true,
            outputs: { failureResults, results, toResponse: response }
        });

        const returned = await pipeline.runAsync({
            profile: FAKE_PROFILE,
            responder,
            requestInfo,
            parsedArgs,
            resourceType: 'Patient'
        });

        expect(returned).toBe(response);
        expect(calls).toStrictEqual([
            'readAsync',
            ...WRITE_STEP_NAMES,
            'failureResults',
            'executeAsync',
            'results',
            'writeAuditor.auditAsync',
            'afterFlushAsync',
            'logOperationSuccessAsync',
            'httpContext.set',
            'toResponse',
            'recordMetrics'
        ]);
        expect(responder.readAsync).toHaveBeenCalledWith({ requestInfo, parsedArgs, resourceType: 'Patient' });
        expect(received.scopeCheck).toStrictEqual(items);
        expect(responder.failureResults).toHaveBeenCalledWith({ items, requestErrors });
        expect(databaseBulkInserter.executeAsync).toHaveBeenCalledWith({ requestInfo, base_version: '4_0_0' });
        expect(stepsByName.write.afterFlushAsync).toHaveBeenCalledTimes(1);
        expect(stepsByName.write.afterFlushAsync).toHaveBeenCalledWith({ items, context, executedResults });
        expect(stepsByName.write.afterFlushAsync.mock.calls[0][0].executedResults).toBe(executedResults);
        expect(responder.results).toHaveBeenCalledWith({ items, requestErrors, executedResults });
        expect(writeAuditor.auditAsync).toHaveBeenCalledTimes(1);
        expect(writeAuditor.auditAsync).toHaveBeenCalledWith({ context, results });
        const { startTime } = fhirLoggingManager.logOperationSuccessAsync.mock.calls[0][0];
        expect(fhirLoggingManager.logOperationSuccessAsync).toHaveBeenCalledWith({
            requestInfo,
            args: {},
            resourceType: 'Patient',
            startTime: expect.any(Number),
            action: 'fake'
        });
        expect(httpContextSetSpy).toHaveBeenCalledTimes(1);
        expect(httpContextSetSpy).toHaveBeenCalledWith(ACCESS_LOGS_ENTRY_DATA, { operationResult: results });
        expect(httpContextSetSpy.mock.calls[0][1].operationResult).toBe(results);
        expect(responder.toResponse).toHaveBeenCalledWith({
            context,
            items,
            results,
            wasIncomingAList: true,
            resourceType: 'Patient',
            startTime,
            stopTime: expect.any(Number)
        });
        expect(responder.toResponse.mock.calls[0][0].stopTime).toBeGreaterThanOrEqual(startTime);
        expect(responder.recordMetrics).toHaveBeenCalledWith({ results, requestInfo, parsedArgs });
        expect(fhirLoggingManager.logOperationFailureAsync).not.toHaveBeenCalled();
    });

    test('runAsync logs the failure, rethrows it and records the failure results when executeAsync throws', async () => {
        const { pipeline, calls, databaseBulkInserter, fhirLoggingManager } = buildPipeline();
        const requestInfo = { requestId: 'request-1', headers: {} };
        const parsedArgs = new ParsedArgs({ base_version: '4_0_0' });
        const context = buildContext(requestInfo);
        const failureResults = [{ id: 'failure-result' }];
        const error = new Error('synthetic execute failure');
        databaseBulkInserter.executeAsync.mockImplementation(async () => {
            calls.push('executeAsync');
            throw error;
        });
        const responder = buildResponder({ calls, context, items: buildItems(1), outputs: { failureResults } });

        await expect(pipeline.runAsync({
            profile: FAKE_PROFILE,
            responder,
            requestInfo,
            parsedArgs,
            resourceType: 'Patient'
        })).rejects.toBe(error);

        expect(calls).toStrictEqual([
            'readAsync',
            ...WRITE_STEP_NAMES,
            'failureResults',
            'executeAsync',
            'logOperationFailureAsync',
            'recordMetrics'
        ]);
        expect(fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledWith({
            requestInfo,
            args: {},
            resourceType: 'Patient',
            startTime: expect.any(Number),
            action: 'fake',
            error
        });
        expect(fhirLoggingManager.logOperationSuccessAsync).not.toHaveBeenCalled();
        expect(httpContextSetSpy).not.toHaveBeenCalled();
        expect(responder.recordMetrics).toHaveBeenCalledTimes(1);
        expect(responder.recordMetrics.mock.calls[0][0].results).toBe(failureResults);
    });

    test("afterFlushAsync runs once, after the flush, the results and the audit, on the profile's write variant", async () => {
        const calls = [];
        const variantHook = jest.fn(async () => {
            calls.push('write.fake.afterFlushAsync');
        });
        const stepVariants = {
            write: {
                fake: {
                    runAsync: jest.fn(async () => {
                        calls.push('write.fake');
                    }),
                    afterFlushAsync: variantHook
                }
            }
        };
        const profile = buildProfile({ variants: { write: 'fake' } });
        const { pipeline, stepsByName, databaseBulkInserter } = buildPipeline({
            calls,
            stepVariants,
            profiles: [profile]
        });
        const requestInfo = { requestId: 'request-1', headers: {} };
        const context = buildContext(requestInfo);
        const items = buildItems(2);
        const executedResults = [{ id: 'patient-0', created: true }];
        databaseBulkInserter.executeAsync.mockImplementation(async () => {
            calls.push('executeAsync');
            return executedResults;
        });
        const responder = buildResponder({ calls, context, items });

        await pipeline.runAsync({
            profile,
            responder,
            requestInfo,
            parsedArgs: new ParsedArgs({ base_version: '4_0_0' }),
            resourceType: 'Patient'
        });

        expect(calls.filter((name) => name.endsWith('afterFlushAsync'))).toStrictEqual([
            'write.fake.afterFlushAsync'
        ]);
        expect(calls.indexOf('executeAsync')).toBeLessThan(calls.indexOf('write.fake.afterFlushAsync'));
        expect(calls.indexOf('executeAsync')).toBeLessThan(calls.indexOf('results'));
        expect(calls.indexOf('results')).toBeLessThan(calls.indexOf('writeAuditor.auditAsync'));
        expect(calls.indexOf('writeAuditor.auditAsync')).toBeLessThan(calls.indexOf('write.fake.afterFlushAsync'));
        expect(calls.indexOf('write.fake.afterFlushAsync')).toBeLessThan(calls.indexOf('logOperationSuccessAsync'));
        expect(variantHook).toHaveBeenCalledTimes(1);
        expect(variantHook).toHaveBeenCalledWith({ items, context, executedResults });
        expect(stepsByName.write.afterFlushAsync).not.toHaveBeenCalled();
    });

    test('an error from the hook is thrown, logged as the failure and leaves the audit queued', async () => {
        const { pipeline, calls, stepsByName, writeAuditor, fhirLoggingManager } = buildPipeline();
        const requestInfo = { requestId: 'request-1', headers: {} };
        const parsedArgs = new ParsedArgs({ base_version: '4_0_0' });
        const context = buildContext(requestInfo);
        const results = [{ id: 'result' }];
        const error = new Error('synthetic hook failure');
        stepsByName.write.afterFlushAsync.mockImplementation(async () => {
            calls.push('afterFlushAsync');
            throw error;
        });
        const responder = buildResponder({
            calls,
            context,
            items: buildItems(1),
            outputs: { results }
        });

        await expect(pipeline.runAsync({
            profile: FAKE_PROFILE,
            responder,
            requestInfo,
            parsedArgs,
            resourceType: 'Patient'
        })).rejects.toBe(error);

        expect(calls).toStrictEqual([
            'readAsync',
            ...WRITE_STEP_NAMES,
            'failureResults',
            'executeAsync',
            'results',
            'writeAuditor.auditAsync',
            'afterFlushAsync',
            'logOperationFailureAsync',
            'recordMetrics'
        ]);
        expect(writeAuditor.auditAsync).toHaveBeenCalledTimes(1);
        expect(writeAuditor.auditAsync).toHaveBeenCalledWith({ context, results });
        expect(fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledWith({
            requestInfo,
            args: {},
            resourceType: 'Patient',
            startTime: expect.any(Number),
            action: 'fake',
            error
        });
        expect(fhirLoggingManager.logOperationSuccessAsync).not.toHaveBeenCalled();
        expect(httpContextSetSpy).not.toHaveBeenCalled();
        expect(responder.toResponse).not.toHaveBeenCalled();
        expect(responder.recordMetrics.mock.calls[0][0].results).toBe(results);
    });

    test('does not run the hook or audit when the responder throws while building the results', async () => {
        const { pipeline, calls, stepsByName, writeAuditor } = buildPipeline();
        const requestInfo = { requestId: 'request-1', headers: {} };
        const error = new Error('synthetic results failure');
        const responder = buildResponder({
            calls,
            context: buildContext(requestInfo),
            items: buildItems(1)
        });
        responder.results.mockImplementation(() => {
            calls.push('results');
            throw error;
        });

        await expect(pipeline.runAsync({
            profile: FAKE_PROFILE,
            responder,
            requestInfo,
            parsedArgs: new ParsedArgs({ base_version: '4_0_0' }),
            resourceType: 'Patient'
        })).rejects.toBe(error);

        expect(stepsByName.write.afterFlushAsync).not.toHaveBeenCalled();
        expect(writeAuditor.auditAsync).not.toHaveBeenCalled();
    });

    test('runAsync logs the failure, rethrows it and records empty results when readAsync rejects', async () => {
        const { pipeline, calls, databaseBulkInserter, fhirLoggingManager } = buildPipeline();
        const requestInfo = { requestId: 'request-1', headers: {} };
        const parsedArgs = new ParsedArgs({ base_version: '4_0_0' });
        const error = new Error('synthetic read failure');
        const responder = buildResponder({ calls, context: buildContext(requestInfo), items: buildItems(1) });
        responder.readAsync.mockImplementation(async () => {
            calls.push('readAsync');
            throw error;
        });

        await expect(pipeline.runAsync({
            profile: FAKE_PROFILE,
            responder,
            requestInfo,
            parsedArgs,
            resourceType: 'Patient'
        })).rejects.toBe(error);

        expect(calls).toStrictEqual(['readAsync', 'logOperationFailureAsync', 'recordMetrics']);
        expect(databaseBulkInserter.executeAsync).not.toHaveBeenCalled();
        expect(fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledWith({
            requestInfo,
            args: {},
            resourceType: 'Patient',
            startTime: expect.any(Number),
            action: 'fake',
            error
        });
        expect(fhirLoggingManager.logOperationSuccessAsync).not.toHaveBeenCalled();
        expect(responder.recordMetrics).toHaveBeenCalledTimes(1);
        expect(responder.recordMetrics.mock.calls[0][0]).toStrictEqual({ results: [], requestInfo, parsedArgs });
        expect(responder.recordMetrics.mock.calls[0][0].requestInfo).toBe(requestInfo);
        expect(responder.recordMetrics.mock.calls[0][0].parsedArgs).toBe(parsedArgs);
    });

    test('runAsync rejects a responder that is not a WriteResponder before reading, and logs nothing', async () => {
        const { pipeline, calls, writeAuditor, fhirLoggingManager } = buildPipeline();
        const context = buildContext();
        const responder = Object.fromEntries(
            WRITE_RESPONDER_METHOD_NAMES.map((method) => [method, jest.fn(() => calls.push(method))])
        );

        await expect(pipeline.runAsync({
            profile: FAKE_PROFILE,
            responder,
            requestInfo: context.requestInfo,
            parsedArgs: new ParsedArgs({ base_version: '4_0_0' }),
            resourceType: 'Patient'
        })).rejects.toThrow(new Error('Type of obj object is not the expected type WriteResponder'));

        expect(responder.readAsync).not.toHaveBeenCalled();
        expect(calls).toStrictEqual([]);
        expect(writeAuditor.auditAsync).not.toHaveBeenCalled();
        expect(fhirLoggingManager.logOperationSuccessAsync).not.toHaveBeenCalled();
        expect(fhirLoggingManager.logOperationFailureAsync).not.toHaveBeenCalled();
        expect(logInfo).not.toHaveBeenCalled();
        expect(logError).not.toHaveBeenCalled();
    });

    test('executeAsync forwards to the bulk inserter', async () => {
        const { pipeline, databaseBulkInserter } = buildPipeline();
        const context = buildContext();
        const executedResults = [{ id: 'patient-0', created: true }];
        databaseBulkInserter.executeAsync.mockResolvedValue(executedResults);

        const result = await pipeline.executeAsync({ context });

        expect(databaseBulkInserter.executeAsync).toHaveBeenCalledWith({
            requestInfo: context.requestInfo,
            base_version: context.base_version
        });
        expect(result).toBe(executedResults);
    });
});

describe('WriteItem', () => {
    test('starts active with empty working fields', () => {
        const incoming = { resourceType: 'Patient', id: 'patient-0' };

        const item = new WriteItem({ index: 4, incoming });

        expect(item).toMatchObject({
            index: 4,
            incoming,
            stored: null,
            candidate: null,
            writeMode: null,
            contextData: null,
            savedIdentity: null,
            patch: null,
            memberWrites: null,
            appliedPatch: null,
            failure: null,
            status: WRITE_ITEM_STATUS.ACTIVE
        });
        expect(item.isActive).toBe(true);
    });

    test('fail records the failure and deactivates the item', () => {
        const item = new WriteItem({ index: 0, incoming: {} });
        const failure = buildFailure(item);

        item.fail({ failure });

        expect(item.failure).toBe(failure);
        expect(item.status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(item.isActive).toBe(false);
    });

    test.each([
        { method: 'markUnchanged', status: WRITE_ITEM_STATUS.UNCHANGED },
        { method: 'markQueued', status: WRITE_ITEM_STATUS.QUEUED }
    ])('$method sets the status and deactivates the item', ({ method, status }) => {
        const item = new WriteItem({ index: 0, incoming: {} });

        item[method]();

        expect(item.status).toBe(status);
        expect(item.isActive).toBe(false);
    });
});

describe('WriteContext', () => {
    test('holds its fields and is frozen', () => {
        const context = buildContext();

        expect(context).toMatchObject({
            requestInfo: { requestId: 'request-1' },
            base_version: '4_0_0',
            parsedArgs: {},
            smartMerge: false
        });
        expect(Object.isFrozen(context)).toBe(true);
    });
});

describe('NoOpStep', () => {
    test('marks only items without a candidate as unchanged', async () => {
        const items = buildItems(3);
        items[1].candidate = { resourceType: 'Patient', id: 'patient-1' };

        await new NoOpStep().runAsync({ items, context: buildContext() });

        expect(items.map((item) => item.status)).toStrictEqual([
            WRITE_ITEM_STATUS.UNCHANGED,
            WRITE_ITEM_STATUS.ACTIVE,
            WRITE_ITEM_STATUS.UNCHANGED
        ]);
    });
});
