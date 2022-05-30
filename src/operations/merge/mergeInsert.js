const {logDebug} = require('../common/logging');
const env = require('var');
const {doesResourceHaveAccessTags} = require('../security/scopes');
const {BadRequestError} = require('../../utils/httpErrors');
const {getMeta} = require('../common/getMeta');
const moment = require('moment-timezone');
const {removeNull} = require('../../utils/nullRemover');
const {performMergeDbUpdateAsync} = require('./performMergeDbUpdate');

/**
 * merge insert
 * @param {Resource} resourceToMerge
 * @param {string} baseVersion
 * @param {string} collectionName
 * @param {string | null} user
 * @returns {Promise<{created: boolean, id: *, updated: *, resource_version}>}
 */
async function mergeInsertAsync(resourceToMerge, baseVersion, collectionName, user) {
    let id = resourceToMerge.id;
    // not found so insert
    logDebug(user,
        resourceToMerge.resourceType +
        ': merge new resource ' +
        '[' + resourceToMerge.id + ']: ' +
        JSON.stringify(resourceToMerge)
    );
    if (env.CHECK_ACCESS_TAG_ON_SAVE === '1') {
        if (!doesResourceHaveAccessTags(resourceToMerge)) {
            throw new BadRequestError(new Error('Resource is missing a security access tag with system: https://www.icanbwell.com/access '));
        }
    }

    if (!resourceToMerge.meta) {
        // create the metadata
        /**
         * @type {function({Object}): Meta}
         */
        let Meta = getMeta(baseVersion);
        resourceToMerge.meta = new Meta({
            versionId: '1',
            lastUpdated: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
        });
    } else {
        resourceToMerge.meta.versionId = '1';
        resourceToMerge.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
    }

    // const cleaned = JSON.parse(JSON.stringify(resourceToMerge));
    // let Resource = getResource(base_version, resourceToMerge.resourceType);
    // const cleaned = new Resource(resourceToMerge).toJSON();
    const cleaned = removeNull(resourceToMerge);
    const doc = Object.assign(cleaned, {_id: id});

    return await performMergeDbUpdateAsync(resourceToMerge, doc, cleaned, baseVersion, collectionName);
}

module.exports = {
    mergeInsertAsync
};
