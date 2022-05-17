const {getResource} = require('../common/getResource');
const moment = require('moment-timezone');
const env = require('var');
const {logDebug} = require('../common/logging');
const {mongoQueryStringify} = require('../../utils/mongoQueryStringify');

/**
 * creates a bundle from the given resources
 * @param {string | null} url
 * @param {string | null} last_id
 * @param {Resource[]} resources
 * @param {string} base_version
 * @param {number} total_count
 * @param {Object} args
 * @param {Object|Object[]} originalQuery
 * @param {string} mongoCollectionName
 * @param {Object|Object[]} originalOptions
 * @param {Set} columns
 * @param {number} stopTime
 * @param {number} startTime
 * @param {boolean} useTwoStepSearchOptimization
 * @param {string} indexHint
 * @param {number | null} cursorBatchSize
 * @param {string | null} user
 * @param {boolean | null} useAtlas
 * @return {Resource}
 */
function createBundle(
    url,
    last_id,
    resources,
    base_version,
    total_count,
    args,
    originalQuery,
    mongoCollectionName,
    originalOptions,
    columns,
    stopTime,
    startTime,
    useTwoStepSearchOptimization,
    indexHint,
    cursorBatchSize,
    user,
    useAtlas
) {
    /**
     * array of links
     * @type {[{relation:string, url: string}]}
     */
    let link = [];
    // find id of last resource
    if (url) {
        if (last_id) {
            // have to use a base url or URL() errors
            const baseUrl = 'https://example.org';
            /**
             * url to get next page
             * @type {URL}
             */
            const nextUrl = new URL(url, baseUrl);
            // add or update the id:above param
            nextUrl.searchParams.set('id:above', `${last_id}`);
            // remove the _getpagesoffset param since that will skip again from this id
            nextUrl.searchParams.delete('_getpagesoffset');
            link = [
                {
                    relation: 'self',
                    url: `${url}`,
                },
                {
                    relation: 'next',
                    url: `${nextUrl.toString().replace(baseUrl, '')}`,
                },
            ];
        } else {
            link = [
                {
                    relation: 'self',
                    url: `${url}`,
                },
            ];
        }
    }
    /**
     * @type {function({Object}):Resource}
     */
    const Bundle = getResource(base_version, 'bundle');
    /**
     * @type {{resource: Resource}[]}
     */
    const entries = resources.map((resource) => {
        return {resource: resource};
    });
    const bundle = new Bundle({
        type: 'searchset',
        timestamp: moment.utc().format('YYYY-MM-DDThh:mm:ss.sss') + 'Z',
        entry: entries,
        total: total_count,
        link: link,
    });

    if (args['_debug'] || env.LOGLEVEL === 'DEBUG') {
        const tag = [
            {
                system: 'https://www.icanbwell.com/query',
                display: mongoQueryStringify(originalQuery),
            },
            {
                system: 'https://www.icanbwell.com/queryCollection',
                code: mongoCollectionName,
            },
            {
                system: 'https://www.icanbwell.com/queryOptions',
                display: originalOptions ? JSON.stringify(originalOptions) : null,
            },
            {
                system: 'https://www.icanbwell.com/queryFields',
                display: columns ? JSON.stringify(Array.from(columns)) : null,
            },
            {
                system: 'https://www.icanbwell.com/queryTime',
                display: `${(stopTime - startTime) / 1000}`,
            },
            {
                system: 'https://www.icanbwell.com/queryOptimization',
                display: `{'useTwoStepSearchOptimization':${useTwoStepSearchOptimization}}`,
            },
        ];
        if (indexHint) {
            tag.push({
                system: 'https://www.icanbwell.com/queryIndexHint',
                code: indexHint,
            });
        }
        if (useAtlas) {
            tag.push({
                system: 'https://www.icanbwell.com/queryUseAtlas',
                code: useAtlas,
            });
        }
        if (cursorBatchSize !== null && cursorBatchSize > 0) {
            tag.push({
                system: 'https://www.icanbwell.com/queryCursorBatchSize',
                display: `${cursorBatchSize}`,
            });
        }
        bundle['meta'] = {
            tag: tag,
        };
        logDebug(user, JSON.stringify(bundle));
    }
    return bundle;
}


module.exports = {
    createBundle: createBundle
};
