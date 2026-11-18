const httpContext = require('express-http-context');
const { trace } = require('@opentelemetry/api');
const { assertTypeEquals } = require('../../utils/assertType');
const { CustomTracer } = require('../../utils/customTracer');
const { FastDatabaseBulkInserter } = require('../../dataLayer/fastDatabaseBulkInserter');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../constants');
const { logInfo, logError } = require('../common/logging');
const { WriteItem, WRITE_ITEM_STATUS } = require('./writeItem');
const { WriteContext } = require('./writeContext');
const { ScopeCheckStep } = require('./steps/scopeCheckStep');
const { IdentifyStep } = require('./steps/identifyStep');
const { PrepareBodyStep } = require('./steps/prepareBodyStep');
const { ValidateIncomingStep } = require('./steps/validateIncomingStep');
const { FindExistingStep } = require('./steps/findExistingStep');
const { ValidateNewResourceStep } = require('./steps/validateNewResourceStep');
const { AccessCheckStep } = require('./steps/accessCheckStep');
const { BuildDocumentStep } = require('./steps/buildDocumentStep');
const { ValidateResultStep } = require('./steps/validateResultStep');
const { AttachmentsStep } = require('./steps/attachmentsStep');
const { NoOpStep } = require('./steps/noOpStep');
const { WriteStep } = require('./steps/writeStep');
const { WriteAuditor } = require('./writeAuditor');
const { WriteResponder } = require('./writeResponder');

/**
 * The shared step names, in the order `processAsync` runs them. A profile's `off` setting may name
 * only these.
 */
const WRITE_STEP_NAMES = Object.freeze([
    'scopeCheck',
    'identify',
    'prepareBody',
    'validateIncoming',
    'findExisting',
    'validateNewResource',
    'accessBeforeBuild',
    'buildDocument',
    'validateResult',
    'attachments',
    'noOpCheck',
    'write'
]);
/**
 * The settings a profile may have.
 */
const PROFILE_SETTINGS = Object.freeze(['name', 'accessRequested', 'action', 'off', 'variants']);
/**
 * The profile settings that must be non-empty strings.
 */
const REQUIRED_STRING_SETTINGS = Object.freeze(['name', 'accessRequested', 'action']);
/**
 * Plain data that describes one operation to the pipeline: its name, the scope letter
 * (`accessRequested`) and `action` passed to the checks, the steps it turns `off` and the
 * `variants` it names. Every other step runs, and a step with no named variant runs its default.
 * @typedef {Object} WriteProfile
 * @property {string} name
 * @property {string} accessRequested
 * @property {string} action
 * @property {string[]} [off]
 * @property {Object<string, string>} [variants] Maps a step name to the name of the variant that
 * runs in place of that step's default.
 */

/**
 * The alternative step instances `WritePipeline` can run in place of a default step: a step name
 * maps to its variant names, and each variant name maps to the step that runs.
 * @typedef {Object<string, Object<string, {runAsync: function({items: WriteItem[], context: WriteContext, profile: WriteProfile}): Promise<void>}>>} StepVariants
 */

/**
 * Returns whether the value is a non-null object that is not an array.
 * @param {*} value
 * @returns {boolean}
 */
const isObjectMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A profile as the pipeline keeps it after checking it at construction: a frozen copy of the
 * profile and the names of the steps it turns off.
 * @typedef {Object} RegisteredProfile
 * @property {WriteProfile} profile
 * @property {Set<string>} stepsOff
 */

/**
 * What `processAsync` passes to `_runStepAsync` for each step: the frozen profile, the context, all
 * items and the names of the steps turned off. The step itself gets only the active items.
 * @typedef {Object} WriteRun
 * @property {WriteProfile} profile
 * @property {WriteContext} context
 * @property {WriteItem[]} items
 * @property {Set<string>} stepsOff
 */

/**
 * Runs one write request through the shared steps; `runAsync` owns the request from reading it to
 * the response. The operation's `WriteResponder` reads the request, builds the results and the
 * response, and records the metrics; the pipeline runs the steps, flushes the writes, audits the
 * results through the shared `WriteAuditor` and logs the operation. Each step is called
 * explicitly, one line per step, so the whole flow reads top to bottom in `processAsync`. The
 * reasons for the step order are in docs/specs/unified-write-pipeline.md, section "Step order".
 *
 * There are two ways in. `runAsync` runs a whole request. A caller that writes many batches in one
 * longer job, such as streaming `$merge`, calls `processAsync` for each batch and `executeAsync` at
 * each flush, and does its own audit, logging and response.
 */
class WritePipeline {
    /**
     * Takes the twelve shared steps, the variants a profile can name in place of a default step,
     * the profiles the pipeline can run, the bulk inserter that flushes the writes, the auditor that
     * audits every run's results, the operation logging manager and the tracer. Throws when
     * `stepVariants` is not an object of step names to variant objects, names a step that is not in
     * `WRITE_STEP_NAMES`, or has a variant without a `runAsync` function. Pass `{}` when no
     * operation uses a variant. Throws when `profiles` is not an array or one of its profiles is
     * invalid (see `_assertValidProfile`), so a bad profile fails when the pipeline is built, before
     * any request.
     * @param {ScopeCheckStep} scopeCheckStep
     * @param {IdentifyStep} identifyStep
     * @param {PrepareBodyStep} prepareBodyStep
     * @param {ValidateIncomingStep} validateIncomingStep
     * @param {FindExistingStep} findExistingStep
     * @param {ValidateNewResourceStep} validateNewResourceStep
     * @param {AccessCheckStep} accessCheckStep
     * @param {BuildDocumentStep} buildDocumentStep
     * @param {ValidateResultStep} validateResultStep
     * @param {AttachmentsStep} attachmentsStep
     * @param {NoOpStep} noOpStep
     * @param {WriteStep} writeStep
     * @param {StepVariants} stepVariants
     * @param {WriteProfile[]} profiles
     * @param {FastDatabaseBulkInserter} databaseBulkInserter
     * @param {WriteAuditor} writeAuditor
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {CustomTracer} customTracer
     */
    constructor ({
        scopeCheckStep,
        identifyStep,
        prepareBodyStep,
        validateIncomingStep,
        findExistingStep,
        validateNewResourceStep,
        accessCheckStep,
        buildDocumentStep,
        validateResultStep,
        attachmentsStep,
        noOpStep,
        writeStep,
        stepVariants,
        profiles,
        databaseBulkInserter,
        writeAuditor,
        fhirLoggingManager,
        customTracer
    }) {
        /**
         * @type {ScopeCheckStep}
         */
        this.scopeCheckStep = scopeCheckStep;
        assertTypeEquals(scopeCheckStep, ScopeCheckStep);
        /**
         * @type {IdentifyStep}
         */
        this.identifyStep = identifyStep;
        assertTypeEquals(identifyStep, IdentifyStep);
        /**
         * @type {PrepareBodyStep}
         */
        this.prepareBodyStep = prepareBodyStep;
        assertTypeEquals(prepareBodyStep, PrepareBodyStep);
        /**
         * @type {ValidateIncomingStep}
         */
        this.validateIncomingStep = validateIncomingStep;
        assertTypeEquals(validateIncomingStep, ValidateIncomingStep);
        /**
         * @type {FindExistingStep}
         */
        this.findExistingStep = findExistingStep;
        assertTypeEquals(findExistingStep, FindExistingStep);
        /**
         * @type {ValidateNewResourceStep}
         */
        this.validateNewResourceStep = validateNewResourceStep;
        assertTypeEquals(validateNewResourceStep, ValidateNewResourceStep);
        /**
         * @type {AccessCheckStep}
         */
        this.accessCheckStep = accessCheckStep;
        assertTypeEquals(accessCheckStep, AccessCheckStep);
        /**
         * @type {BuildDocumentStep}
         */
        this.buildDocumentStep = buildDocumentStep;
        assertTypeEquals(buildDocumentStep, BuildDocumentStep);
        /**
         * @type {ValidateResultStep}
         */
        this.validateResultStep = validateResultStep;
        assertTypeEquals(validateResultStep, ValidateResultStep);
        /**
         * @type {AttachmentsStep}
         */
        this.attachmentsStep = attachmentsStep;
        assertTypeEquals(attachmentsStep, AttachmentsStep);
        /**
         * @type {NoOpStep}
         */
        this.noOpStep = noOpStep;
        assertTypeEquals(noOpStep, NoOpStep);
        /**
         * @type {WriteStep}
         */
        this.writeStep = writeStep;
        assertTypeEquals(writeStep, WriteStep);
        this._assertValidStepVariants(stepVariants);
        /**
         * @type {StepVariants}
         */
        this.stepVariants = Object.freeze(Object.fromEntries(
            Object.entries(stepVariants).map(([stepName, variants]) => [stepName, Object.freeze({ ...variants })])
        ));
        if (!Array.isArray(profiles)) {
            throw new Error('WritePipeline profiles must be an array of write profiles');
        }
        /**
         * @type {Map<WriteProfile, RegisteredProfile>}
         */
        this.registeredProfiles = new Map(
            profiles.map((profile) => [profile, this._registerProfile(profile)])
        );
        /**
         * @type {FastDatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, FastDatabaseBulkInserter);
        /**
         * @type {WriteAuditor}
         */
        this.writeAuditor = writeAuditor;
        assertTypeEquals(writeAuditor, WriteAuditor);
        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);
        /**
         * @type {CustomTracer}
         */
        this.customTracer = customTracer;
        assertTypeEquals(customTracer, CustomTracer);
    }

    /**
     * Runs one write request and returns the responder's response. The responder reads the request
     * into items, `processAsync` runs the steps and `executeAsync` flushes the writes; then the
     * responder builds the results, the `WriteAuditor` audits them, the success is logged, the
     * results are stored for the access log and the responder builds the response. A profile that
     * was not given to the constructor, or a responder that is not a `WriteResponder`, throws before
     * anything runs; after that, an error is logged and rethrown, and the responder's
     * `recordMetrics` runs on success and on error. A single-resource responder throws its item's
     * failure from `failureResults`, so for POST and PUT a failed check ends the run there.
     * @param {WriteProfile} profile
     * @param {WriteResponder} responder
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<*>}
     */
    async runAsync ({ profile, responder, requestInfo, parsedArgs, resourceType }) {
        const { profile: runProfile } = this._registeredProfile(profile);
        assertTypeEquals(responder, WriteResponder);
        const spanName = this._spanName(runProfile);
        /**
         * @type {number}
         */
        const startTime = Date.now();
        /**
         * @type {Object[]}
         */
        let results = [];
        try {
            // Read the request into the write context and one item per resource
            const { context, items, requestErrors, wasIncomingAList } = await this.customTracer.trace({
                name: `${spanName}.readItems`,
                func: async () => await responder.readAsync({ requestInfo, parsedArgs, resourceType })
            });
            // Run the shared write steps on the items
            await this.processAsync({ profile, context, items });
            // Collect the failures so far, so the metrics still get them if the flush throws;
            // a single-resource responder throws its failure here
            results = responder.failureResults({ items, requestErrors });
            // Flush the queued writes to the database
            const executedResults = await this.customTracer.trace({
                name: `${spanName}.executeAsync`,
                func: async () => await this.executeAsync({ context })
            });
            // Build the final results from the failures and the flushed writes
            results = responder.results({ items, requestErrors, executedResults });
            // Queue the AuditEvents for the results as a post-request task
            await this.customTracer.trace({
                name: `${spanName}.audit`,
                func: async () => await this.writeAuditor.auditAsync({ context, results })
            });
            // Log the operation's success
            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: runProfile.name
            });
            // Store the results for the access log
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                operationResult: results
            });
            // Build the operation's response
            return await responder.toResponse({
                context,
                items,
                results,
                wasIncomingAList,
                resourceType,
                startTime,
                stopTime: Date.now()
            });
        } catch (e) {
            // Log the operation's failure and rethrow
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: runProfile.name,
                error: e
            });
            throw e;
        } finally {
            // Record the operation's metrics, on success and on error
            responder.recordMetrics({ results, requestInfo, parsedArgs });
        }
    }

    /**
     * Runs the shared steps in `WRITE_STEP_NAMES` order and returns the same items. Throws before
     * any step when the profile was not given to the constructor. Each step gets only the items
     * still active and the frozen copy of the profile; a step the profile turns off is skipped, and
     * so is every step once no item is active. Items that arrive failed and items a step fails are
     * logged.
     * A step that throws stops the run.
     * @param {WriteProfile} profile
     * @param {WriteContext} context
     * @param {WriteItem[]} items
     * @returns {Promise<{items: WriteItem[]}>}
     */
    async processAsync ({ profile, context, items }) {
        const { profile: runProfile, stepsOff } = this._registeredProfile(profile);
        return await this.customTracer.trace({
            name: this._spanName(runProfile),
            func: async () => {
                const pipelineSpan = trace.getActiveSpan();
                pipelineSpan?.setAttribute('write_pipeline.operation', runProfile.name);
                this._logFailures({ profile: runProfile, context, stepName: 'readItems', items });
                pipelineSpan?.setAttribute('write_pipeline.batch_size', items.length);
                /**
                 * @type {WriteRun}
                 */
                const run = { profile: runProfile, context, items, stepsOff };
                await this._runStepAsync({ run, name: 'scopeCheck', step: this.scopeCheckStep });
                await this._runStepAsync({ run, name: 'identify', step: this.identifyStep });
                await this._runStepAsync({ run, name: 'prepareBody', step: this.prepareBodyStep });
                await this._runStepAsync({ run, name: 'validateIncoming', step: this.validateIncomingStep });
                await this._runStepAsync({ run, name: 'findExisting', step: this.findExistingStep });
                await this._runStepAsync({ run, name: 'validateNewResource', step: this.validateNewResourceStep });
                await this._runStepAsync({ run, name: 'accessBeforeBuild', step: this.accessCheckStep });
                await this._runStepAsync({ run, name: 'buildDocument', step: this.buildDocumentStep });
                await this._runStepAsync({ run, name: 'validateResult', step: this.validateResultStep });
                await this._runStepAsync({ run, name: 'attachments', step: this.attachmentsStep });
                await this._runStepAsync({ run, name: 'noOpCheck', step: this.noOpStep });
                await this._runStepAsync({ run, name: 'write', step: this.writeStep });
                return { items };
            }
        });
    }

    /**
     * Flushes the writes queued for this request through the bulk inserter, once for the whole
     * batch, and returns its per-resource results.
     * @param {WriteContext} context
     * @returns {Promise<Object[]>}
     */
    async executeAsync ({ context }) {
        return await this.databaseBulkInserter.executeAsync({
            requestInfo: context.requestInfo,
            base_version: context.base_version
        });
    }

    /**
     * Runs one step on the run's active items in its own span, then logs the items it failed. Runs
     * the variant the profile names for the step in place of `step`, if it names one. Does nothing
     * when the profile turns the step off or no item is active.
     * @param {WriteRun} run
     * @param {string} name
     * @param {{runAsync: function({items: WriteItem[], context: WriteContext, profile: WriteProfile}): Promise<void>}} step
     * @returns {Promise<void>}
     */
    async _runStepAsync ({ run, name, step }) {
        const { profile, context, items, stepsOff } = run;
        if (stepsOff.has(name)) {
            return;
        }
        const variantName = profile.variants[name];
        const stepToRun = variantName === undefined ? step : this.stepVariants[name][variantName];
        const activeItems = items.filter((item) => item.isActive);
        if (activeItems.length === 0) {
            return;
        }
        await this.customTracer.trace({
            name: `${this._spanName(profile)}.${name}`,
            func: async () => await stepToRun.runAsync({ items: activeItems, context, profile })
        });
        this._logFailures({ profile, context, stepName: name, items: activeItems });
    }

    /**
     * Returns what the constructor kept for the profile. Throws when the profile was not given to
     * the constructor.
     * @param {WriteProfile} profile
     * @returns {RegisteredProfile}
     */
    _registeredProfile (profile) {
        const registeredProfile = this.registeredProfiles.get(profile);
        if (!registeredProfile) {
            throw new Error(`Write profile "${profile?.name}" is not registered with the WritePipeline`);
        }
        return registeredProfile;
    }

    /**
     * Checks the profile and returns a frozen copy of it with the names of the steps it turns off.
     * @param {WriteProfile} profile
     * @returns {RegisteredProfile}
     */
    _registerProfile (profile) {
        this._assertValidProfile(profile);
        const { name, accessRequested, action, off, variants } = profile;
        const frozenProfile = Object.freeze({
            name,
            accessRequested,
            action,
            off: Object.freeze([...(off || [])]),
            variants: Object.freeze({ ...(variants || {}) })
        });
        return Object.freeze({ profile: frozenProfile, stepsOff: new Set(frozenProfile.off) });
    }

    /**
     * Returns the span name for a run of the profile: `WritePipeline.<profile name>`.
     * @param {WriteProfile} profile
     * @returns {string}
     */
    _spanName (profile) {
        return `WritePipeline.${profile.name}`;
    }

    /**
     * Logs every failed item in `items` under the given step name, with the request's origin
     * service. An error while logging one item is skipped, so it does not reach the caller.
     * @param {WriteProfile} profile
     * @param {WriteContext} context
     * @param {string} stepName
     * @param {WriteItem[]} items
     * @returns {void}
     */
    _logFailures ({ profile, context, stepName, items }) {
        const originService = context.requestInfo.headers?.['origin-service'] || 'unknown';
        for (const item of items) {
            if (item.status !== WRITE_ITEM_STATUS.FAILED) {
                continue;
            }
            try {
                this._logFailure({ profile, stepName, originService, failure: item.failure });
            } catch {
                continue;
            }
        }
    }

    /**
     * Logs one failure with the operation, step, stage, the resource's identity and the origin
     * service. An error failure is logged as an error with its error; a check failure is logged as
     * info with only each issue's severity, code and expression, never details text or diagnostics.
     * @param {WriteProfile} profile
     * @param {string} stepName
     * @param {string} originService
     * @param {import('./writeFailure').WriteFailure} failure
     * @returns {void}
     */
    _logFailure ({ profile, stepName, originService, failure }) {
        const { id, uuid, sourceAssigningAuthority, resourceType } = failure.subject;
        const fields = {
            operation: profile.name,
            step: stepName,
            stage: failure.stage,
            resourceType,
            id,
            uuid,
            sourceAssigningAuthority,
            originService
        };
        if (failure.error !== null) {
            logError('Write step failed for resource', { ...fields, error: failure.error });
        } else {
            const issues = (failure.operationOutcome.issue ?? []).map(
                ({ severity, code, expression }) => ({ severity, code, expression })
            );
            logInfo('Write check failed for resource', { ...fields, issues });
        }
    }

    /**
     * Throws if `stepVariants` is not an object of step names to variant objects, names a step
     * that is not in `WRITE_STEP_NAMES`, or has a variant without a `runAsync` function.
     * @param {StepVariants} stepVariants
     * @returns {void}
     */
    _assertValidStepVariants (stepVariants) {
        if (!isObjectMap(stepVariants) || !Object.values(stepVariants).every(isObjectMap)) {
            throw new Error('WritePipeline stepVariants must be an object of step names to variant objects');
        }
        const unknownSteps = Object.keys(stepVariants).filter((name) => !WRITE_STEP_NAMES.includes(name));
        if (unknownSteps.length > 0) {
            throw new Error(`WritePipeline stepVariants names unknown step(s): ${unknownSteps.join(', ')}`);
        }
        for (const [stepName, variants] of Object.entries(stepVariants)) {
            for (const [variantName, variant] of Object.entries(variants)) {
                if (typeof variant?.runAsync !== 'function') {
                    throw new Error(`WritePipeline step variant "${stepName}.${variantName}" needs a runAsync function`);
                }
            }
        }
    }

    /**
     * Throws if the profile has an unknown setting, a required setting that is not a non-empty
     * string, an `off` setting that is not an array, an unknown step name in `off`, a `variants`
     * setting that is not an object, a variant for a step that has no variants registered, or a
     * variant that is not registered for its step.
     * @param {WriteProfile} profile
     * @returns {void}
     */
    _assertValidProfile (profile) {
        const unknownSettings = Object.keys(profile).filter((key) => !PROFILE_SETTINGS.includes(key));
        if (unknownSettings.length > 0) {
            throw new Error(`Write profile "${profile.name}" has unknown setting(s): ${unknownSettings.join(', ')}`);
        }
        const missingSettings = REQUIRED_STRING_SETTINGS.filter(
            (key) => typeof profile[key] !== 'string' || profile[key].length === 0
        );
        if (missingSettings.length > 0) {
            throw new Error(`Write profile "${profile.name}" needs string setting(s): ${missingSettings.join(', ')}`);
        }
        if (profile.off !== undefined && !Array.isArray(profile.off)) {
            throw new Error(`Write profile "${profile.name}" setting "off" must be an array of step names`);
        }
        const unknownStepsOff = (profile.off ?? []).filter((name) => !WRITE_STEP_NAMES.includes(name));
        if (unknownStepsOff.length > 0) {
            throw new Error(`Write profile "${profile.name}" turns off unknown step(s): ${unknownStepsOff.join(', ')}`);
        }
        if (profile.variants === undefined) {
            return;
        }
        if (!isObjectMap(profile.variants)) {
            throw new Error(
                `Write profile "${profile.name}" setting "variants" must be an object of step names to variant names`
            );
        }
        const stepsWithoutVariants = Object.keys(profile.variants).filter(
            (name) => !Object.hasOwn(this.stepVariants, name)
        );
        if (stepsWithoutVariants.length > 0) {
            throw new Error(
                `Write profile "${profile.name}" names a variant for step(s) without variants: ${stepsWithoutVariants.join(', ')}`
            );
        }
        const unknownVariants = Object.entries(profile.variants)
            .filter(([name, variantName]) => !Object.hasOwn(this.stepVariants[name], variantName))
            .map(([name, variantName]) => `${name}.${variantName}`);
        if (unknownVariants.length > 0) {
            throw new Error(`Write profile "${profile.name}" names unknown variant(s): ${unknownVariants.join(', ')}`);
        }
    }
}

module.exports = {
    WritePipeline,
    WRITE_STEP_NAMES
};
