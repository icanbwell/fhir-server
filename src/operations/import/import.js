const { AuditLogger } = require('../../utils/auditLogger');
const { BadRequestError, ForbiddenError } = require('../../utils/httpErrors');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { ScopesManager } = require('../security/scopesManager');
const { ConfigManager } = require('../../utils/configManager');
const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { logInfo } = require('../common/logging');

class ImportOperation {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ScopesManager} scopesManager
     * @property {FhirLoggingManager} fhirLoggingManager
     * @property {PostRequestProcessor} postRequestProcessor
     * @property {AuditLogger} auditLogger
     * @property {ConfigManager} configManager
     *
     * @param {ConstructorParams}
     */
    constructor({
        scopesManager,
        fhirLoggingManager,
        postRequestProcessor,
        auditLogger,
        configManager
    }) {
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);

        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);

        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Parses and validates FHIR Parameters resource for $import
     * @param {Object} body
     * @returns {{ id: string, inputs: Array<{ type?: string, url: string }> }}
     */
    parseParametersResource(body) {
        if (!body || body.resourceType !== 'Parameters' || !Array.isArray(body.parameter)) {
            throw new BadRequestError(new Error(
                'Request body must be a FHIR Parameters resource with a parameter array'
            ));
        }

        const idParam = body.parameter.find((p) => p.name === 'id');
        if (!idParam || !idParam.valueString || !idParam.valueString.trim()) {
            throw new BadRequestError(new Error(
                'id parameter is required and must be a non-empty string'
            ));
        }

        const inputParams = body.parameter.filter((p) => p.name === 'input');
        if (!inputParams.length) {
            throw new BadRequestError(new Error('At least one input parameter is required'));
        }

        const maxFiles = this.configManager.bulkImportMaxFilesPerRequest;
        if (inputParams.length > maxFiles) {
            throw new BadRequestError(new Error(
                `Too many input files: ${inputParams.length} exceeds maximum of ${maxFiles}`
            ));
        }

        const inputs = inputParams.map((inputParam, index) => {
            if (!Array.isArray(inputParam.part)) {
                throw new BadRequestError(new Error(`input parameter at index ${index} must have a part array`));
            }

            const urlPart = inputParam.part.find((p) => p.name === 'url');
            if (!urlPart || !urlPart.valueUri) {
                throw new BadRequestError(new Error(
                    `input parameter at index ${index} must have a url part with valueUri`
                ));
            }

            const typePart = inputParam.part.find((p) => p.name === 'resourceType');

            return {
                type: typePart?.valueString,
                url: urlPart.valueUri
            };
        });

        return {
            id: idParam.valueString.trim(),
            inputs
        };
    }

    /**
     * Validates S3 URIs and bucket allow-list. Fail-closed: an empty allow-list
     * rejects all requests so that a forgotten BULK_IMPORT_ALLOWED_S3_BUCKETS env
     * var cannot silently downgrade to "any bucket accepted."
     * @param {Array<{ type?: string, url: string }>} inputs
     */
    validateS3Inputs(inputs) {
        const allowedBuckets = this.configManager.bulkImportAllowedS3Buckets;

        if (allowedBuckets.length === 0) {
            throw new BadRequestError(new Error(
                'Bulk import S3 bucket allow-list is not configured. Set BULK_IMPORT_ALLOWED_S3_BUCKETS.'
            ));
        }

        for (const input of inputs) {
            const s3Match = input.url.match(/^s3:\/\/([^/]+)\/(.+)$/);
            if (!s3Match) {
                throw new BadRequestError(new Error(
                    `Invalid S3 URI: "${input.url}". Must match s3://bucket/key`
                ));
            }

            const bucket = s3Match[1];
            if (!allowedBuckets.includes(bucket)) {
                throw new BadRequestError(new Error(
                    `S3 bucket "${bucket}" is not in the allowed bucket list`
                ));
            }
        }
    }

    /**
     * @typedef {Object} ImportAsyncParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {Object} args
     *
     * @param {ImportAsyncParams}
     * @returns {Promise<Object>}
     */
    async importAsync({ requestInfo, args }) {
        assertIsValid(requestInfo !== undefined);
        const currentOperationName = 'import';
        const startTime = Date.now();
        const {
            requestId,
            scope
        } = requestInfo;

        const { base_version, resource } = args;

        assertIsValid(requestId, 'requestId is null');

        try {
            if (this.scopesManager.hasPatientScope({ scope })) {
                throw new ForbiddenError('Bulk import cannot be triggered with patient scopes');
            }

            const { id: importJobId, inputs } = this.parseParametersResource(resource);
            this.validateS3Inputs(inputs);

            logInfo(
                `$import request accepted with ${inputs.length} input file(s)`,
                {
                    requestId,
                    importJobId,
                    inputCount: inputs.length,
                    urls: inputs.map((i) => i.url)
                }
            );

            // Log success first; audit is queued only after the success log lands,
            // so a failure in success logging produces a single coherent failure
            // record rather than success-logged-as-failure + an AuditEvent.
            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args,
                startTime,
                action: currentOperationName
            });

            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => {
                    await this.auditLogger.logAuditEntryAsync({
                        requestInfo,
                        base_version,
                        resourceType: 'Parameters',
                        operation: currentOperationName,
                        args,
                        ids: [importJobId]
                    });
                }
            });

            return {
                id: importJobId,
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'information',
                        code: 'informational',
                        diagnostics: `Import request accepted with ${inputs.length} input file(s)`
                    }
                ]
            };
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args,
                startTime,
                action: currentOperationName,
                error: e
            });
            throw e;
        }
    }
}

module.exports = { ImportOperation };
