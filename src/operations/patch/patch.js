const {logRequest, logError} = require('../common/logging');
const {verifyHasValidScopes} = require('../security/scopes');
const globals = require('../../globals');
const {CLIENT_DB, AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB} = require('../../constants');
const {BadRequestError, NotFoundError} = require('../../utils/httpErrors');
const {validate, applyPatch} = require('fast-json-patch');
const {getResource} = require('../common/getResource');
const moment = require('moment-timezone');
const {removeNull} = require('../../utils/nullRemover');
const {preSaveAsync} = require('../common/preSave');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
/**
 * does a FHIR Patch
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceName
 * @param {string} collection_name
 */
// eslint-disable-next-line no-unused-vars
module.exports.patch = async (requestInfo, args, resourceName, collection_name) => {
    const user = requestInfo.user;
    const scope = requestInfo.scope;

    logRequest(user, 'Patient >>> patch');
    verifyHasValidScopes(resourceName, 'write', user, scope);

    let {base_version, id, patchContent} = args;

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

    let collection = db.collection(`${collection_name}_${base_version}`);

    // Get current record
    // Query our collection for this observation
    let data;
    try {
        data = await collection.findOne({id: id.toString()});
    } catch (e) {
        logError(user, `Error with ${resourceName}.patch: ${e} `);
        throw new BadRequestError(e);
    }
    if (!data) {
        throw new NotFoundError();
    }
    // Validate the patch
    let errors = validate(patchContent, data);
    if (errors && Object.keys(errors).length > 0) {
        logError(user, 'Error with patch contents');
        throw new BadRequestError(errors[0]);
    }
    // Make the changes indicated in the patch
    let resource_incoming = applyPatch(data, patchContent).newDocument;

    let Resource = getResource(base_version, resourceName);
    let resource = new Resource(resource_incoming);

    if (data && data.meta) {
        let foundResource = new Resource(data);
        let meta = foundResource.meta;
        // noinspection JSUnresolvedVariable
        meta.versionId = `${parseInt(foundResource.meta.versionId) + 1}`;
        meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
        resource.meta = meta;
    } else {
        throw new BadRequestError(new Error('Unable to patch resource. Missing either data or metadata.'));
    }

    await preSaveAsync(resource);

    // Same as update from this point on
    let cleaned = removeNull(resource.toJSON());
    let doc = cleaned;

    // Insert/update our resource record
    let res;
    try {
        delete doc['_id'];
        res = await collection.findOneAndUpdate({id: id}, {$set: doc}, {upsert: true});
    } catch (e) {
        logError(user, `Error with ${resourceName}.update: ${e}`);
        throw new BadRequestError(e);
    }
    // Save to history
    let history_collection = db.collection(`${collection_name}_${base_version}_History`);
    let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});

    // Insert our resource record to history but don't assign _id
    try {
        await history_collection.insertOne(history_resource);
    } catch (e) {
        logError(user, `Error with ${resourceName}History.create: ${e}`);
        throw new BadRequestError(e);
    }
    return {
        id: doc.id,
        created: res.lastErrorObject && !res.lastErrorObject.updatedExisting,
        resource_version: doc.meta.versionId,
    };
};
