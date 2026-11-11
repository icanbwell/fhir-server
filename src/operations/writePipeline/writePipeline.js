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
const { FindExistingStep } = require('./steps/findExistingStep');
const { PrepareBodyStep } = require('./steps/prepareBodyStep');
const { ValidateIncomingStep } = require('./steps/validateIncomingStep');
const { AccessCheckStep } = require('./steps/accessCheckStep');
const { BuildDocumentStep } = require('./steps/buildDocumentStep');
const { ValidateResultStep } = require('./steps/validateResultStep');
const { AttachmentsStep } = require('./steps/attachmentsStep');
const { NoOpStep } = require('./steps/noOpStep');
const { WriteStep } = require('./steps/writeStep');
const { WriteAuditor } = require('./writeAuditor');
const { WriteResponder } = require('./responder/writeResponder');

/**
 * The shared step names, in the order `processAsync` runs them. A profile's `off` setting may name
 * only these.
 */
const WRITE_STEP_NAMES = Object.freeze([
    'scopeCheck',
    'findExisting',
    'prepareBody',
    'validateIncoming',
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
const PROFILE_SETTINGS = Object.freeze(['name', 'accessRequested', 'action', 'off']);
/**
 * The profile settings that must be non-empty strings.
 */
const REQUIRED_STRING_SETTINGS = Object.freeze(['name', 'accessRequested', 'action']);
/**
 * Plain data that describes one operation to the pipeline: its name, the scope letter
 * (`accessRequested`) and `action` passed to the checks, and the steps it turns `off`. Every other
 * step runs.
 * @typedef {Object} WriteProfile
 * @property {string} name
 * @property {string} accessRequested
 * @property {string} action
 * @property {string[]} [off]
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
 */
class WritePipeline {
    /**
     * Takes the ten shared steps, the bulk inserter that flushes the writes, the auditor that
     * audits every run's results, the operation logging manager and the tracer.
     * @param {ScopeCheckStep} scopeCheckStep
     * @param {FindExistingStep} findExistingStep
     * @param {PrepareBodyStep} prepareBodyStep
     * @param {ValidateIncomingStep} validateIncomingStep
     * @param {AccessCheckStep} accessCheckStep
     * @param {BuildDocumentStep} buildDocumentStep
     * @param {ValidateResultStep} validateResultStep
     * @param {AttachmentsStep} attachmentsStep
     * @param {NoOpStep} noOpStep
     * @param {WriteStep} writeStep
     * @param {FastDatabaseBulkInserter} databaseBulkInserter
     * @param {WriteAuditor} writeAuditor
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {CustomTracer} customTracer
     */
    constructor ({
        scopeCheckStep,
        findExistingStep,
        prepareBodyStep,
        validateIncomingStep,
        accessCheckStep,
        buildDocumentStep,
        validateResultStep,
        attachmentsStep,
        noOpStep,
        writeStep,
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
         * @type {FindExistingStep}
         */
        this.findExistingStep = findExistingStep;
        assertTypeEquals(findExistingStep, FindExistingStep);
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
     * results are stored for the access log and the responder builds the response. An invalid
     * profile, or a responder that is not a `WriteResponder`, throws before anything runs; after
     * that, an error is logged and rethrown, and the responder's `recordMetrics` runs on success
     * and on error.
     * @param {WriteProfile} profile
     * @param {WriteResponder} responder
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<*>}
     */
    async runAsync ({ profile, responder, requestInfo, parsedArgs, resourceType }) {
        this._assertValidProfile(profile);
        assertTypeEquals(responder, WriteResponder);
        const spanName = this._spanName(profile);
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
            // Collect the failures so far, so the metrics still get them if the flush throws
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
                action: profile.name
            });
            // Store the results for the access log
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                operationResult: results
            });
            // Build the operation's response
            return await responder.toResponse({
                context,
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
                action: profile.name,
                error: e
            });
            throw e;
        } finally {
            // Record the operation's metrics, on success and on error
            responder.recordMetrics({ results, requestInfo, parsedArgs });
        }
    }

    /**
     * Checks the profile, then runs the shared steps in `WRITE_STEP_NAMES` order and returns the
     * same items. Each step gets only the items still active and a frozen copy of the profile, and
     * runs even when none are active; a step the profile turns off is skipped. Items that arrive
     * failed and items a step fails are logged. A step that throws stops the run.
     * @param {WriteProfile} profile
     * @param {WriteContext} context
     * @param {WriteItem[]} items
     * @returns {Promise<{items: WriteItem[]}>}
     */
    async processAsync ({ profile, context, items }) {
        this._assertValidProfile(profile);
        const { name: profileName, accessRequested, action, off } = profile;
        const runProfile = Object.freeze({
            name: profileName,
            accessRequested,
            action,
            off: Object.freeze([...(off || [])])
        });
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
                const run = { profile: runProfile, context, items, stepsOff: new Set(runProfile.off) };
                await this._runStepAsync({ run, name: 'scopeCheck', step: this.scopeCheckStep });
                await this._runStepAsync({ run, name: 'findExisting', step: this.findExistingStep });
                await this._runStepAsync({ run, name: 'prepareBody', step: this.prepareBodyStep });
                await this._runStepAsync({ run, name: 'validateIncoming', step: this.validateIncomingStep });
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
     * Runs one step on the run's active items in its own span, then logs the items it failed. Does
     * nothing when the profile turns the step off.
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
        const activeItems = items.filter((item) => item.isActive);
        await this.customTracer.trace({
            name: `${this._spanName(profile)}.${name}`,
            func: async () => await step.runAsync({ items: activeItems, context, profile })
        });
        this._logFailures({ profile, context, stepName: name, items: activeItems });
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
     * Throws if the profile has an unknown setting, a required setting that is not a non-empty
     * string, an `off` setting that is not an array, or an unknown step name in `off`.
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
    }
}

module.exports = {
    WritePipeline,
    WRITE_STEP_NAMES
};
