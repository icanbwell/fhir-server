const moment = require('moment-timezone');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const Task = require('../../fhir/classes/4_0_0/resources/task');
const { AuditLogger } = require('../../utils/auditLogger');
const { BadRequestError, ForbiddenError } = require('../../utils/httpErrors');
const { ConfigManager } = require('../../utils/configManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../dataLayer/databaseUpdateFactory');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { PostSaveProcessor } = require('../../dataLayer/postSaveProcessor');
const { ScopesManager } = require('../security/scopesManager');
const { SecurityTagManager } = require('../common/securityTagManager');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
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
     * @property {SecurityTagManager} securityTagManager
     * @property {DatabaseUpdateFactory} databaseUpdateFactory
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {PostSaveProcessor} postSaveProcessor
     *
     * @param {ConstructorParams}
     */
    constructor({
        scopesManager,
        fhirLoggingManager,
        postRequestProcessor,
        auditLogger,
        configManager,
        securityTagManager,
        databaseUpdateFactory,
        databaseQueryFactory,
        postSaveProcessor
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

        this.securityTagManager = securityTagManager;
        assertTypeEquals(securityTagManager, SecurityTagManager);

        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);

        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);
    }

    /**
     * Parses and validates FHIR Parameters resource for $import
     * @param {Object} body
     * @returns {{ id: string, inputs: Array<{ url: string }> }}
     */
    parseParametersResource(body) {
        if (!body || body.resourceType !== 'Parameters' || !Array.isArray(body.parameter)) {
            throw new BadRequestError(new Error(
                'Request body must be a FHIR Parameters resource with a parameter array'
            ));
        }

        if (!body.id || !body.id.trim()) {
            throw new BadRequestError(new Error(
                'Parameters.id is required and must be a non-empty string'
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
            if (!inputParam.valueUri) {
                throw new BadRequestError(new Error(
                    `input parameter at index ${index} must have a valueUri`
                ));
            }

            return {
                url: inputParam.valueUri
            };
        });

        return {
            id: body.id.trim(),
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
     * @param {{ id: string, inputs: Array<{ url: string }>, requestInfo: Object }} params
     * @returns {Promise<Task>}
     */
    async createTaskAsync({ id, inputs, requestInfo }) {
        const { user, scope, requestId } = requestInfo;

        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Task',
            base_version: '4_0_0'
        });

        const existing = await databaseQueryManager.findOneAsync({
            query: { _sourceId: id }
        });

        if (existing) {
            throw new BadRequestError(new Error(
                `An import Task with id "${id}" already exists`
            ));
        }

        const taskResource = new Task({
            id,
            status: 'requested',
            intent: 'order',
            code: {
                coding: [
                    new Coding({
                        system: 'https://www.icanbwell.com/task-type',
                        code: 'bulk-import'
                    })
                ]
            },
            authoredOn: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')),
            input: inputs.map((i) => ({
                type: { text: 'url' },
                valueUri: i.url
            })),
            meta: {
                security: [
                    new Coding({
                        system: SecurityTagSystem.owner,
                        code: 'bwell'
                    }),
                    new Coding({
                        system: SecurityTagSystem.sourceAssigningAuthority,
                        code: 'bwell'
                    })
                ],
                source: requestInfo.host
            }
        });

        const accessCodesFromScopes = this.securityTagManager.getSecurityTagsFromScope({
            user,
            scope,
            accessRequested: 'write'
        });

        accessCodesFromScopes.forEach((code) => {
            taskResource.meta.security.push(
                new Coding({
                    system: SecurityTagSystem.access,
                    code: code
                })
            );
        });

        taskResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));

        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Task',
            base_version: '4_0_0'
        });

        await databaseUpdateManager.insertOneAsync({ doc: taskResource, requestInfo });

        await this.postSaveProcessor.afterSaveAsync({
            requestId,
            eventType: 'C',
            resourceType: 'Task',
            doc: taskResource
        });

        return taskResource;
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

            const taskResource = await this.createTaskAsync({
                id: importJobId,
                inputs,
                requestInfo
            });

            logInfo(
                `$import request accepted with ${inputs.length} input file(s)`,
                {
                    requestId,
                    importJobId,
                    inputCount: inputs.length,
                    urls: inputs.map((i) => i.url)
                }
            );

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
                        resourceType: 'Task',
                        operation: currentOperationName,
                        args,
                        ids: [importJobId]
                    });
                }
            });

            return taskResource.toJSON();
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
