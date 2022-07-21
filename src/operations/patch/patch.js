const {logRequest, logError} = require('../common/logging');
const {verifyHasValidScopes} = require('../security/scopes');
const {BadRequestError, NotFoundError} = require('../../utils/httpErrors');
const {validate, applyPatch} = require('fast-json-patch');
const {getResource} = require('../common/getResource');
const moment = require('moment-timezone');
const {removeNull} = require('../../utils/nullRemover');
const {preSaveAsync} = require('../common/preSave');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {
    getOrCreateCollectionForResourceTypeAsync,
    getOrCreateHistoryCollectionForResourceTypeAsync
} = require('../common/resourceManager');
/**
 * does a FHIR Patch
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 */
// eslint-disable-next-line no-unused-vars
module.exports.patch = async (requestInfo, args, resourceType) => {
    const user = requestInfo.user;
    const scope = requestInfo.scope;

    logRequest(user, 'Patient >>> patch');
    verifyHasValidScopes(resourceType, 'write', user, scope);

    let {base_version, id, patchContent} = args;

    /**
     * @type {boolean}
     */
    const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
     */
    const collection = await getOrCreateCollectionForResourceTypeAsync(resourceType, base_version, useAtlas);

    // Get current record
    // Query our collection for this observation
    let data;
    try {
        data = await collection.findOne({id: id.toString()});
    } catch (e) {
        logError(user, `Error with ${resourceType}.patch: ${e} `);
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

    let Resource = getResource(base_version, resourceType);
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
        logError(user, `Error with ${resourceType}.update: ${e}`);
        throw new BadRequestError(e);
    }
    // Save to history
    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
     */
    const history_collection = await getOrCreateHistoryCollectionForResourceTypeAsync(resourceType, base_version, useAtlas);
    let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});

    // Insert our resource record to history but don't assign _id
    try {
        await history_collection.insertOne(history_resource);
    } catch (e) {
        logError(user, `Error with ${resourceType}History.create: ${e}`);
        throw new BadRequestError(e);
    }
    return {
        id: doc.id,
        created: res.lastErrorObject && !res.lastErrorObject.updatedExisting,
        resource_version: doc.meta.versionId,
    };
};
