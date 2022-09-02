/**
 * This file contains functions to retrieve a graph of data from the database
 */
const {getResource} = require('../common/getResource');
const {buildR4SearchQuery} = require('../query/r4');
const env = require('var');
const moment = require('moment-timezone');
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
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');

/**
 * This class helps with creating graph responses
 */
class GraphHelper {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {SecurityTagManager} securityTagManager
     * @param {ScopesManager} scopesManager
     * @param {ScopesValidator} scopesValidator
     */
    constructor(
        {
            databaseQueryFactory,
            securityTagManager,
            scopesManager,
            scopesValidator
        }
    ) {
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

    }

    /**
     * generates a full url for an entity
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {Resource} parentEntity
     * @return {string}
     */
    getFullUrlForResource({requestInfo, base_version, parentEntity}) {
        return `${requestInfo.protocol}://${requestInfo.host}/${base_version}/${parentEntity.resourceType}/${parentEntity.id}`;
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
            const propertiesForEntity = this.getPropertiesForEntity(
                {
                    entity, property, filterProperty, filterValue
                });
            const references = propertiesForEntity
                .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r}))
                .filter(r => r !== undefined);

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
     */
    async getForwardReferencesAsync(
        {
            requestInfo,
            base_version,
            resourceType,
            parentEntities, property,
            filterProperty,
            filterValue
        }) {
        if (!parentEntities || parentEntities.length === 0) {
            return; // nothing to do
        }

        // get values of this property from all the entities
        const relatedReferences = parentEntities.flatMap(p =>
            this.getPropertiesForEntity({entity: p, property})
                .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r}))
                .filter(r => r !== undefined)
        );
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
         * @type {string[]}
         */
        let securityTags = this.securityTagManager.getSecurityTagsFromScope({
            user: requestInfo.user,
            scope: requestInfo.scope
        });
        /**
         * @type {Object}
         */
        let query = {
            'id': {
                $in: relatedReferenceIds
            }
        };
        if (filterProperty) {
            query[`${filterProperty}`] = filterValue;
        }
        query = this.securityTagManager.getQueryWithSecurityTags(
            {
                resourceType, securityTags, query
            });
        /**
         * @type {number}
         */
        const maxMongoTimeMS = env.MONGO_TIMEOUT ? parseInt(env.MONGO_TIMEOUT) : (30 * 1000);
        /**
         * mongo db cursor
         * @type {DatabasePartitionedCursor}
         */
        let cursor = await this.databaseQueryFactory.createQuery(
            {resourceType, base_version, useAtlas: requestInfo.useAtlas}
        ).findAsync({query, options});

        cursor = cursor.maxTimeMS({milliSecs: maxMongoTimeMS});

        while (await cursor.hasNext()) {
            /**
             * @type {Resource|null}
             */
            const relatedResource = await cursor.next();

            if (relatedResource) {
                // create a class to hold information about this resource
                const relatedEntityAndContained = new ResourceEntityAndContained(
                    {
                        entityId: relatedResource.id,
                        entityResourceType: relatedResource.resourceType,
                        fullUrl: this.getFullUrlForResource(
                            {
                                requestInfo, base_version, parentEntity: relatedResource
                            }),
                        includeInOutput: true,
                        resource: relatedResource,
                        containedEntries: []
                    }
                );

                // find matching parent and add to containedEntries
                const matchingParentEntities = parentEntities.filter(
                    p => (
                        this.getPropertiesForEntity({entity: p, property})
                            .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r}))
                            .filter(r => r !== undefined)
                            .includes(`${relatedResource.resourceType}/${relatedResource.id}`)
                    )
                );

                if (matchingParentEntities.length === 0) {
                    throw new Error(
                        `Forward Reference: No match found for child entity ${relatedResource.resourceType}/${relatedResource.id}` +
                        ' in parent entities' +
                        ` ${parentEntities.map(p => `${p.resource.resourceType}/${p.resource.id}`).toString()}` +
                        ` using property ${property}`
                    );
                }

                // add it to each one since there can be multiple resources that point to the same related resource
                for (const matchingParentEntity of matchingParentEntities) {
                    matchingParentEntity.containedEntries = matchingParentEntity.containedEntries.concat(
                        relatedEntityAndContained
                    );
                }
            }
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
     */
    async getReverseReferencesAsync(
        {
            requestInfo,
            base_version,
            parentResourceType,
            relatedResourceType, parentEntities,
            filterProperty, filterValue, reverse_filter
        }
    ) {
        if (!(reverse_filter)) {
            throw new Error('reverse_filter must be set');
        }
        // create comma separated list of ids
        const parentIdList = parentEntities.map(p => p.entityId).filter(p => p !== undefined);
        if (parentIdList.length === 0) {
            return;
        }
        const reverseFilterWithParentIds = reverse_filter.replace(
            '{ref}',
            `${parentResourceType}/${parentIdList.toString()}`
        );
        /**
         * @type {Object}
         */
        const args = this.parseQueryStringIntoArgs(reverseFilterWithParentIds);
        const searchParameterName = Object.keys(args)[0];
        let query = buildR4SearchQuery(relatedResourceType, args).query;

        /**
         * @type {string[]}
         */
        let securityTags = this.securityTagManager.getSecurityTagsFromScope({
            user: requestInfo.user,
            scope: requestInfo.scope
        });
        query = this.securityTagManager.getQueryWithSecurityTags(
            {
                resourceType: relatedResourceType, securityTags, query
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
        /**
         * mongo db cursor
         * @type {DatabasePartitionedCursor}
         */
        let cursor = await this.databaseQueryFactory.createQuery(
            {resourceType: relatedResourceType, base_version, useAtlas: requestInfo.useAtlas}
        ).findAsync({query, options});
        cursor = cursor.maxTimeMS({milliSecs: maxMongoTimeMS});

        // find matching field name in searchParameter list.  We will use this to match up to parent
        /**
         * @type {string}
         */
        const fieldForSearchParameter = getFieldNameForSearchParameter(relatedResourceType, searchParameterName);

        if (!fieldForSearchParameter) {
            throw new Error(`${searchParameterName} is not a valid search parameter for resource ${relatedResourceType}`);
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
                const resourceEntityAndContained = new ResourceEntityAndContained(
                    {
                        entityId: relatedResourcePropertyCurrent.id,
                        entityResourceType: relatedResourcePropertyCurrent.resourceType,
                        fullUrl: this.getFullUrlForResource(
                            {
                                requestInfo, base_version, parentEntity: relatedResourcePropertyCurrent
                            }),
                        includeInOutput: true,
                        resource: relatedResourcePropertyCurrent,
                        containedEntries: []
                    }
                );
                // now match to parent entity, so we can put under correct contained property
                const properties = this.getPropertiesForEntity(
                    {
                        entity: resourceEntityAndContained, property: fieldForSearchParameter
                    }
                );
                // the reference property can be a single item or an array.
                /**
                 * @type {string[]}
                 */
                const references = properties
                    .flatMap(r => this.getReferencesFromPropertyValue({propertyValue: r}))
                    .filter(r => r !== undefined);
                const matchingParentEntities = parentEntities.filter(
                    p => references.includes(`${p.resource.resourceType}/${p.resource.id}`)
                );

                if (matchingParentEntities.length === 0) {
                    throw new Error(
                        'Reverse Reference: No match found for parent entities' +
                        ` ${parentEntities.map(p => `${p.resource.resourceType}/${p.resource.id}`).toString()}` +
                        ` using property ${fieldForSearchParameter}` +
                        ` in child entity ${relatedResourcePropertyCurrent.resourceType}/${relatedResourcePropertyCurrent.id}`
                    );
                }

                for (const matchingParentEntity of matchingParentEntities) {
                    matchingParentEntity.containedEntries.push(
                        resourceEntityAndContained
                    );
                }
            }
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
     * processes a single graph link
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string | null} parentResourceType
     * @param {{path: string, params: string, target: {type: string}[]}} link
     * @param {[EntityAndContainedBase]} parentEntities
     */
    async processOneGraphLinkAsync(
        {
            requestInfo,
            base_version,
            parentResourceType,
            link,
            parentEntities
        }) {

        /**
         * @type {EntityAndContainedBase[]}
         */
        let childEntries = [];
        /**
         * @type {{type: string}[]}
         */
        let link_targets = link.target;
        for (const target of link_targets) {
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
                parentEntities = parentEntities.filter(
                    p => this.doesEntityHaveProperty(
                        {
                            entity: p, property, filterProperty, filterValue
                        })
                );
                // if this is a reference then get related resources
                if (this.isPropertyAReference(
                    {
                        entities: parentEntities, property, filterProperty, filterValue
                    })) {
                    await this.scopesValidator.verifyHasValidScopesAsync({
                        requestInfo,
                        args: {},
                        resourceType,
                        startTime: Date.now(),
                        action: 'graph',
                        accessRequested: 'read'
                    });

                    await this.getForwardReferencesAsync(
                        {
                            requestInfo,
                            base_version,
                            resourceType,
                            parentEntities,
                            property,
                            filterProperty,
                            filterValue
                        }
                    );
                    childEntries = parentEntities.flatMap(p => p.containedEntries);
                } else { // handle paths that are not references
                    childEntries = [];
                    for (const parentEntity of parentEntities) {
                        // create child entries
                        /**
                         * @type {Object[]}
                         */
                        const children = this.getPropertiesForEntity(
                            {
                                entity: parentEntity, property, filterProperty, filterValue
                            });
                        /**
                         * @type {NonResourceEntityAndContained[]}
                         */
                        const childEntriesForCurrentEntity = children.map(c => new NonResourceEntityAndContained(
                                {
                                    includeInOutput: target.type !== undefined, // if caller has requested this entity or just wants a nested entity
                                    item: c,
                                    containedEntries: []
                                }
                            )
                        );
                        childEntries = childEntries.concat(childEntriesForCurrentEntity);
                        parentEntity.containedEntries = parentEntity.containedEntries.concat(childEntriesForCurrentEntity);
                    }
                }
            } else if (target.params) { // reverse link
                if (target.type) { // if caller has requested this entity or just wants a nested entity
                    // reverse link
                    await this.scopesValidator.verifyHasValidScopesAsync({
                        requestInfo,
                        args: {},
                        resourceType,
                        startTime: Date.now(),
                        action: 'graph',
                        accessRequested: 'read'
                    });
                    if (!parentResourceType) {
                        throw new Error(
                            'processOneGraphLinkAsync: No parent resource found for reverse references for parent entities:' +
                            ` ${parentEntities.map(p => `${p.resource.resourceType}/${p.resource.id}`).toString()}` +
                            ` using target.params: ${target.params}`
                        );
                    }
                    await this.getReverseReferencesAsync(
                        {
                            requestInfo,
                            base_version,
                            parentResourceType,
                            relatedResourceType: resourceType,
                            parentEntities,
                            filterProperty: null,
                            filterValue: null,
                            reverse_filter: target.params
                        }
                    );
                    childEntries = parentEntities.flatMap(p => p.containedEntries);
                }
            }

            // filter childEntries to find entries of same type as parentResource
            childEntries = childEntries.filter(c =>
                (!target.type && !c.resource) || // either there is no target type so choose non-resources
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
                        await this.processOneGraphLinkAsync(
                            {
                                requestInfo,
                                base_version,
                                parentResourceType: childResourceType,
                                link: childLink,
                                parentEntities: childEntries
                            }
                        );
                    }
                }
            }
        }
    }

    /**
     * processes a list of graph links
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} parentResourceType
     * @param {[Resource]} parentEntities
     * @param {[{path:string, params: string,target:[{type: string}]}]} linkItems
     * @return {Promise<[ResourceEntityAndContained]>}
     */
    async processGraphLinksAsync(
        {
            requestInfo,
            base_version,
            parentResourceType,
            parentEntities, linkItems
        }
    ) {
        /**
         * @type {[ResourceEntityAndContained]}
         */
        const resultEntities = parentEntities.map(parentEntity => new ResourceEntityAndContained(
            {
                entityId: parentEntity.id,
                entityResourceType: parentEntity.resourceType,
                fullUrl: this.getFullUrlForResource(
                    {
                        requestInfo, base_version, parentEntity
                    }),
                includeInOutput: true,
                resource: parentEntity,
                containedEntries: []
            }
        ));
        /**
         * @type {{path:string, params: string,target:[{type: string}]}}
         */
        for (const link of linkItems) {
            /**
             * @type {Resource}
             */
            /**
             * @type {ResourceEntityAndContained[]}
             */
            await this.processOneGraphLinkAsync(
                {
                    requestInfo, base_version, parentResourceType, link, parentEntities: resultEntities
                });
        }
        return resultEntities;
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
            result = result.concat([
                new BundleEntry({
                    fullUrl: entityAndContained.fullUrl,
                    resource: entityAndContained.resource
                })
            ]);
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
        return array.filter((value, index, self) =>
                index === self.findIndex((t) => (
                    fnCompare(t, value)
                ))
        );
    }

    /**
     * processing multiple ids
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {Resource} graphDefinition
     * @param {boolean} contained
     * @param {boolean} hash_references
     * @param {string[]} idList
     * @return {Promise<BundleEntry[]>}
     */
    async processMultipleIdsAsync(
        {
            base_version, useAtlas, requestInfo,
            resourceType, graphDefinition,
            contained, hash_references,
            idList
        }
    ) {
        /**
         * @type {BundleEntry[]}
         */
        let entries = [];
        let query = {
            'id': {
                $in: idList
            }
        };
        /**
         * @type {string[]}
         */
        let securityTags = this.securityTagManager.getSecurityTagsFromScope({
            user: requestInfo.user,
            scope: requestInfo.scope
        });
        query = this.securityTagManager.getQueryWithSecurityTags(
            {
                resourceType, securityTags, query
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

        /**
         * mongo db cursor
         * @type {DatabasePartitionedCursor}
         */
        let cursor = await this.databaseQueryFactory.createQuery(
            {resourceType, base_version, useAtlas}
        ).findAsync({query, options});
        cursor = cursor.maxTimeMS({milliSecs: maxMongoTimeMS});

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
                    fullUrl: this.getFullUrlForResource(
                        {
                            requestInfo, base_version, parentEntity: startResource
                        }),
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
         * @type {[ResourceEntityAndContained]}
         */
        const allRelatedEntries = await this.processGraphLinksAsync(
            {
                requestInfo,
                base_version,
                parentResourceType: resourceType,
                parentEntities: topLevelBundleEntries.map(e => e.resource),
                linkItems
            });

        for (const topLevelBundleEntry of topLevelBundleEntries) {
            // add related resources as container
            /**
             * @type {ResourceEntityAndContained}
             */
            const matchingEntity = allRelatedEntries.find(e => e.entityId === topLevelBundleEntry.resource.id &&
                e.entityResourceType === topLevelBundleEntry.resource.resourceType);
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
                    topLevelBundleEntry.resource = await this.convertToHashedReferencesAsync(
                        {
                            parent_entity: topLevelBundleEntry.resource,
                            linkReferences: related_references
                        });
                }
            }
            /**
             * @type {BundleEntry[]}
             */
            const relatedEntities = related_entries
                .flatMap(r => this.getRecursiveContainedEntities(r))
                .filter(r => r.resource !== undefined);
            if (contained) {
                if (relatedEntities.length > 0) {
                    topLevelBundleEntry['resource']['contained'] = relatedEntities.map(r => r.resource);
                }
            } else {
                entries = entries.concat(relatedEntities);
            }
        }

        entries = this.removeDuplicatesWithLambda(entries,
            (a, b) => a.resource.resourceType === b.resource.resourceType && a.resource.id === b.resource.id);
        return entries;
    }

    /**
     * process GraphDefinition and returns a bundle with all the related resources
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {string} resourceType
     * @param {string | string[]} id (accepts a single id or a list of ids)
     * @param {*} graphDefinitionJson (a GraphDefinition resource)
     * @param {boolean} contained
     * @param {boolean} hash_references
     * @return {Promise<Bundle>}
     */
    async processGraphAsync(
        {
            requestInfo,
            base_version, useAtlas, resourceType,
            id,
            graphDefinitionJson, contained, hash_references
        }) {
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

        // const graphParameters = new GraphParameters(base_version, requestInfo.protocol, requestInfo.host,
        //     requestInfo.user, requestInfo.scope,
        //     getAccessCodesFromScopes('read', requestInfo.user, requestInfo.scope),
        //     useAtlas
        // );
        /**
         * @type {BundleEntry[]}
         */
        const entries = await this.processMultipleIdsAsync(
            {
                base_version,
                useAtlas,
                requestInfo,
                resourceType,
                graphDefinition,
                contained,
                hash_references,
                idList: id
            }
        );

        // remove duplicate resources
        /**
         * @type {BundleEntry[]}
         */
        let uniqueEntries = this.removeDuplicatesWithLambda(entries,
            (a, b) => a.resource.resourceType === b.resource.resourceType && a.resource.id === b.resource.id);

        /**
         * @type {string[]}
         */
        const accessCodes = this.scopesManager.getAccessCodesFromScopes('read', requestInfo.user, requestInfo.scope);
        uniqueEntries = uniqueEntries.filter(
            e => this.scopesManager.doesResourceHaveAnyAccessCodeFromThisList(
                accessCodes, requestInfo.user, requestInfo.scope, e.resource
            )
        );
        // create a bundle
        return new Bundle({
            resourceType: 'Bundle',
            id: 'bundle-example',
            type: 'collection',
            timestamp: moment.utc().format('YYYY-MM-DDThh:mm:ss.sss') + 'Z',
            entry: uniqueEntries
        });
    }
}

module.exports = {
    GraphHelper
};
