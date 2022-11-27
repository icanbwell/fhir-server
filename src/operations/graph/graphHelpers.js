/**
 * This file contains functions to retrieve a graph of data from the database
 */
const async = require('async');
const {getResource} = require('../common/getResource');
const {R4SearchQueryCreator} = require('../query/r4');
const env = require('var');
const {getFieldNameForSearchParameter} = require('../../searchParameters/searchParameterHelpers');
const {escapeRegExp} = require('../../utils/regexEscaper');
const {assertTypeEquals} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {SecurityTagManager} = require('../common/securityTagManager');
const {ResourceEntityAndContained} = require('./resourceEntityAndContained');
const {NonResourceEntityAndContained} = require('./nonResourceEntityAndContained');
const {ScopesManager} = require('../security/scopesManager');
const {ScopesValidator} = require('../security/scopesValidator');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const {ConfigManager} = require('../../utils/configManager');
const {BundleManager} = require('../common/bundleManager');
const {ResourceLocatorFactory} = require('../common/resourceLocatorFactory');
const {RethrownError} = require('../../utils/rethrownError');
const {SearchManager} = require('../search/searchManager');
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');


/**
 * @typedef QueryItem
 * @property {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
 * @property {string} resourceType
 * @property {string} [property]
 * @property {string} [reverse_filter]
 * @property {import('mongodb').Document[]} [explanations]
 */


/**
 * This class helps with creating graph responses
 */
class GraphHelper {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {SecurityTagManager} securityTagManager
     * @param {ScopesManager} scopesManager
     * @param {ScopesValidator} scopesValidator
     * @param {ConfigManager} configManager
     * @param {BundleManager} bundleManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {R4SearchQueryCreator} r4SearchQueryCreator
     * @param {SearchManager} searchManager
     */
    constructor({
                    databaseQueryFactory,
                    securityTagManager,
                    scopesManager,
                    scopesValidator,
                    configManager,
                    bundleManager,
                    resourceLocatorFactory,
                    r4SearchQueryCreator,
                    searchManager
                }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {SecurityTagManager}
         */
        this.securityTagManager = securityTagManager;
        assertTypeEquals(securityTagManager, SecurityTagManager);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {BundleManager}
         */
        this.bundleManager = bundleManager;
        assertTypeEquals(bundleManager, BundleManager);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {R4SearchQueryCreator}
         */
        this.r4SearchQueryCreator = r4SearchQueryCreator;
        assertTypeEquals(r4SearchQueryCreator, R4SearchQueryCreator);
        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);
    }

    /**
     * returns property values
     * @param {EntityAndContainedBase} entity
     * @param {string} property Property to read
     * @param {string?} filterProperty Filter property (optional)
     * @param {string?} filterValue Filter value (optional)
     * @returns {Object[]}
     */
    getPropertiesForEntity({entity, property, filterProperty, filterValue}) {
        const item = (entity instanceof ResourceEntityAndContained) ? entity.resource : entity.item;
        if (property.includes('.')) { // this is a nested property so recurse down and find the value
            /**
             * @type {string[]}
             */
            const propertyComponents = property.split('.');
            /**
             * @type {Object[]}
             */
            let currentElements = [item];
            for (const propertyComponent of propertyComponents) {
                // find nested elements where the property is present and select the property
                currentElements = currentElements.filter(c => c[`${propertyComponent}`]).flatMap(c => c[`${propertyComponent}`]);
                if (currentElements.length === 0) {
                    return [];
                }
            }
            // if there is a filter then check that the last element has that value
            if (filterProperty) {
                currentElements = currentElements.filter(c => c[`${filterProperty}`] && c[`${filterProperty}`] === filterValue);
            }
            return currentElements;
        } else {
            return [item[`${property}`]];
        }
    }

    /**
     * retrieves references from the provided property.
     * Always returns an array of references whether the property value is an array or just an object
     * @param {Object || Object[]} propertyValue
     * @return {string[]}
     */
    getReferencesFromPropertyValue({propertyValue}) {
        return Array.isArray(propertyValue) ? propertyValue.map(a => a['reference']) : [propertyValue['reference']];
    }

    /**
     * returns whether this property is a reference (by checking if it has a reference sub property)
     * @param {EntityAndContainedBase[]} entities
     * @param {string} property
     * @param {string?} filterProperty
     * @param {string?} filterValue
     * @returns {boolean}
     */
    isPropertyAReference({entities, property, filterProperty, filterValue}) {
        /**
         * @type {EntityAndContainedBase}
         */
        for (const entity of entities) {
            /**
             * @type {*[]}
             */
            const propertiesForEntity = this.getPropertiesForEntity({
                entity, property, filterProperty, filterValue
            });
            const references = propertiesForEntity
                .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r}))
                .filter(r => r !== undefined && r !== null);

            if (references && references.length > 0) { // if it has a 'reference' property then it is a reference
                return true; // we assume that if one entity has it then all entities can since they are of same type
            }
        }
        return false;
    }

    /**
     * Gets related resources and adds them to containedEntries in parentEntities
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} resourceType
     * @param {EntityAndContainedBase[]} parentEntities
     * @param {string} property
     * @param {string | null} filterProperty (Optional) filter the sublist by this property
     * @param {*|null} filterValue (Optional) match filterProperty to this value
     * @param {boolean} [explain]
     * @param {boolean} [debug]
     * @returns {QueryItem}
     */
    async getForwardReferencesAsync({
                                        requestInfo,
                                        base_version,
                                        resourceType,
                                        parentEntities,
                                        property,
                                        filterProperty,
                                        filterValue,
                                        explain,
                                        debug
                                    }) {
        try {
            // throw new Error('I am here');
            // Promise.reject(new Error('woops'));
            if (!parentEntities || parentEntities.length === 0) {
                return; // nothing to do
            }

            // get values of this property from all the entities
            const relatedReferences = parentEntities.flatMap(p => this.getPropertiesForEntity({entity: p, property})
                .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r}))
                .filter(r => r !== undefined && r !== null));
            // select just the ids from those reference properties
            // noinspection JSCheckFunctionSignatures
            let relatedReferenceIds = relatedReferences
                .filter(r => r.includes('/'))
                .filter(r => r.split('/')[0] === resourceType) // resourceType matches the one we're looking for
                .map(r => r.split('/')[1]);
            if (relatedReferenceIds.length === 0) {
                return; // nothing to do
            }
            // remove duplicates to speed up data access
            relatedReferenceIds = Array.from(new Set(relatedReferenceIds));
            const options = {};
            const projection = {};
            // also exclude _id so if there is a covering index the query can be satisfied from the covering index
            projection['_id'] = 0;
            options['projection'] = projection;
            /**
             * @type {boolean}
             */
            const useAccessIndex = this.configManager.useAccessIndex;

            let {
                /** @type {import('mongodb').Document}**/
                query, // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync({
                user: requestInfo.user,
                scope: requestInfo.scope,
                isUser: requestInfo.isUser,
                patientIdsFromJwtToken: requestInfo.patientIdsFromJwtToken,
                args: Object.assign({'base_version': base_version}, {'id': relatedReferenceIds}), // add id filter to query
                resourceType,
                useAccessIndex,
                personIdFromJwtToken: requestInfo.personIdFromJwtToken
            });

            if (filterProperty) {
                query[`${filterProperty}`] = filterValue;
            }
            /**
             * @type {number}
             */
            const maxMongoTimeMS = env.MONGO_TIMEOUT ? parseInt(env.MONGO_TIMEOUT) : (30 * 1000);
            const databaseQueryManager = this.databaseQueryFactory.createQuery({resourceType, base_version});
            /**
             * mongo db cursor
             * @type {DatabasePartitionedCursor}
             */
            let cursor = await databaseQueryManager.findAsync({query, options});

            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (explain || debug) ? await cursor.explainAsync() : [];
            if (explain) {
                // if explain is requested then don't return any results
                cursor = cursor.limit(1);
            }

            cursor = cursor.maxTimeMS({milliSecs: maxMongoTimeMS});

            while (await cursor.hasNext()) {
                /**
                 * @type {Resource|null}
                 */
                const relatedResource = await cursor.next();

                if (relatedResource) {
                    // create a class to hold information about this resource
                    const relatedEntityAndContained = new ResourceEntityAndContained({
                        entityId: relatedResource.id,
                        entityResourceType: relatedResource.resourceType,
                        includeInOutput: true,
                        resource: relatedResource,
                        containedEntries: []
                    });

                    // find matching parent and add to containedEntries
                    const matchingParentEntities = parentEntities.filter(p => (this.getPropertiesForEntity({
                        entity: p,
                        property
                    })
                        .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r}))
                        .filter(r => r !== undefined && r !== null)
                        .includes(`${relatedResource.resourceType}/${relatedResource.id}`)));

                    if (matchingParentEntities.length === 0) {
                        throw new Error(`Forward Reference: No match found for child entity ${relatedResource.resourceType}/${relatedResource.id}` + ' in parent entities' + ` ${parentEntities.map(p => `${p.resource.resourceType}/${p.resource.id}`).toString()}` + ` using property ${property}`);
                    }

                    // add it to each one since there can be multiple resources that point to the same related resource
                    for (const matchingParentEntity of matchingParentEntities) {
                        matchingParentEntity.containedEntries = matchingParentEntity.containedEntries.concat(relatedEntityAndContained);
                    }
                }
            }
            return {query, resourceType, property, explanations};
        } catch (e) {
            throw new RethrownError({
                message: `Error in getForwardReferencesAsync(): ${resourceType}, ` + `parents:${parentEntities.map(p => p.entityId)}, property=${property}`,
                error: e
            });
        }
    }

    /**
     * converts a query string into an args array
     * @type {import('mongodb').Document}
     */
    parseQueryStringIntoArgs(queryString) {
        return Object.fromEntries(new URLSearchParams(queryString));
    }

    /**
     * Gets related resources using reverse link and add them to containedEntries in parentEntities
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} parentResourceType
     * @param {string} relatedResourceType
     * @param {EntityAndContainedBase[]}  parentEntities parent entities
     * @param {string | null} filterProperty (Optional) filter the sublist by this property
     * @param {*} filterValue (Optional) match filterProperty to this value
     * @param {string} reverse_filter Do a reverse link from child to parent using this property
     * @param {boolean} [explain]
     * @param {boolean} [debug]
     * @returns {QueryItem}
     */
    async getReverseReferencesAsync({
                                        requestInfo,
                                        base_version,
                                        parentResourceType,
                                        relatedResourceType,
                                        parentEntities,
                                        filterProperty,
                                        filterValue,
                                        reverse_filter,
                                        explain,
                                        debug
                                    }) {
        try {
            if (!(reverse_filter)) {
                throw new Error('reverse_filter must be set');
            }
            // create comma separated list of ids
            const parentResourceTypeAndIdList = parentEntities
                .filter(p => p.entityId !== undefined && p.entityId !== null)
                .map(p => `${p.resource.resourceType}/${p.entityId}`);
            if (parentResourceTypeAndIdList.length === 0) {
                return;
            }
            /**
             * @type {string}
             */
            const reverseFilterWithParentIds = reverse_filter.replace('{ref}', parentResourceTypeAndIdList.join(','));
            /**
             * @type {Object}
             */
            const args = this.parseQueryStringIntoArgs(reverseFilterWithParentIds);
            args['base_version'] = base_version;
            const searchParameterName = Object.keys(args)[0];
            /**
             * @type {boolean}
             */
            const useAccessIndex = this.configManager.useAccessIndex;

            /**
             * @type {{base_version, columns: Set, query: import('mongodb').Document}}
             */
            let {
                /** @type {import('mongodb').Document}**/
                query, // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync({
                user: requestInfo.user,
                scope: requestInfo.scope,
                isUser: requestInfo.isUser,
                patientIdsFromJwtToken: requestInfo.patientIdsFromJwtToken,
                args,
                resourceType: relatedResourceType,
                useAccessIndex,
                personIdFromJwtToken: requestInfo.personIdFromJwtToken
            });

            const options = {};
            const projection = {};
            // also exclude _id so if there is a covering index the query can be satisfied from the covering index
            projection['_id'] = 0;
            options['projection'] = projection;

            /**
             * @type {number}
             */
            const maxMongoTimeMS = env.MONGO_TIMEOUT ? parseInt(env.MONGO_TIMEOUT) : (30 * 1000);
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: relatedResourceType,
                base_version
            });
            /**
             * mongo db cursor
             * @type {DatabasePartitionedCursor}
             */
            let cursor = await databaseQueryManager.findAsync({query, options});
            cursor = cursor.maxTimeMS({milliSecs: maxMongoTimeMS});

            // find matching field name in searchParameter list.  We will use this to match up to parent
            /**
             * @type {string}
             */
            const fieldForSearchParameter = getFieldNameForSearchParameter(relatedResourceType, searchParameterName);

            if (!fieldForSearchParameter) {
                throw new Error(`${searchParameterName} is not a valid search parameter for resource ${relatedResourceType}`);
            }

            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (explain || debug) ? await cursor.explainAsync() : [];
            if (explain) {
                // if explain is requested then don't return any results
                cursor = cursor.limit(1);
            }

            while (await cursor.hasNext()) {
                /**
                 * @type {Resource|null}
                 */
                const relatedResourcePropertyCurrent = await cursor.next();
                if (relatedResourcePropertyCurrent) {
                    if (filterProperty !== null) {
                        if (relatedResourcePropertyCurrent[`${filterProperty}`] !== filterValue) {
                            continue;
                        }
                    }
                    // create the entry
                    const resourceEntityAndContained = new ResourceEntityAndContained({
                        entityId: relatedResourcePropertyCurrent.id,
                        entityResourceType: relatedResourcePropertyCurrent.resourceType,
                        includeInOutput: true,
                        resource: relatedResourcePropertyCurrent,
                        containedEntries: []
                    });
                    // now match to parent entity, so we can put under correct contained property
                    const properties = this.getPropertiesForEntity({
                        entity: resourceEntityAndContained, property: fieldForSearchParameter
                    });
                    // the reference property can be a single item or an array.
                    /**
                     * @type {string[]}
                     */
                    const references = properties
                        .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r}))
                        .filter(r => r !== undefined);
                    const matchingParentEntities = parentEntities.filter(p => references.includes(`${p.resource.resourceType}/${p.resource.id}`));

                    if (matchingParentEntities.length === 0) {
                        throw new Error('Reverse Reference: No match found for parent entities' + ` ${parentEntities.map(p => `${p.resource.resourceType}/${p.resource.id}`).toString()}` + ` using property ${fieldForSearchParameter}` + ` in child entity ${relatedResourcePropertyCurrent.resourceType}/${relatedResourcePropertyCurrent.id}`);
                    }

                    for (const matchingParentEntity of matchingParentEntities) {
                        matchingParentEntity.containedEntries.push(resourceEntityAndContained);
                    }
                }
            }
            return {query, resourceType: relatedResourceType, reverse_filter, explanations};
        } catch (e) {
            throw new RethrownError({
                message: 'Error in getReverseReferencesAsync(): ' + `parentResourceType: ${parentResourceType} relatedResourceType:${relatedResourceType}, ` + `parents:${parentEntities.map(p => p.entityId)}, ` + `filterProperty=${filterProperty}, filterValue=${filterValue}, ` + `reverseFilter=${reverse_filter}`,
                error: e
            });
        }
    }

    /**
     * returns whether the resource has the passed in property (handles nested properties)
     * @param {EntityAndContainedBase} entity
     * @param {string} property
     * @param {string} filterProperty
     * @param {string} filterValue
     * @returns {boolean}
     */
    doesEntityHaveProperty({entity, property, filterProperty, filterValue}) {
        const item = (entity instanceof ResourceEntityAndContained) ? entity.resource : entity.item;
        if (property.includes('.')) {
            /**
             * @type {string[]}
             */
            const propertyComponents = property.split('.');
            /**
             * @type {*[]}
             */
            let currentElements = [item];
            /**
             * @type {string}
             */
            for (const propertyComponent of propertyComponents) {
                // find nested elements where the property is present and select the property
                currentElements = currentElements.filter(c => c[`${propertyComponent}`]).flatMap(c => c[`${propertyComponent}`]);
                if (currentElements.length === 0) {
                    return false;
                }
            }
            // if there is a filter then check that the last element has that value
            if (filterProperty) {
                currentElements = currentElements.filter(c => c[`${filterProperty}`] && c[`${filterProperty}`] === filterValue);
                return (currentElements.length > 0);
            } else { // if not filter then just return true if we find the field
                return true;
            }
        } else {
            return item[`${property}`];
        }
    }

    /**
     * Parses the filter out of the property name
     * @param {string} property
     * @returns {{filterValue: string, filterProperty: string, property: string}}
     */
    getFilterFromPropertyPath(property) {
        /**
         * @type {string}
         */
        let filterProperty;
        /**
         * @type {string}
         */
        let filterValue;
        // if path is more complex and includes filter
        if (property.includes(':')) {
            /**
             * @type {string[]}
             */
            const property_split = property.split(':');
            if (property_split && property_split.length > 0) {
                /**
                 * @type {string}
                 */
                property = property_split[0];
                /**
                 * @type {string[]}
                 */
                const filterPropertySplit = property_split[1].split('=');
                if (filterPropertySplit.length > 1) {
                    /**
                     * @type {string}
                     */
                    filterProperty = filterPropertySplit[0];
                    /**
                     * @type {string}
                     */
                    filterValue = filterPropertySplit[1];
                }
            }
        }
        return {filterProperty, filterValue, property};
    }

    /**
     * process a link
     * @param requestInfo
     * @param base_version
     * @param parentResourceType
     * @param link
     * @param parentEntities
     * @param explain
     * @param debug
     * @param target
     * @return {Promise<{queryItems: QueryItem[], childEntries: EntityAndContainedBase[]}>}
     */
    async processLinkTargetAsync({
                                     requestInfo,
                                     base_version,
                                     parentResourceType,
                                     link,
                                     parentEntities,
                                     explain,
                                     debug,
                                     target
                                 }) {
        /**
         * @type {QueryItem[]}
         */
        const queryItems = [];
        /**
         * @type {EntityAndContainedBase[]}
         */
        let childEntries = [];
        /**
         * If this is not set then the caller does not want this entity but a nested entity
         * defined further in the GraphDefinition
         * @type {string | null}
         */
        const resourceType = target.type;
        // there are two types of linkages:
        // 1. forward linkage: a property in the current object is a reference to the target object (uses "path")
        // 2. reverse linkage: a property in the target object is a reference to the current object (uses "params")
        if (link.path) { // forward link
            /**
             * @type {string}
             */
            const originalProperty = link.path.replace('[x]', '');
            const {filterProperty, filterValue, property} = this.getFilterFromPropertyPath(originalProperty);
            // find parent entities that have a valid property
            parentEntities = parentEntities.filter(p => this.doesEntityHaveProperty({
                entity: p, property, filterProperty, filterValue
            }));
            // if this is a reference then get related resources
            if (this.isPropertyAReference({
                entities: parentEntities, property, filterProperty, filterValue
            })) {
                await this.scopesValidator.verifyHasValidScopesAsync({
                    requestInfo, args: {}, resourceType, startTime: Date.now(), action: 'graph', accessRequested: 'read'
                });

                const queryItem = await this.getForwardReferencesAsync({
                    requestInfo,
                    base_version,
                    resourceType,
                    parentEntities,
                    property,
                    filterProperty,
                    filterValue,
                    explain,
                    debug
                });
                if (queryItem) {
                    queryItems.push(queryItem);
                }
                childEntries = parentEntities.flatMap(p => p.containedEntries);
            } else { // handle paths that are not references
                childEntries = [];
                for (const parentEntity of parentEntities) {
                    // create child entries
                    /**
                     * @type {Object[]}
                     */
                    const children = this.getPropertiesForEntity({
                        entity: parentEntity, property, filterProperty, filterValue
                    });
                    /**
                     * @type {NonResourceEntityAndContained[]}
                     */
                    const childEntriesForCurrentEntity = children.map(c => new NonResourceEntityAndContained({
                        includeInOutput: target.type !== undefined, // if caller has requested this entity or just wants a nested entity
                        item: c, containedEntries: []
                    }));
                    childEntries = childEntries.concat(childEntriesForCurrentEntity);
                    parentEntity.containedEntries = parentEntity.containedEntries.concat(childEntriesForCurrentEntity);
                }
            }
        } else if (target.params) { // reverse link
            if (target.type) { // if caller has requested this entity or just wants a nested entity
                // reverse link
                await this.scopesValidator.verifyHasValidScopesAsync({
                    requestInfo, args: {}, resourceType, startTime: Date.now(), action: 'graph', accessRequested: 'read'
                });
                if (!parentResourceType) {
                    throw new Error('processOneGraphLinkAsync: No parent resource found for reverse references for parent entities:' + ` ${parentEntities.map(p => `${p.resource.resourceType}/${p.resource.id}`).toString()}` + ` using target.params: ${target.params}`);
                }
                const queryItem = await this.getReverseReferencesAsync({
                    requestInfo,
                    base_version,
                    parentResourceType,
                    relatedResourceType: resourceType,
                    parentEntities,
                    filterProperty: null,
                    filterValue: null,
                    reverse_filter: target.params,
                    explain,
                    debug
                });
                if (queryItem) {
                    queryItems.push(queryItem);
                }
                childEntries = parentEntities.flatMap(p => p.containedEntries);
            }
        }

        // filter childEntries to find entries of same type as parentResource
        childEntries = childEntries.filter(c => (!target.type && !c.resource) || // either there is no target type so choose non-resources
            (target.type && c.resource && c.resource.resourceType === target.type) // or there is a target type so match to it
        );
        if (childEntries && childEntries.length > 0) {
            /**
             * @type {string|null}
             */
            const childResourceType = target.type;

            // Now recurse down and process the link
            /**
             * @type {[{path:string, params: string,target:[{type: string}]}]}
             */
            const childLinks = target.link;
            if (childLinks) {
                /**
                 * @type {{path:string, params: string,target:[{type: string}]}}
                 */
                for (const childLink of childLinks) {
                    // now recurse and process the next link in GraphDefinition
                    /**
                     * @type {QueryItem[]}
                     */
                    const recursiveQueries = await this.processOneGraphLinkAsync({
                        requestInfo,
                        base_version,
                        parentResourceType: childResourceType,
                        link: childLink,
                        parentEntities: childEntries,
                        explain,
                        debug
                    });
                    for (const recursiveQuery of recursiveQueries) {
                        queryItems.push(recursiveQuery);
                    }
                }
            }
        }
        return {queryItems, childEntries};
    }

    /**
     * processes a single graph link
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string | null} parentResourceType
     * @param {{path: string, params: string, target: {type: string}[]}} link
     * @param {EntityAndContainedBase[]} parentEntities
     * @param {boolean} [explain]
     * @param {boolean} [debug]
     * @returns {QueryItem[]}
     */
    async processOneGraphLinkAsync({
                                       requestInfo,
                                       base_version,
                                       parentResourceType,
                                       link,
                                       parentEntities,
                                       explain,
                                       debug
                                   }) {
        try {
            /**
             * @type {{type: string}[]}
             */
            let link_targets = link.target;
            /**
             * @type {{queryItems: QueryItem[], childEntries: EntityAndContainedBase[]}[]}
             */
            const result = await async.map(link_targets, async (target) => await this.processLinkTargetAsync({
                requestInfo, base_version, parentResourceType, link, parentEntities, explain, debug, target
            }));
            /**
             * @type {QueryItem[]}
             */
            const queryItems = result.flatMap(r => r.queryItems);
            return queryItems;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in processOneGraphLinkAsync(): ' + `parentResourceType: ${parentResourceType} , ` + `parents:${parentEntities.map(p => p.entityId)}, `,
                error: e
            });
        }
    }

    /**
     * processes a list of graph links
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} parentResourceType
     * @param {[Resource]} parentEntities
     * @param {[{path:string, params: string,target:[{type: string}]}]} linkItems
     * @param {boolean} [explain]
     * @param {boolean} [debug]
     * @return {Promise<{entities: ResourceEntityAndContained[], queryItems: QueryItem[]}>}
     */
    async processGraphLinksAsync({
                                     requestInfo,
                                     base_version,
                                     parentResourceType,
                                     parentEntities,
                                     linkItems,
                                     explain,
                                     debug
                                 }) {
        try {
            /**
             * @type {ResourceEntityAndContained[]}
             */
            const resultEntities = parentEntities.map(parentEntity => new ResourceEntityAndContained({
                entityId: parentEntity.id,
                entityResourceType: parentEntity.resourceType,
                includeInOutput: true,
                resource: parentEntity,
                containedEntries: []
            }));
            /**
             * @type {QueryItem[]}
             */
            const queryItems = await async.flatMap(linkItems, async (link) => await this.processOneGraphLinkAsync({
                requestInfo, base_version, parentResourceType, link, parentEntities: resultEntities, explain, debug
            }));
            return {entities: resultEntities, queryItems};
        } catch (e) {
            throw new RethrownError({
                message: 'Error in processGraphLinksAsync(): ' + `parentResourceType: ${parentResourceType} , ` + `parents:${parentEntities.map(p => p.entityId)}, `,
                error: e
            });
        }
    }

    /**
     * prepends # character in references
     * @param {Resource} parent_entity
     * @param {[reference:string]} linkReferences
     * @return {Promise<Resource>}
     */
    async convertToHashedReferencesAsync({parent_entity, linkReferences}) {
        /**
         * @type {Set<string>}
         */
        const uniqueReferences = new Set(linkReferences);
        if (parent_entity) {
            /**
             * @type {string}
             */
            for (const link_reference of uniqueReferences) {
                // eslint-disable-next-line security/detect-non-literal-regexp
                let re = new RegExp('\\b' + escapeRegExp(link_reference) + '\\b', 'g');
                parent_entity = JSON.parse(JSON.stringify(parent_entity).replace(re, '#'.concat(link_reference)));
            }
        }
        return parent_entity;
    }

    /**
     * get all the contained entities recursively
     * @param {EntityAndContainedBase} entityAndContained
     * @returns {BundleEntry[]}
     */
    getRecursiveContainedEntities(entityAndContained) {
        /**
         * @type {BundleEntry[]}
         */
        let result = [];
        if (entityAndContained.includeInOutput) { // only include entities the caller has requested
            result = result.concat([new BundleEntry({
                fullUrl: entityAndContained.fullUrl, resource: entityAndContained.resource
            })]);
        }

        // now recurse
        result = result.concat(entityAndContained.containedEntries.flatMap(c => this.getRecursiveContainedEntities(c)));
        return result;
    }


    /**
     * removes duplicate items from array
     * @param {*[]} array
     * @param fnCompare
     * @returns {*[]}
     */
    removeDuplicatesWithLambda(array, fnCompare) {
        return array.filter((value, index, self) => index === self.findIndex((t) => (fnCompare(t, value))));
    }

    /**
     * processing multiple ids
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {Resource} graphDefinition
     * @param {boolean} contained
     * @param {boolean} hash_references
     * @param {string[]} idList
     * @param {boolean} [explain]
     * @param {boolean} [debug]
     * @return {Promise<{entries: BundleEntry[], queries: import('mongodb').Document[], options: import('mongodb').FindOptions<import('mongodb').DefaultSchema>[], explanations: import('mongodb').Document[]}>}
     */
    async processMultipleIdsAsync({
                                      base_version,
                                      requestInfo,
                                      resourceType,
                                      graphDefinition,
                                      contained,
                                      hash_references,
                                      idList,
                                      explain,
                                      debug
                                  }) {
        try {
            /**
             * @type {BundleEntry[]}
             */
            let entries = [];

            let {
                /** @type {import('mongodb').Document}**/
                query, // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync({
                user: requestInfo.user,
                scope: requestInfo.scope,
                isUser: requestInfo.isUser,
                patientIdsFromJwtToken: requestInfo.patientIdsFromJwtToken,
                args: Object.assign({'base_version': base_version}, {'id': idList}), // add id filter to query
                resourceType,
                useAccessIndex: this.configManager.useAccessIndex,
                personIdFromJwtToken: requestInfo.personIdFromJwtToken,
            });

            /**
             * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>}
             */
            const options = {};
            const projection = {};
            // also exclude _id so if there is a covering index the query can be satisfied from the covering index
            projection['_id'] = 0;
            options['projection'] = projection;

            /**
             * @type {number}
             */
            const maxMongoTimeMS = env.MONGO_TIMEOUT ? parseInt(env.MONGO_TIMEOUT) : (30 * 1000);

            /**
             * @type {import('mongodb').Document[]}
             */
            const queries = [];
            /**
             * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]}
             */
            const optionsForQueries = [];

            const databaseQueryManager = this.databaseQueryFactory.createQuery({resourceType, base_version});
            /**
             * mongo db cursor
             * @type {DatabasePartitionedCursor}
             */
            let cursor = await databaseQueryManager.findAsync({query, options});
            cursor = cursor.maxTimeMS({milliSecs: maxMongoTimeMS});

            queries.push(query);
            optionsForQueries.push(options);
            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = explain || debug ? await cursor.explainAsync() : [];
            if (explain) {
                // if explain is requested then just return one result
                cursor = cursor.limit(1);
            }

            /**
             * @type {BundleEntry[]}
             */
            const topLevelBundleEntries = [];

            while (await cursor.hasNext()) {
                /**
                 * element
                 * @type {Resource|null}
                 */
                const startResource = await cursor.next();
                if (startResource) {
                    /**
                     * @type {BundleEntry}
                     */
                    let current_entity = new BundleEntry({
                        resource: startResource
                    });
                    entries = entries.concat([current_entity]);
                    topLevelBundleEntries.push(current_entity);
                }
            }

            /**
             * @type {[{path:string, params: string,target:[{type: string}]}]}
             */
            const linkItems = graphDefinition.link;
            /**
             * @type {{entities: ResourceEntityAndContained[], queryItems: QueryItem[]}}
             */
            const {entities: allRelatedEntries, queryItems} = await this.processGraphLinksAsync({
                requestInfo,
                base_version,
                parentResourceType: resourceType,
                parentEntities: topLevelBundleEntries.map(e => e.resource),
                linkItems,
                explain,
                debug
            });

            for (const q of queryItems) {
                if (q.query) {
                    queries.push(q.query);
                }
                if (q.explanations) {
                    for (const e of q.explanations) {
                        explanations.push(e);
                    }
                }
            }
            // add contained objects under the parent resource
            for (const topLevelBundleEntry of topLevelBundleEntries) {
                // add related resources as container
                /**
                 * @type {ResourceEntityAndContained}
                 */
                const matchingEntity = allRelatedEntries.find(e => e.entityId === topLevelBundleEntry.resource.id && e.entityResourceType === topLevelBundleEntry.resource.resourceType);
                /**
                 * @type {[EntityAndContainedBase]}
                 */
                const related_entries = matchingEntity.containedEntries;
                if (env.HASH_REFERENCE || hash_references) {
                    /**
                     * @type {[string]}
                     */
                    const related_references = [];
                    for (const /** @type  EntityAndContainedBase */ related_item of related_entries) {
                        /**
                         * @type {string}
                         */
                        const relatedItemElementElement = related_item['resource']['resourceType'];
                        related_references.push(relatedItemElementElement.concat('/', related_item['resource']['id']));
                    }
                    if (related_references.length > 0) {
                        topLevelBundleEntry.resource = await this.convertToHashedReferencesAsync({
                            parent_entity: topLevelBundleEntry.resource, linkReferences: related_references
                        });
                    }
                }
                /**
                 * @type {BundleEntry[]}
                 */
                const relatedEntities = related_entries
                    .flatMap(r => this.getRecursiveContainedEntities(r))
                    .filter(r => r.resource !== undefined && r.resource !== null);
                if (contained) {
                    if (relatedEntities.length > 0) {
                        topLevelBundleEntry['resource']['contained'] = relatedEntities.map(r => r.resource);
                    }
                } else {
                    entries = entries.concat(relatedEntities);
                }
            }

            entries = this.removeDuplicatesWithLambda(entries, (a, b) => a.resource.resourceType === b.resource.resourceType && a.resource.id === b.resource.id);

            return {entries, queries, options: optionsForQueries, explanations};
        } catch (e) {
            throw new RethrownError({
                message: 'Error in processMultipleIdsAsync(): ' + `resourceType: ${resourceType} , ` + `id:${idList.join(',')}, `,
                error: e
            });
        }
    }

    /**
     * process GraphDefinition and returns a bundle with all the related resources
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} resourceType
     * @param {string | string[]} id (accepts a single id or a list of ids)
     * @param {*} graphDefinitionJson (a GraphDefinition resource)
     * @param {boolean} contained
     * @param {boolean} hash_references
     * @param {Object} args
     * @return {Promise<Bundle>}
     */
    async processGraphAsync({
                                requestInfo,
                                base_version,
                                resourceType,
                                id,
                                graphDefinitionJson,
                                contained,
                                hash_references,
                                args
                            }) {
        try {
            /**
             * @type {number}
             */
            const startTime = Date.now();
            /**
             * @type {function(?Object): Resource}
             */
            const GraphDefinitionResource = getResource(base_version, 'GraphDefinition');
            /**
             * @type {Resource}
             */
            const graphDefinition = new GraphDefinitionResource(graphDefinitionJson);

            if (!(Array.isArray(id))) {
                id = [id];
            }

            /**
             * @type {{entries: BundleEntry[], queries: import('mongodb').Document[], explanations: import('mongodb').Document[]}}
             */
            const {entries, queries, options, explanations} = await this.processMultipleIdsAsync({
                base_version,
                requestInfo,
                resourceType,
                graphDefinition,
                contained,
                hash_references,
                idList: id,
                explain: args && args['_explain'] ? true : false,
                debug: args && args['_debug'] ? true : false,
            });

            // remove duplicate resources
            /**
             * @type {BundleEntry[]}
             */
            let uniqueEntries = this.removeDuplicatesWithLambda(entries, (a, b) => a.resource.resourceType === b.resource.resourceType && a.resource.id === b.resource.id);

            /**
             * @type {string[]}
             */
            const accessCodes = this.scopesManager.getAccessCodesFromScopes('read', requestInfo.user, requestInfo.scope);
            uniqueEntries = uniqueEntries.filter(e => this.scopesManager.doesResourceHaveAnyAccessCodeFromThisList(accessCodes, requestInfo.user, requestInfo.scope, e.resource));

            /**
             * @type {string}
             */
            let collectionName;
            if (queries && queries.length > 0) {
                /**
                 * @type {ResourceLocator}
                 */
                const resourceLocator = this.resourceLocatorFactory.createResourceLocator({resourceType, base_version});
                collectionName = await resourceLocator.getFirstCollectionNameForQueryDebugOnlyAsync({
                    query: queries[0]
                });
            }
            /**
             * @type {number}
             */
            const stopTime = Date.now();
            /**
             * @type {Resource[]}
             */
            const resources = uniqueEntries.map(bundleEntry => bundleEntry.resource);
            /**
             * @type {Bundle}
             */
            const bundle = this.bundleManager.createBundle({
                type: 'collection',
                requestId: requestInfo.requestId,
                originalUrl: requestInfo.originalUrl,
                host: requestInfo.host,
                protocol: requestInfo.protocol,
                last_id: null,
                resources,
                base_version,
                total_count: null,
                args: args,
                originalQuery: queries,
                collectionName,
                originalOptions: options,
                columns: new Set(),
                stopTime,
                startTime,
                user: requestInfo.user,
                explanations
            });
            return bundle;
            // create a bundle
            // return new Bundle({
            //     resourceType: 'Bundle',
            //     id: '1',
            //     type: 'collection',
            //     timestamp: moment.utc().format('YYYY-MM-DDThh:mm:ss.sss') + 'Z',
            //     entry: uniqueEntries
            // });
        } catch (e) {
            throw new RethrownError({
                message: 'Error in processGraphAsync(): ' + `resourceType: ${resourceType} , ` + `id:${id}, `, error: e
            });
        }
    }

    /**
     * process GraphDefinition and returns a bundle with all the related resources
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} resourceType
     * @param {string | string[]} id (accepts a single id or a list of ids)
     * @param {*} graphDefinitionJson (a GraphDefinition resource)
     * @param {Object} args
     * @return {Promise<Bundle>}
     */
    async deleteGraphAsync({
                               requestInfo, base_version, resourceType, id, graphDefinitionJson, args
                           }) {
        try {
            /**
             * @type {number}
             */
            const startTime = Date.now();
            /**
             * @type {Bundle}
             */
            const bundle = await this.processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                id,
                contained: false,
                hash_references: false,
                graphDefinitionJson,
                args
            });
            // now iterate and delete by resuourceType and Id
            /**
             * @type {BundleEntry[]}
             */
            const deleteOperationBundleEntries = [];
            for (const entry of bundle.entry) {
                /**
                 * @type {Resource}
                 */
                const resource = entry.resource;
                const resultResourceType = resource.resourceType;
                const idList = [resource.id];
                const databaseQueryManager = this.databaseQueryFactory.createQuery({
                    resourceType: resultResourceType,
                    base_version
                });
                await this.scopesValidator.verifyHasValidScopesAsync({
                    requestInfo, args, resourceType: resultResourceType, action: 'graph', accessRequested: 'write',
                    startTime
                });

                /**
                 * @type {{deletedCount: (number|null), error: (Error|null)}}
                 */
                    // eslint-disable-next-line no-unused-vars
                const result = await databaseQueryManager.deleteManyAsync({
                        query: {id: {$in: idList}}
                    });
                for (const resultResourceId of idList) {
                    const ResourceCreator = getResource(base_version, resultResourceType);
                    deleteOperationBundleEntries.push(new BundleEntry({
                        resource: new ResourceCreator({
                            id: resultResourceId, resourceType: resultResourceType
                        })
                    }));
                }

            }
            const deleteOperationBundle = new Bundle({
                id: requestInfo.requestId,
                type: 'batch-response',
                entry: deleteOperationBundleEntries,
                total: deleteOperationBundleEntries.length
            });
            return deleteOperationBundle;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in deleteGraphAsync(): ' + `resourceType: ${resourceType} , ` + `id:${id}, `, error: e
            });
        }
    }
}

module.exports = {
    GraphHelper
};
