const {logDebug, logOperationAsync} = require('../common/logging');
const {
    isAccessToResourceAllowedBySecurityTags,
    doesResourceHaveAccessTags
} = require('../security/scopes');
const env = require('var');
const moment = require('moment-timezone');
const sendToS3 = require('../../utils/aws-s3');
const {validateResource} = require('../../utils/validator.util');
const {getUuid} = require('../../utils/uid.util');
const {NotValidatedError, ForbiddenError, BadRequestError} = require('../../utils/httpErrors');
const {getResource} = require('../common/getResource');
const {compare} = require('fast-json-patch');
const {getMeta} = require('../common/getMeta');
const {removeNull} = require('../../utils/nullRemover');
const {preSaveAsync} = require('../common/preSave');
const {isTrue} = require('../../utils/isTrue');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const assert = require('node:assert/strict');
const {assertTypeEquals} = require('../../utils/assertType');
const {DatabaseHistoryFactory} = require('../../dataLayer/databaseHistoryFactory');
const {ChangeEventProducer} = require('../../utils/changeEventProducer');
const {AuditLogger} = require('../../utils/auditLogger');
const {PostRequestProcessor} = require('../../utils/postRequestProcessor');

class UpdateOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     * @param {ChangeEventProducer} changeEventProducer
     * @param {AuditLogger} auditLogger
     * @param {PostRequestProcessor} postRequestProcessor
     */
    constructor(
        {
            databaseHistoryFactory,
            changeEventProducer,
            auditLogger,
            postRequestProcessor
        }
    ) {
        /**
         * @type {DatabaseHistoryFactory}
         */
        this.databaseHistoryFactory = databaseHistoryFactory;
        assertTypeEquals(databaseHistoryFactory, DatabaseHistoryFactory);
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
    }

    /**
     * does a FHIR Update (PUT)
     * @param {SimpleContainer} container
     * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     */
    async update(container,
                 requestInfo, args, resourceType) {
        assert(container !== undefined);
        assert(requestInfo !== undefined);
        assert(args !== undefined);
        assert(resourceType !== undefined);
        const currentOperationName = 'update';
        // Query our collection for this observation
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {user, scope, path, body, requestId} = requestInfo;

        await verifyHasValidScopesAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        // read the incoming resource from request body
        let resource_incoming_json = body;
        let {base_version, id} = args;

        if (env.LOG_ALL_SAVES) {
            const currentDate = moment.utc().format('YYYY-MM-DD');
            await sendToS3('logs',
                resourceType,
                resource_incoming_json,
                currentDate,
                id,
                currentOperationName);
        }

        if (env.VALIDATE_SCHEMA || args['_validate']) {
            const operationOutcome = validateResource(resource_incoming_json, resourceType, path);
            if (operationOutcome && operationOutcome.statusCode === 400) {
                validationsFailedCounter.inc({action: currentOperationName, resourceType}, 1);
                const currentDate = moment.utc().format('YYYY-MM-DD');
                const uuid = getUuid(resource_incoming_json);
                operationOutcome.expression = [
                    resourceType + '/' + uuid
                ];
                await sendToS3('validation_failures',
                    resourceType,
                    resource_incoming_json,
                    currentDate,
                    uuid,
                    currentOperationName);
                await sendToS3('validation_failures',
                    resourceType,
                    operationOutcome,
                    currentDate,
                    uuid,
                    'update_failure');
                throw new NotValidatedError(operationOutcome);
            }
        }

        try {
            /**
             * @type {boolean}
             */
            const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

            // Get current record
            /**
             * @type {Resource | null}
             */
            let data = await this.databaseQueryFactory.createQuery(resourceType, base_version, useAtlas)
                .findOneAsync({id: id.toString()});
            // create a resource with incoming data
            /**
             * @type {function(?Object): Resource}
             */
            let ResourceCreator = getResource(base_version, resourceType);

            /**
             * @type {Resource}
             */
            let resource_incoming = new ResourceCreator(resource_incoming_json);
            /**
             * @type {Resource|null}
             */
            let cleaned;
            /**
             * @type {Resource|null}
             */
            let doc;

            // check if resource was found in database or not
            // noinspection JSUnresolvedVariable
            if (data && data.meta) {
                // found an existing resource
                logDebug(user, 'found resource: ' + data);
                /**
                 * @type {Resource}
                 */
                let foundResource = new ResourceCreator(data);
                if (!(isAccessToResourceAllowedBySecurityTags(foundResource, user, scope))) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new ForbiddenError(
                        'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                        foundResource.resourceType + ' with id ' + id);
                }

                logDebug(user, '------ found document --------');
                logDebug(user, data);
                logDebug(user, '------ end found document --------');

                // use metadata of existing resource (overwrite any passed in metadata)
                // noinspection JSPrimitiveTypeWrapperUsage
                resource_incoming.meta = foundResource.meta;
                logDebug(user, '------ incoming document --------');
                logDebug(user, JSON.stringify(resource_incoming));
                logDebug(user, '------ end incoming document --------');

                await preSaveAsync(resource_incoming);

                const foundResourceObject = removeNull(foundResource.toJSON());
                const resourceIncomingObject = removeNull(resource_incoming.toJSON());
                // now create a patch between the document in db and the incoming document
                //  this returns an array of patches
                let patchContent = compare(foundResourceObject, resourceIncomingObject);
                // ignore any changes to _id since that's an internal field
                patchContent = patchContent.filter(item => item.path !== '/_id');
                logDebug(user, '------ patches --------');
                logDebug(user, patchContent);
                logDebug(user, '------ end patches --------');
                // see if there are any changes
                if (patchContent.length === 0) {
                    logDebug(user, 'No changes detected in updated resource');
                    await logOperationAsync({
                        requestInfo,
                        args,
                        resourceType,
                        startTime,
                        message: 'operationCompleted',
                        action: currentOperationName
                    });
                    return {
                        id: id,
                        created: false,
                        resource_version: foundResource.meta.versionId,
                    };
                }
                if (env.LOG_ALL_SAVES) {
                    const currentDate = moment.utc().format('YYYY-MM-DD');
                    await sendToS3('logs',
                        resourceType,
                        patchContent,
                        currentDate,
                        id,
                        'update_patch');
                }
                // update the metadata to increment versionId
                /**
                 * @type {Meta}
                 */
                let meta = foundResource.meta;
                meta.versionId = `${parseInt(foundResource.meta.versionId) + 1}`;
                // noinspection SpellCheckingInspection
                meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
                resource_incoming.meta = meta;

                await preSaveAsync(resource_incoming);

                // Same as update from this point on
                cleaned = removeNull(resource_incoming.toJSON());
                doc = cleaned;
                // check_fhir_mismatch(cleaned, patched_incoming_data);
            } else {
                // not found so insert
                logDebug(user, 'update: new resource: ' + JSON.stringify(resource_incoming));
                if (env.CHECK_ACCESS_TAG_ON_SAVE === '1') {
                    if (!doesResourceHaveAccessTags(new ResourceCreator(resource_incoming))) {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new BadRequestError(new Error('ResourceC is missing a security access tag with system: https://www.icanbwell.com/access '));
                    }
                }

                // create the metadata
                /**
                 * @type {function({Object}): Meta}
                 */
                let Meta = getMeta(base_version);
                if (!resource_incoming.meta) {
                    // noinspection JSPrimitiveTypeWrapperUsage
                    resource_incoming.meta = new Meta({
                        versionId: '1',
                        lastUpdated: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
                    });
                } else {
                    resource_incoming.meta['versionId'] = '1';
                    resource_incoming.meta['lastUpdated'] = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
                }

                await preSaveAsync(resource_incoming);

                cleaned = removeNull(resource_incoming.toJSON());
                doc = cleaned;
            }

            delete doc['_id'];

            // Insert/update our resource record
            // When using the $set operator, only the specified fields are updated
            /**
             * @type {FindOneAndUpdateResult|null}
             */
            const res = await this.databaseQueryFactory.createQuery(resourceType, base_version, useAtlas)
                .findOneAndUpdateAsync({id: id}, {$set: doc}, {upsert: true});
            // save to history

            // let history_resource = Object.assign(cleaned, {id: id});
            /**
             * @type {Resource}
             */
            let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});
            // delete history_resource['_id']; // make sure we don't have an _id field when inserting into history

            // Insert our resource record to history but don't assign _id
            await this.databaseHistoryFactory.createDatabaseHistoryManager(resourceType, base_version, useAtlas)
                .insertOneAsync(history_resource);

            if (resourceType !== 'AuditEvent') {
                // log access to audit logs
                await this.auditLogger.logAuditEntryAsync(requestInfo, base_version, resourceType,
                    currentOperationName, args, [resource_incoming['id']]);
                const currentDate = moment.utc().format('YYYY-MM-DD');
                await this.auditLogger.flushAsync(requestId, currentDate);
            }

            const result = {
                id: id,
                created: res.created,
                resource_version: doc.meta.versionId,
            };
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationCompleted',
                action: currentOperationName,
                result: JSON.stringify(result)
            });
            await this.changeEventProducer.fireEventsAsync(requestId, 'U', resourceType, doc);
            this.postRequestProcessor.add(async () => await this.changeEventProducer.flushAsync(requestId));

            return result;
        } catch (e) {
            const currentDate = moment.utc().format('YYYY-MM-DD');
            await sendToS3('errors',
                resourceType,
                resource_incoming_json,
                currentDate,
                id,
                currentOperationName);
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationFailed',
                action: currentOperationName,
                e
            });
            throw e;
        }
    }
}

module.exports = {
    UpdateOperation
};

