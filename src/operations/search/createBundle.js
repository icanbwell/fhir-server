const {getResource} = require('../common/getResource');
const moment = require('moment-timezone');
const env = require('var');
const {logDebug} = require('../common/logging');
const {mongoQueryAndOptionsStringify, mongoQueryStringify} = require('../../utils/mongoQueryStringify');

/**
 * @typedef CreateBundleParameters
 * @type {object}
 * @property {string | null} url
 * @property {string | null} last_id
 * @property {Resource[]} resources
 * @property {string} base_version
 * @property {number|null} total_count
 * @property {Object} args
 * @property {import('mongodb').Document|import('mongodb').Document[]} originalQuery
 * @property {string} collectionName
 * @property {import('mongodb').FindOneOptions | import('mongodb').FindOneOptions[]} originalOptions
 * @property {Set} columns
 * @property {number} stopTime
 * @property {number} startTime
 * @property {boolean} useTwoStepSearchOptimization
 * @property {string|null} indexHint
 * @property {number | null} cursorBatchSize
 * @property {string | null} user
 * @property {boolean | null} useAtlas
 */

/**
 * creates a bundle from the given resources
 * @param {CreateBundleParameters} options
 * @return {Resource}
 */
function createBundle(options) {
    const {
        originalUrl,
        host,
        protocol,
        last_id,
        resources,
        base_version,
        total_count,
        args,
        originalQuery,
        collectionName,
        originalOptions,
        columns,
        stopTime,
        startTime,
        useTwoStepSearchOptimization,
        indexHint,
        cursorBatchSize,
        user,
        useAtlas
    } = options;

    /**
     * array of links
     * @type {[{relation:string, url: string}]}
     */
    let link = [];
    // find id of last resource
    if (originalUrl) {
        if (last_id) {
            // have to use a base url or URL() errors
            const baseUrl = 'https://example.org';
            /**
             * url to get next page
             * @type {URL}
             */
            const nextUrl = new URL(originalUrl, baseUrl);
            // add or update the id:above param
            nextUrl.searchParams.set('id:above', `${last_id}`);
            // remove the _getpagesoffset param since that will skip again from this id
            nextUrl.searchParams.delete('_getpagesoffset');
            link = [
                {
                    relation: 'self',
                    url: `${protocol}`.concat('://', `${host}`, `${originalUrl}`),
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
                    url: `${protocol}`.concat('://', `${host}`, `${originalUrl}`),
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
                display: mongoQueryAndOptionsStringify(collectionName, originalQuery, originalOptions),
            },
            {
                system: 'https://www.icanbwell.com/queryCollection',
                code: collectionName,
            },
            {
                system: 'https://www.icanbwell.com/queryOptions',
                display: originalOptions ? mongoQueryStringify(originalOptions) : null,
            },
            {
                system: 'https://www.icanbwell.com/queryFields',
                display: columns ? mongoQueryStringify(Array.from(columns)) : null,
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
    createBundle
};
