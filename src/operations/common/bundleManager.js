const {getResource} = require('./getResource');
const moment = require('moment-timezone');
const env = require('var');
const {mongoQueryAndOptionsStringify, mongoQueryStringify} = require('../../utils/mongoQueryStringify');
const {logDebug} = require('./logging');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const {MongoExplainPlanHelper} = require('../../utils/mongoExplainPlanHelper');

/**
 * This class creates a Bundle resource out of a list of resources
 */
class BundleManager {
    constructor() {
    }

    /**
     * generates a full url for an entity
     * @param {string} protocol
     * @param {string} host
     * @param {string} base_version
     * @param {Resource} resource
     * @return {string}
     */
    getFullUrlForResource({protocol, host, base_version, resource}) {
        return `${protocol}://${host}/${base_version}/${resource.resourceType}/${resource.id}`;
    }

    /**
     * creates a bundle from the given resources
     * @param {string} requestId
     * @param {string} type
     * @param {string | null} originalUrl
     * @param {string | null} host
     * @param {string | null} protocol
     * @param {string | null} [last_id]
     * @param {Resource[]} resources
     * @param {string} base_version
     * @param {number|null} [total_count]
     * @param {Object} args
     * @param {import('mongodb').Document|import('mongodb').Document[]} originalQuery
     * @param {string} collectionName
     * @param {import('mongodb').FindOneOptions | import('mongodb').FindOneOptions[]} originalOptions
     * @param {Set|undefined} [columns]
     * @param {number} stopTime
     * @param {number} startTime
     * @param {boolean|undefined} [useTwoStepSearchOptimization]
     * @param {string|undefined} [indexHint]
     * @param {number | undefined} [cursorBatchSize]
     * @param {string | null} user
     * @param {import('mongodb').Document[]} explanations
     * @return {Bundle}
     */
    createBundle(
        {
            requestId,
            type,
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
            explanations
        }) {
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
                        url: `${protocol}`.concat('://', `${host}`, `${nextUrl.toString().replace(baseUrl, '')}`),
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
         * @type {BundleEntry[]}
         */
        const entries = resources.map((resource) => {
            return new BundleEntry(
                {
                    resource: resource,
                    fullUrl: this.getFullUrlForResource(
                        {protocol, host, base_version, resource})
                }
            );
        });
        // noinspection JSValidateTypes
        /**
         * @type {Bundle}
         */
        const bundle = new Bundle({
            type: type,
            timestamp: moment.utc().format('YYYY-MM-DDThh:mm:ss.sss') + 'Z',
            entry: entries,
            link: link,
        });
        if (total_count !== null) {
            bundle.total = total_count;
        }
        if (requestId) {
            bundle.id = requestId;
        }

        if ((args && (args['_explain'] || args['_debug'])) || env.LOGLEVEL === 'DEBUG') {
            /**
             * @type {[{[system]: string|undefined, [display]: string|undefined, [code]: string|undefined}]}
             */
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
                }
            ];
            if (indexHint) {
                tag.push({
                    system: 'https://www.icanbwell.com/queryIndexHint',
                    code: indexHint,
                });
            }
            if (explanations && explanations.length > 0) {
                tag.push({
                    system: 'https://www.icanbwell.com/queryExplain',
                    display: JSON.stringify(explanations),
                });
                const explainer = new MongoExplainPlanHelper();
                const simpleExplanations = explanations ?
                    explanations.map(
                        ( /** @type {{queryPlanner: Object, executionStats: Object, serverInfo: Object}} */ e,
                          index) => explainer.quick_explain(
                            {
                                explanation: e,
                                query: (Array.isArray(originalQuery) && originalQuery.length > index) ?
                                    mongoQueryAndOptionsStringify(collectionName, originalQuery[`${index}`], originalOptions || {}) :
                                    mongoQueryAndOptionsStringify(collectionName, originalQuery, originalOptions || {})
                            }
                        )
                    ) : [];
                tag.push({
                    system: 'https://www.icanbwell.com/queryExplainSimple',
                    display: JSON.stringify(simpleExplanations),
                });
            }
            if (cursorBatchSize && cursorBatchSize > 0) {
                tag.push({
                    system: 'https://www.icanbwell.com/queryCursorBatchSize',
                    display: `${cursorBatchSize}`,
                });
            }
            bundle['meta'] = {
                tag: tag,
            };
            logDebug({user, args: bundle});
        }
        return bundle;
    }
}

module.exports = {
    BundleManager
};
