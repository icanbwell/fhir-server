const {logRequest, logDebug, logError} = require('../common/logging');
const {verifyHasValidScopes, doesResourceHaveAccessTags} = require('../security/scopes');
const {getUuid} = require('../../utils/uid.util');
const env = require('var');
const moment = require('moment-timezone');
const sendToS3 = require('../../utils/aws-s3');
const {validateResource} = require('../../utils/validator.util');
const {NotValidatedError, BadRequestError} = require('../../utils/httpErrors');
const {getResource} = require('../common/getResource');
const {getMeta} = require('../common/getMeta');
const {removeNull} = require('../../utils/nullRemover');
const {logAuditEntryAsync} = require('../../utils/auditLogger');
const {preSaveAsync} = require('../common/preSave');
const {isTrue} = require('../../utils/isTrue');
const {DatabaseUpdateManager} = require('../../utils/databaseUpdateManager');
const {DatabaseHistoryManager} = require('../../utils/databaseHistoryManager');

/**
 * does a FHIR Create (POST)
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} path
 * @param {string} resourceType
 */
module.exports.create = async (requestInfo, args, path, resourceType) => {
    const user = requestInfo.user;
    const scope = requestInfo.scope;
    const body = requestInfo.body;

    logRequest(user, `${resourceType} >>> create`);

    verifyHasValidScopes(resourceType, 'write', user, scope);

    let resource_incoming = body;

    let {base_version} = args;

    logDebug(user, '--- body ----');
    logDebug(user, JSON.stringify(resource_incoming));
    logDebug(user, '-----------------');
    const uuid = resource_incoming.id || getUuid(resource_incoming);

    if (env.LOG_ALL_SAVES) {
        const currentDate = moment.utc().format('YYYY-MM-DD');
        await sendToS3('logs',
            resourceType,
            resource_incoming,
            currentDate,
            uuid,
            'create'
        );
    }

    if (env.VALIDATE_SCHEMA || args['_validate']) {
        logDebug(user, '--- validate schema ----');
        const operationOutcome = validateResource(resource_incoming, resourceType, path);
        if (operationOutcome && operationOutcome.statusCode === 400) {
            const currentDate = moment.utc().format('YYYY-MM-DD');
            operationOutcome.expression = [
                resourceType + '/' + uuid
            ];
            await sendToS3('validation_failures',
                resourceType,
                resource_incoming,
                currentDate,
                uuid,
                'create');
            await sendToS3('validation_failures',
                'OperationOutcome',
                operationOutcome,
                currentDate,
                uuid,
                'create_failure');
            throw new NotValidatedError(operationOutcome);
        }
        logDebug(user, '-----------------');
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
            await logAuditEntryAsync(requestInfo, base_version, resourceType, 'create', args, [resource['id']]);
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
            await new DatabaseUpdateManager(resourceType, base_version, useAtlas).insertOne(doc);
        } catch (e) {
            // noinspection ExceptionCaughtLocallyJS
            throw new BadRequestError(e);
        }
        // Save the resource to history

        // Insert our resource record to history but don't assign _id
        await new DatabaseHistoryManager(resourceType, base_version, useAtlas).insertOne(history_doc);
        return {id: doc.id, resource_version: doc.meta.versionId};
    } catch (e) {
        const currentDate = moment.utc().format('YYYY-MM-DD');
        logError(`Error with creating resource ${resourceType} with id: ${uuid} `, e);

        await sendToS3('errors',
            resourceType,
            resource_incoming,
            currentDate,
            uuid,
            'create');
        throw e;
    }
};
