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
     * @returns {{ inputFormat: string, inputs: Array<{ type?: string, url: string }> }}
     */
    parseParametersResource(body) {
        if (!body || body.resourceType !== 'Parameters' || !Array.isArray(body.parameter)) {
            throw new BadRequestError(
                'Request body must be a FHIR Parameters resource with a parameter array'
            );
        }

        const inputFormatParam = body.parameter.find((p) => p.name === 'inputFormat');
        if (!inputFormatParam || inputFormatParam.valueString !== 'application/fhir+ndjson') {
            throw new BadRequestError(
                'inputFormat parameter is required and must be "application/fhir+ndjson"'
            );
        }

        const inputParams = body.parameter.filter((p) => p.name === 'input');
        if (!inputParams.length) {
            throw new BadRequestError('At least one input parameter is required');
        }

        const maxFiles = this.configManager.bulkImportMaxFilesPerRequest;
        if (inputParams.length > maxFiles) {
            throw new BadRequestError(
                `Too many input files: ${inputParams.length} exceeds maximum of ${maxFiles}`
            );
        }

        const inputs = inputParams.map((inputParam, index) => {
            if (!Array.isArray(inputParam.part)) {
                throw new BadRequestError(`input parameter at index ${index} must have a part array`);
            }

            const urlPart = inputParam.part.find((p) => p.name === 'url');
            if (!urlPart || !urlPart.valueUri) {
                throw new BadRequestError(
                    `input parameter at index ${index} must have a url part with valueUri`
                );
            }

            const typePart = inputParam.part.find((p) => p.name === 'type');

            return {
                type: typePart?.valueString,
                url: urlPart.valueUri
            };
        });

        return {
            inputFormat: inputFormatParam.valueString,
            inputs
        };
    }

    /**
     * Validates S3 URIs and bucket allow-list
     * @param {Array<{ type?: string, url: string }>} inputs
     */
    validateS3Inputs(inputs) {
        const allowedBuckets = this.configManager.bulkImportAllowedS3Buckets;

        for (const input of inputs) {
            const s3Match = input.url.match(/^s3:\/\/([^/]+)\/(.+)$/);
            if (!s3Match) {
                throw new BadRequestError(
                    `Invalid S3 URI: "${input.url}". Must match s3://bucket/key`
                );
            }

            const bucket = s3Match[1];
            if (allowedBuckets.length > 0 && !allowedBuckets.includes(bucket)) {
                throw new BadRequestError(
                    `S3 bucket "${bucket}" is not in the allowed bucket list`
                );
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

        if (this.scopesManager.hasPatientScope({ scope })) {
            throw new ForbiddenError('Bulk import cannot be triggered with patient scopes');
        }

        const { inputs } = this.parseParametersResource(resource);
        this.validateS3Inputs(inputs);

        try {
            logInfo(
                `$import request accepted with ${inputs.length} input file(s)`,
                {
                    requestId,
                    inputCount: inputs.length,
                    urls: inputs.map((i) => i.url)
                }
            );

            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => {
                    await this.auditLogger.logAuditEntryAsync({
                        requestInfo,
                        base_version,
                        resourceType: 'Parameters',
                        operation: currentOperationName,
                        args,
                        ids: []
                    });
                }
            });

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args,
                startTime,
                action: currentOperationName
            });

            return {
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
