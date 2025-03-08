const moment = require('moment-timezone');
const env = require('var');
const { mongoQueryAndOptionsStringify, mongoQueryStringify } = require('../../utils/mongoQueryStringify');
const { logDebug } = require('./logging');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const { MongoExplainPlanHelper } = require('../../utils/mongoExplainPlanHelper');
const { assertTypeEquals } = require('../../utils/assertType');
const { ResourceManager } = require('./resourceManager');
const { removeDuplicatesWithLambda } = require('../../utils/list.util');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { QueryItem } = require('../graph/queryItem');
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');
const BundleLink = require('../../fhir/classes/4_0_0/backbone_elements/bundleLink');

/**
 * This class creates a Bundle resource out of a list of resources
 */
class BundleManager {
    /**
     * constructor
     * @param {ResourceManager} resourceManager
     */
    constructor (
        {
            resourceManager
        }
    ) {
        /**
         * @type {ResourceManager}
         */
        this.resourceManager = resourceManager;
        assertTypeEquals(resourceManager, ResourceManager);
    }

    /**
     * creates a bundle from the given resources
     * @param {string|null} requestId
     * @param {string} type
     * @param {string | null} originalUrl
     * @param {string | null} host
     * @param {string | null} protocol
     * @param {string | null} [last_id]
     * @param {Resource[]} resources
     * @param {string} base_version
     * @param {number|null} [total_count]
     * @param {ParsedArgs} parsedArgs
     * @param {QueryItem|Query[]|QueryItem[]} originalQuery
     * @param {string | undefined} [databaseName]
     * @param {import('mongodb').FindOneOptions | import('mongodb').FindOneOptions[]| import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]} originalOptions
     * @param {Set|undefined} [columns]
     * @param {number} stopTime
     * @param {number} startTime
     * @param {boolean|undefined} [useTwoStepSearchOptimization]
     * @param {string|undefined} [indexHint]
     * @param {number | undefined} [cursorBatchSize]
     * @param {string | null} user
     * @param {import('mongodb').Document[]} explanations
     * @param {string[]|undefined} [allCollectionsToSearch]
     * @return {Bundle}
     */
    createBundle (
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
            parsedArgs,
            originalQuery,
            databaseName,
            originalOptions,
            columns,
            stopTime,
            startTime,
            useTwoStepSearchOptimization,
            indexHint,
            cursorBatchSize,
            user,
            explanations,
            allCollectionsToSearch
        }) {
        /**
         * @type {BundleEntry[]}
         */
        const entries = resources.map((resource) => {
            return new BundleEntry(
                {
                    id: resource.id,
                    resource,
                    fullUrl: this.resourceManager.getFullUrlForResource(
                        { protocol, host, base_version, resource })
                }
            );
        });
        /**
         * @type {Bundle}
         */
        return this.createBundleFromEntries(
            {
                requestId,
                type,
                originalUrl,
                host,
                protocol,
                last_id,
                entries,
                base_version,
                total_count,
                parsedArgs,
                originalQuery,
                databaseName,
                originalOptions,
                columns,
                stopTime,
                startTime,
                useTwoStepSearchOptimization,
                indexHint,
                cursorBatchSize,
                user,
                explanations,
                allCollectionsToSearch
            });
    }

    /**
     * creates a bundle from the given resources
     * @param {string|null} requestId
     * @param {string} type
     * @param {string | null} originalUrl
     * @param {string | null} host
     * @param {string | null} protocol
     * @param {string | null} [last_id]
     * @param {Resource[]} resources
     * @param {string} base_version
     * @param {number|null} [total_count]
     * @param {ParsedArgs} parsedArgs
     * @param {QueryItem|Query[]|QueryItem[]} originalQuery
     * @param {string | undefined} [databaseName]
     * @param {import('mongodb').FindOneOptions | import('mongodb').FindOneOptions[]| import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]} originalOptions
     * @param {Set|undefined} [columns]
     * @param {number} stopTime
     * @param {number} startTime
     * @param {boolean|undefined} [useTwoStepSearchOptimization]
     * @param {string|undefined} [indexHint]
     * @param {number | undefined} [cursorBatchSize]
     * @param {string | null} user
     * @param {import('mongodb').Document[]} explanations
     * @param {string[]|undefined} [allCollectionsToSearch]
     * @return {Bundle}
     */
    createRawBundle({
        requestId,
        type,
        originalUrl,
        host,
        protocol,
        last_id,
        resources,
        base_version,
        total_count,
        parsedArgs,
        originalQuery,
        databaseName,
        originalOptions,
        columns,
        stopTime,
        startTime,
        useTwoStepSearchOptimization,
        indexHint,
        cursorBatchSize,
        user,
        explanations,
        allCollectionsToSearch
    }) {
        /**
         * @type {BundleEntry[]}
         */
        const entries = resources.map((resource) => {
            return {
                id: resource.id,
                resource,
                fullUrl: this.resourceManager.getFullUrlForResource({ protocol, host, base_version, resource })
            };
        });

        if (Array.isArray(originalQuery)) {
            for (const q of originalQuery) {
                assertTypeEquals(q, QueryItem);
            }
        } else {
            assertTypeEquals(originalQuery, QueryItem);
        }

        /**
         * array of links
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
                        url: `${protocol}`.concat('://', `${host}`, `${originalUrl}`)
                    },
                    {
                        relation: 'next',
                        url: `${protocol}`.concat('://', `${host}`, `${nextUrl.toString().replace(baseUrl, '')}`)
                    }
                ];
            } else {
                link = [
                    {
                        relation: 'self',
                        url: `${protocol}`.concat('://', `${host}`, `${originalUrl}`)
                    }
                ];
            }
        }
        // noinspection JSValidateTypes
        /**
         * @type {Bundle}
         */
        const bundle = {
            type,
            timestamp: moment.utc().format('YYYY-MM-DDThh:mm:ss.sss') + 'Z',
            entry: entries.length > 0 ? entries : null,
            link
        };
        if (total_count !== null) {
            bundle.total = total_count;
        }
        if (requestId) {
            bundle.id = requestId;
        }

        if (parsedArgs._explain || parsedArgs._debug || env.LOGLEVEL === 'DEBUG') {
            /**
             * @type {[{[system]: string|undefined, [display]: string|undefined, [code]: string|undefined}]}
             */
            const tag = [
                {
                    system: 'https://www.icanbwell.com/query',
                    display: mongoQueryAndOptionsStringify({ query: originalQuery, options: originalOptions })
                },
                {
                    system: 'https://www.icanbwell.com/queryCollection',
                    code: Array.isArray(originalQuery)
                        ? originalQuery.map((q) => this.getQueryCollection(allCollectionsToSearch, q.collectionName)).join('|')
                        : this.getQueryCollection(allCollectionsToSearch, originalQuery.collectionName)
                },
                {
                    system: 'https://www.icanbwell.com/queryOptions',
                    display: this.getQueryOptions(originalOptions)
                },
                {
                    system: 'https://www.icanbwell.com/queryFields',
                    display: this.getQueryFields(columns)
                },
                {
                    system: 'https://www.icanbwell.com/queryTime',
                    display: `${(stopTime - startTime) / 1000}`
                },
                {
                    system: 'https://www.icanbwell.com/queryOptimization',
                    display: `{'useTwoStepSearchOptimization':${useTwoStepSearchOptimization}}`
                }
            ];
            if (databaseName) {
                tag.push({
                    system: 'https://www.icanbwell.com/queryDatabase',
                    code: databaseName
                });
            }
            if (indexHint) {
                tag.push({
                    system: 'https://www.icanbwell.com/queryIndexHint',
                    code: indexHint
                });
            }
            if (explanations && explanations.length > 0) {
                tag.push({
                    system: 'https://www.icanbwell.com/queryExplain',
                    display: JSON.stringify(explanations, getCircularReplacer())
                });
                const explainer = new MongoExplainPlanHelper();
                // noinspection JSCheckFunctionSignatures
                const simpleExplanations = explanations
                    ? explanations.map((/** @type {{queryPlanner: Object, executionStats: Object, serverInfo: Object}} */ e, index) =>
                          explainer.quick_explain({
                              explanation: e,
                              query:
                                  Array.isArray(originalQuery) && originalQuery.length > index
                                      ? mongoQueryAndOptionsStringify({
                                            query: originalQuery[`${index}`],
                                            options: originalOptions || {}
                                        })
                                      : mongoQueryAndOptionsStringify({
                                            query: originalQuery,
                                            options: originalOptions || {}
                                        })
                          })
                      )
                    : [];
                tag.push({
                    system: 'https://www.icanbwell.com/queryExplainSimple',
                    display: JSON.stringify(simpleExplanations, getCircularReplacer())
                });
            }
            if (cursorBatchSize && cursorBatchSize > 0) {
                tag.push({
                    system: 'https://www.icanbwell.com/queryCursorBatchSize',
                    display: `${cursorBatchSize}`
                });
            }
            bundle.meta = {
                tag
            };
            logDebug('', { user, args: bundle });
        }
        return bundle;
    }

    /**
     * creates a bundle from the given resources
     * @param {string} requestId
     * @param {string} type
     * @param {string | null} originalUrl
     * @param {string | null} host
     * @param {string | null} protocol
     * @param {string | null} [last_id]
     * @param {BundleEntry[]} entries
     * @param {number|null} [total_count]
     * @param {ParsedArgs} parsedArgs
     * @param {QueryItem|QueryItem[]} originalQuery
     * @param {string | undefined} [databaseName]
     * @param {import('mongodb').FindOneOptions | import('mongodb').FindOneOptions[]} originalOptions
     * @param {Set|undefined} [columns]
     * @param {number} stopTime
     * @param {number} startTime
     * @param {boolean|undefined} [useTwoStepSearchOptimization]
     * @param {string|undefined} [indexHint]
     * @param {number | undefined} [cursorBatchSize]
     * @param {string | null} user
     * @param {import('mongodb').Document[]} explanations
     * @param {string[]|undefined} [allCollectionsToSearch]
     * @return {Bundle}
     */
    createBundleFromEntries (
        {
            requestId,
            type,
            originalUrl,
            host,
            protocol,
            last_id,
            entries,
            total_count,
            parsedArgs,
            originalQuery,
            databaseName,
            originalOptions,
            columns,
            stopTime,
            startTime,
            useTwoStepSearchOptimization,
            indexHint,
            cursorBatchSize,
            user,
            explanations,
            allCollectionsToSearch
        }) {
        if (Array.isArray(originalQuery)) {
            for (const q of originalQuery) {
                assertTypeEquals(q, QueryItem);
            }
        } else {
            assertTypeEquals(originalQuery, QueryItem);
        }
        /**
         * array of links
         * @type {BundleLink[]}
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
                    new BundleLink({
                        relation: 'self',
                        url: `${protocol}`.concat('://', `${host}`, `${originalUrl}`)
                    }),
                    new BundleLink({
                        relation: 'next',
                        url: `${protocol}`.concat('://', `${host}`, `${nextUrl.toString().replace(baseUrl, '')}`)
                    })
                ];
            } else {
                link = [
                    new BundleLink({
                        relation: 'self',
                        url: `${protocol}`.concat('://', `${host}`, `${originalUrl}`)
                    })
                ];
            }
        }
        // noinspection JSValidateTypes
        /**
         * @type {Bundle}
         */
        const bundle = new Bundle({
            type,
            timestamp: moment.utc().format('YYYY-MM-DDThh:mm:ss.sss') + 'Z',
            entry: entries,
            link
        });
        if (total_count !== null) {
            bundle.total = total_count;
        }
        if (requestId) {
            bundle.id = requestId;
        }

        if (((parsedArgs._explain || parsedArgs._debug)) || env.LOGLEVEL === 'DEBUG') {
            /**
             * @type {[{[system]: string|undefined, [display]: string|undefined, [code]: string|undefined}]}
             */
            const tag = [
                {
                    system: 'https://www.icanbwell.com/query',
                    display: mongoQueryAndOptionsStringify({ query: originalQuery, options: originalOptions })
                },
                {
                    system: 'https://www.icanbwell.com/queryCollection',
                    code: Array.isArray(originalQuery)
                        ? originalQuery.map(q => this.getQueryCollection(allCollectionsToSearch, q.collectionName)).join('|')
                        : this.getQueryCollection(allCollectionsToSearch, originalQuery.collectionName)
                },
                {
                    system: 'https://www.icanbwell.com/queryOptions',
                    display: this.getQueryOptions(originalOptions)
                },
                {
                    system: 'https://www.icanbwell.com/queryFields',
                    display: this.getQueryFields(columns)
                },
                {
                    system: 'https://www.icanbwell.com/queryTime',
                    display: `${(stopTime - startTime) / 1000}`
                },
                {
                    system: 'https://www.icanbwell.com/queryOptimization',
                    display: `{'useTwoStepSearchOptimization':${useTwoStepSearchOptimization}}`
                }
            ];
            if (databaseName) {
                tag.push({
                        system: 'https://www.icanbwell.com/queryDatabase',
                        code: databaseName
                    }
                );
            }
            if (indexHint) {
                tag.push({
                    system: 'https://www.icanbwell.com/queryIndexHint',
                    code: indexHint
                });
            }
            if (explanations && explanations.length > 0) {
                tag.push({
                    system: 'https://www.icanbwell.com/queryExplain',
                    display: JSON.stringify(explanations, getCircularReplacer())
                });
                const explainer = new MongoExplainPlanHelper();
                // noinspection JSCheckFunctionSignatures
                const simpleExplanations = explanations
                    ? explanations.map(
                        (/** @type {{queryPlanner: Object, executionStats: Object, serverInfo: Object}} */ e,
                          index) => explainer.quick_explain(
                            {
                                explanation: e,
                                query: (Array.isArray(originalQuery) && originalQuery.length > index)
                                    ? mongoQueryAndOptionsStringify({
                                        query: originalQuery[`${index}`],
                                        options: originalOptions || {}
                                    })
                                    : mongoQueryAndOptionsStringify({
                                        query: originalQuery,
                                        options: originalOptions || {}
                                    })
                            }
                        )
                    ) : [];
                tag.push({
                    system: 'https://www.icanbwell.com/queryExplainSimple',
                    display: JSON.stringify(simpleExplanations, getCircularReplacer())
                });
            }
            if (cursorBatchSize && cursorBatchSize > 0) {
                tag.push({
                    system: 'https://www.icanbwell.com/queryCursorBatchSize',
                    display: `${cursorBatchSize}`
                });
            }
            bundle.meta = {
                tag
            };
            logDebug('', { user, args: bundle });
        }
        return bundle;
    }

    /**
     * @param {string} collectionName
     * @param {string[]|undefined} [allCollectionsToSearch]
     * @return {string|undefined}
     */
    getQueryCollection (allCollectionsToSearch, collectionName) {
        return allCollectionsToSearch ? allCollectionsToSearch.join(',') : collectionName;
    }

    /**
     * @param {import('mongodb').FindOneOptions | import('mongodb').FindOneOptions[]} originalOptions
     * @return {string|undefined}
     */
    getQueryOptions (originalOptions) {
        return originalOptions ? mongoQueryStringify(originalOptions) : null;
    }

    /**
     * @param {Set|undefined} columns
     * @return {string|undefined}
     */
    getQueryFields (columns) {
        return columns ? mongoQueryStringify(Array.from(columns)) : null;
    }

    /**
     * Removes duplicate bundle entries
     * @param {BundleEntry[]} entries
     * @return {BundleEntry[]}
     */
    removeDuplicateEntries ({ entries }) {
        if (entries.length === 0) {
            return entries;
        }
        return removeDuplicatesWithLambda(entries,
            (a, b) => a.resource.resourceType === b.resource.resourceType && a.resource._uuid === b.resource._uuid
        );
    }
}

module.exports = {
    BundleManager
};
