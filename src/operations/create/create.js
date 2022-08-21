const {logDebug, logOperationAsync} = require('../common/logging');
const {doesResourceHaveAccessTags} = require('../security/scopes');
const {getUuid} = require('../../utils/uid.util');
const env = require('var');
const moment = require('moment-timezone');
const sendToS3 = require('../../utils/aws-s3');
const {validateResource} = require('../../utils/validator.util');
const {NotValidatedError, BadRequestError} = require('../../utils/httpErrors');
const {getResource} = require('../common/getResource');
const {getMeta} = require('../common/getMeta');
const {removeNull} = require('../../utils/nullRemover');
const {preSaveAsync} = require('../common/preSave');
const {isTrue} = require('../../utils/isTrue');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const assert = require('node:assert/strict');

class CreateOperation {
    constructor() {
    }

    /**
     * does a FHIR Create (POST)
     * @param {SimpleContainer} container
     * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
     * @param {Object} args
     * @param {string} path
     * @param {string} resourceType
     */
    async create(container,
                 requestInfo, args, path, resourceType) {
        assert(container !== undefined);
        assert(requestInfo !== undefined);
        assert(args !== undefined);
        assert(resourceType !== undefined);
        const currentOperationName = 'create';
        /**
         * @type {DatabaseHistoryFactory}
         */
        const databaseHistoryFactory = container.databaseHistoryFactory;
        /**
         * @type {DatabaseUpdateFactory}
         */
        const databaseUpdateFactory = container.databaseUpdateFactory;
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {user, body, requestId} = requestInfo;

        await verifyHasValidScopesAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'write'
        });

        let resource_incoming = body;

        let {base_version} = args;

        const uuid = resource_incoming.id || getUuid(resource_incoming);

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
                const notValidatedError = new NotValidatedError(operationOutcome);
                await logOperationAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    message: 'operationFailed',
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

            logDebug(user, `resource: ${resource.toJSON()}`);

            if (env.CHECK_ACCESS_TAG_ON_SAVE === '1') {
                if (!doesResourceHaveAccessTags(resource)) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new BadRequestError(new Error('ResourceCreator is missing a security access tag with system: https://www.icanbwell.com/access '));
                }
            }

            // If no resource ID was provided, generate one.
            /**
             * @type {string}
             */
            let id = resource_incoming.id || getUuid(resource);
            logDebug(user, `id: ${id}`);

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
             * @type {Object}
             */
            let doc = removeNull(resource.toJSON());
            Object.assign(doc, {id: id});

            if (resourceType !== 'AuditEvent') {
                // log access to audit logs
                /**
                 * @type {AuditLogger}
                 */
                const auditLogger = container.auditLogger;
                await auditLogger.logAuditEntryAsync(requestInfo, base_version, resourceType, currentOperationName, args, [resource['id']]);
                const currentDate = moment.utc().format('YYYY-MM-DD');
                await auditLogger.flushAsync(requestId, currentDate);
            }
            // Create a clone of the object without the _id parameter before assigning a value to
            // the _id parameter in the original document
            /**
             * @type {Object}
             */
            let history_doc = Object.assign({}, doc);
            Object.assign(doc, {_id: id});

            logDebug(user, '---- inserting doc ---');
            logDebug(user, doc);
            logDebug(user, '----------------------');

            // Insert our resource record
            try {
                await databaseUpdateFactory.createDatabaseUpdateManager(resourceType, base_version, useAtlas)
                    .insertOneAsync(doc);
            } catch (e) {
                // noinspection ExceptionCaughtLocallyJS
                throw new BadRequestError(e);
            }
            // Save the resource to history

            // Insert our resource record to history but don't assign _id
            await databaseHistoryFactory.createDatabaseHistoryManager(resourceType, base_version, useAtlas)
                .insertOneAsync(history_doc);
            const result = {id: doc.id, resource_version: doc.meta.versionId};
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationCompleted',
                action: currentOperationName,
                result: JSON.stringify(result)
            });
            /**
             * @type {ChangeEventProducer}
             */
            const changeEventProducer = container.changeEventProducer;
            await changeEventProducer.fireEventsAsync(requestId, 'U', resourceType, doc);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            postRequestProcessor.add(async () => await changeEventProducer.flushAsync(requestId));

            return result;
        } catch (/** @type {Error} */ e) {
            const currentDate = moment.utc().format('YYYY-MM-DD');
            await sendToS3('errors',
                resourceType,
                resource_incoming,
                currentDate,
                uuid,
                currentOperationName);
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationFailed',
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
