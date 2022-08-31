const {logDebug} = require('../common/logging');
const {generateUUID} = require('../../utils/uid.util');
const env = require('var');
const moment = require('moment-timezone');
const sendToS3 = require('../../utils/aws-s3');
const {validateResource} = require('../../utils/validator.util');
const {NotValidatedError, BadRequestError} = require('../../utils/httpErrors');
const {getResource} = require('../common/getResource');
const {getMeta} = require('../common/getMeta');
const {preSaveAsync} = require('../common/preSave');
const {isTrue} = require('../../utils/isTrue');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseHistoryFactory} = require('../../dataLayer/databaseHistoryFactory');
const {DatabaseUpdateFactory} = require('../../dataLayer/databaseUpdateFactory');
const {ChangeEventProducer} = require('../../utils/changeEventProducer');
const {AuditLogger} = require('../../utils/auditLogger');
const {PostRequestProcessor} = require('../../utils/postRequestProcessor');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');

class CreateOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     * @param {DatabaseUpdateFactory} databaseUpdateFactory
     * @param {ChangeEventProducer} changeEventProducer
     * @param {AuditLogger} auditLogger
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     */
    constructor(
        {
            databaseHistoryFactory,
            databaseUpdateFactory,
            changeEventProducer,
            auditLogger,
            postRequestProcessor,
            scopesManager,
            fhirLoggingManager,
            scopesValidator
        }
    ) {
        /**
         * @type {DatabaseHistoryFactory}
         */
        this.databaseHistoryFactory = databaseHistoryFactory;
        assertTypeEquals(databaseHistoryFactory, DatabaseHistoryFactory);
        /**
         * @type {DatabaseUpdateFactory}
         */
        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);
        /**
         * @type {ChangeEventProducer}
         */
        this.changeEventProducer = changeEventProducer;
        assertTypeEquals(changeEventProducer, ChangeEventProducer);
        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

    }

    /**
     * does a FHIR Create (POST)
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} path
     * @param {string} resourceType
     * @returns {Resource}
     */
    async create(requestInfo, args, path, resourceType) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'create';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {user, body, /** @type {string} */ requestId} = requestInfo;

        await this.scopesValidator.verifyHasValidScopesAsync(
            {
                requestInfo,
                args,
                resourceType,
                startTime,
                action: currentOperationName,
                accessRequested: 'write'
            }
        );

        let resource_incoming = body;

        let {base_version} = args;

        const uuid = generateUUID();

        if (env.LOG_ALL_SAVES) {
            const currentDate = moment.utc().format('YYYY-MM-DD');
            await sendToS3('logs',
                resourceType,
                resource_incoming,
                currentDate,
                uuid,
                currentOperationName
            );
        }

        if (env.VALIDATE_SCHEMA || args['_validate']) {
            const operationOutcome = validateResource(resource_incoming, resourceType, path);
            if (operationOutcome && operationOutcome.statusCode === 400) {
                validationsFailedCounter.inc({action: currentOperationName, resourceType}, 1);
                const currentDate = moment.utc().format('YYYY-MM-DD');
                operationOutcome.expression = [
                    resourceType + '/' + uuid
                ];
                await sendToS3('validation_failures',
                    resourceType,
                    resource_incoming,
                    currentDate,
                    uuid,
                    currentOperationName);
                await sendToS3('validation_failures',
                    'OperationOutcome',
                    operationOutcome,
                    currentDate,
                    uuid,
                    'create_failure');
                // noinspection JSValidateTypes
                /**
                 * @type {Error}
                 */
                const notValidatedError = new NotValidatedError(operationOutcome);
                await this.fhirLoggingManager.logOperationFailureAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: notValidatedError
                });
                throw notValidatedError;
            }
        }

        try {
            /**
             * @type {boolean}
             */
            const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

            // Get current record
            /**
             * @type {function({Object}): Resource}
             */
            let ResourceCreator = getResource(base_version, resourceType);
            /**
             * @type {Resource}
             */
            const resource = new ResourceCreator(resource_incoming);

            if (env.CHECK_ACCESS_TAG_ON_SAVE === '1') {
                if (!this.scopesManager.doesResourceHaveAccessTags(resource)) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new BadRequestError(new Error('ResourceCreator is missing a security access tag with system: https://www.icanbwell.com/access '));
                }
            }

            // If no resource ID was provided, generate one.
            /**
             * @type {string}
             */
            let id = uuid;

            // Create the resource's metadata
            /**
             * @type {function({Object}): Meta}
             */
            let Meta = getMeta(base_version);
            if (!resource.meta) {
                // noinspection SpellCheckingInspection
                resource.meta = new Meta({
                    versionId: '1',
                    lastUpdated: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
                });
            } else {
                resource.meta['versionId'] = '1';
                // noinspection JSValidateTypes,SpellCheckingInspection
                resource.meta['lastUpdated'] = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            }

            await preSaveAsync(resource);

            // Create the document to be inserted into Mongo
            // noinspection JSUnresolvedFunction
            /**
             * @type {Resource}
             */
            let doc = resource;
            Object.assign(doc, {id: id});

            if (resourceType !== 'AuditEvent') {
                // log access to audit logs

                await this.auditLogger.logAuditEntryAsync(
                    {
                        requestInfo, base_version, resourceType,
                        operation: currentOperationName, args, ids: [resource['id']]
                    }
                );
                const currentDate = moment.utc().format('YYYY-MM-DD');
                await this.auditLogger.flushAsync({requestId, currentDate});
            }
            // Create a clone of the object without the _id parameter before assigning a value to
            // the _id parameter in the original document
            // noinspection JSValidateTypes
            logDebug({user, args: {message: 'Inserting', doc: doc}});

            // Insert our resource record
            try {
                await this.databaseUpdateFactory.createDatabaseUpdateManager(
                    {resourceType, base_version, useAtlas}
                ).insertOneAsync({doc});
            } catch (e) {
                // noinspection ExceptionCaughtLocallyJS
                throw new BadRequestError(e);
            }
            // Save the resource to history

            // Insert our resource record to history but don't assign _id
            await this.databaseHistoryFactory.createDatabaseHistoryManager(
                {resourceType, base_version, useAtlas}
            ).insertHistoryForResourceAsync({doc: doc});
            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    result: JSON.stringify(doc)
                });
            await this.changeEventProducer.fireEventsAsync({
                requestId, eventType: 'U', resourceType, doc
            });
            this.postRequestProcessor.add(async () => await this.changeEventProducer.flushAsync(requestId));

            return doc;
        } catch (/** @type {Error} */ e) {
            const currentDate = moment.utc().format('YYYY-MM-DD');
            await sendToS3('errors',
                resourceType,
                resource_incoming,
                currentDate,
                uuid,
                currentOperationName);
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                action: currentOperationName,
                error: e
            });
            throw e;
        }
    }
}

module.exports = {
    CreateOperation
};
