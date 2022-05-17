const {logRequest, logDebug} = require('../common/logging');
const {
    verifyHasValidScopes,
    isAccessToResourceAllowedBySecurityTags,
    doesResourceHaveAccessTags
} = require('../security/scopes');
const env = require('var');
const moment = require('moment-timezone');
const sendToS3 = require('../../utils/aws-s3');
const {validateResource} = require('../../utils/validator.util');
const {getUuid} = require('../../utils/uid.util');
const {NotValidatedError, ForbiddenError, BadRequestError} = require('../../utils/httpErrors');
const globals = require('../../globals');
const {CLIENT_DB, AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB} = require('../../constants');
const {getResource} = require('../common/getResource');
const {compare} = require('fast-json-patch');
const {getMeta} = require('../common/getMeta');
const {logError} = require('../common/logging');
const {getOrCreateCollection} = require('../../utils/mongoCollectionManager');
const {removeNull} = require('../../utils/nullRemover');
const {logAuditEntry} = require('../../utils/auditLogger');
const {preSaveAsync} = require('../common/preSave');
const {isTrue} = require('../../utils/isTrue');
/**
 * does a FHIR Update (PUT)
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceName
 * @param {string} collection_name
 */
module.exports.update = async (requestInfo, args, resourceName, collection_name) => {
    const user = requestInfo.user;
    const scope = requestInfo.scope;
    const path = requestInfo.path;
    const body = requestInfo.body;
    logRequest(user, `'${resourceName} >>> update`);

    verifyHasValidScopes(resourceName, 'write', user, scope);

    // read the incoming resource from request body
    let resource_incoming_json = body;
    let {base_version, id} = args;
    logDebug(user, base_version);
    logDebug(user, id);
    logDebug(user, '--- body ----');
    logDebug(user, JSON.stringify(resource_incoming_json));

    if (env.LOG_ALL_SAVES) {
        const currentDate = moment.utc().format('YYYY-MM-DD');
        await sendToS3('logs',
            resourceName,
            resource_incoming_json,
            currentDate,
            id,
            'update');
    }

    if (env.VALIDATE_SCHEMA || args['_validate']) {
        logDebug(user, '--- validate schema ----');
        const operationOutcome = validateResource(resource_incoming_json, resourceName, path);
        if (operationOutcome && operationOutcome.statusCode === 400) {
            const currentDate = moment.utc().format('YYYY-MM-DD');
            const uuid = getUuid(resource_incoming_json);
            operationOutcome.expression = [
                resourceName + '/' + uuid
            ];
            await sendToS3('validation_failures',
                resourceName,
                resource_incoming_json,
                currentDate,
                uuid,
                'update');
            await sendToS3('validation_failures',
                resourceName,
                operationOutcome,
                currentDate,
                uuid,
                'update_failure');
            throw new NotValidatedError(operationOutcome);
        }
        logDebug(user, '-----------------');
    }

    try {
        /**
         * @type {boolean}
         */
        const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

        // Grab an instance of our DB and collection
        // noinspection JSValidateTypes
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        let db = (resourceName === 'AuditEvent') ?
            globals.get(AUDIT_EVENT_CLIENT_DB) : (useAtlas && globals.has(ATLAS_CLIENT_DB)) ?
                globals.get(ATLAS_CLIENT_DB) : globals.get(CLIENT_DB);
        /**
         * @type {import('mongodb').Collection}
         */
        let collection = await getOrCreateCollection(db, `${collection_name}_${base_version}`);

        // Get current record
        // Query our collection for this observation
        // noinspection JSUnresolvedVariable
        /**
         * @type {Resource | null}
         */
        let data = await collection.findOne({id: id.toString()});
        // create a resource with incoming data
        /**
         * @type {function(?Object): Resource}
         */
        let ResourceCreator = getResource(base_version, resourceName);

        /**
         * @type {Resource}
         */
        let resource_incoming = new ResourceCreator(resource_incoming_json);
        let cleaned;
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
                return {
                    id: id,
                    created: false,
                    resource_version: foundResource.meta.versionId,
                };
            }
            if (env.LOG_ALL_SAVES) {
                const currentDate = moment.utc().format('YYYY-MM-DD');
                await sendToS3('logs',
                    resourceName,
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
            cleaned = removeNull(resource_incoming);
            doc = Object.assign(cleaned, {_id: id});
            // check_fhir_mismatch(cleaned, patched_incoming_data);
        } else {
            // not found so insert
            logDebug(user, 'update: new resource: ' + resource_incoming);
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
            doc = Object.assign(cleaned, {_id: id});
        }

        // Insert/update our resource record
        // When using the $set operator, only the specified fields are updated
        const res = await collection.findOneAndUpdate({id: id}, {$set: doc}, {upsert: true});
        // save to history
        let history_collection = await getOrCreateCollection(db, `${collection_name}_${base_version}_History`);

        // let history_resource = Object.assign(cleaned, {id: id});
        let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});
        // delete history_resource['_id']; // make sure we don't have an _id field when inserting into history

        // Insert our resource record to history but don't assign _id
        await history_collection.insertOne(history_resource);

        if (resourceName !== 'AuditEvent') {
            // log access to audit logs
            await logAuditEntry(requestInfo, base_version, resourceName, 'update', args, [resource_incoming['id']]);
        }

        return {
            id: id,
            created: res.lastErrorObject && !res.lastErrorObject.updatedExisting,
            resource_version: doc.meta.versionId,
        };
    } catch (e) {
        const currentDate = moment.utc().format('YYYY-MM-DD');
        logError(`Error with updating resource ${resourceName}.update with id: ${id} `, e);

        await sendToS3('errors',
            resourceName,
            resource_incoming_json,
            currentDate,
            id,
            'update');
        throw e;
    }
};
