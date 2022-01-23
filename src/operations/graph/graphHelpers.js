/**
 * This file contains functions to retrieve a graph of data from the database
 */
const {getResource} = require('../common/getResource');
const {buildR4SearchQuery} = require('../query/r4');
const assert = require('assert');
const {verifyHasValidScopes, doesResourceHaveAnyAccessCodeFromThisList} = require('../security/scopes');
const env = require('var');
const pRetry = require('p-retry');
const {logError} = require('../common/logging');
const {logMessageToSlack} = require('../../utils/slack.logger');
const moment = require('moment-timezone');
const {removeNull} = require('../../utils/nullRemover');
const {getFieldNameForSearchParameter} = require('../../searchParameters/searchParameterHelpers');


class EntityAndContained {
    constructor(entityId, entityResourceType, fullUrl, resource, containedEntries) {
        /**
         * @type {string}
         */
        assert(entityId);
        this.entityId = entityId;
        /**
         * @type {string}
         */
        assert(entityResourceType);
        this.entityResourceType = entityResourceType;
        /**
         * @type {string}
         */
        assert(fullUrl);
        this.fullUrl = fullUrl;
        /**
         * @type {Resource}
         */
        assert(resource);
        this.resource = resource;
        /**
         * @type {[EntityAndContained]}
         */
        assert(containedEntries);
        this.containedEntries = containedEntries;
    }
}

/**
 * generates a full url for an entity
 * @param {string} host
 * @param {string} base_version
 * @param {Resource} parentEntity
 * @return {string}
 */
function getFullUrlForResource(host, base_version, parentEntity) {
    return `https://${host}/${base_version}/${parentEntity.resourceType}/${parentEntity.id}`;
}

/**
 * Gets related resources
 * @param {import('mongodb').Db} db
 * @param {string} collectionName
 * @param {string} base_version
 * @param {string} host
 * @param {EntityAndContained[]} parentEntities
 * @param {string} property
 * @param {string | null} filterProperty (Optional) filter the sublist by this property
 * @param {*} filterValue (Optional) match filterProperty to this value
 */
async function get_related_resources(db, collectionName, base_version, host, parentEntities, property, filterProperty, filterValue) {
    if (!parentEntities || parentEntities.length === 0) {
        return; // nothing to do
    }
    /**
     * @type {import('mongodb').Collection<Document>}
     */
    const collection = db.collection(`${collectionName}_${base_version}`);
    /**
     * @type {function(?Object): Resource}
     */
    const RelatedResource = getResource(base_version, collectionName);

    // if (property.includes('.')) {
    //     /**
    //      * @type {string[]}
    //      */
    //     const nestedProperties = property.split('.');
    // }
    const relatedReferences = parentEntities.map(p => p.resource[`${property}`]);
    const relatedReferenceIds = relatedReferences.map(r => r.reference.replace(collectionName + '/', ''));
    const options = {};
    const projection = {};
    // also exclude _id so if there is a covering index the query can be satisfied from the covering index
    projection['_id'] = 0;
    options['projection'] = projection;
    const query = {
        'id': {
            $in: relatedReferenceIds
        }
    };
    const cursor = await collection.find(query, options);

    while (await cursor.hasNext()) {
        const element = await cursor.next();
        const relatedResource = removeNull(new RelatedResource(element).toJSON());

        // find matching parent and add to containedEntries
        const relatedEntityAndContained = new EntityAndContained(
            relatedResource.id,
            relatedResource.resourceType,
            getFullUrlForResource(host, base_version, relatedResource),
            relatedResource,
            []
        );

        const matchingParentEntities = parentEntities.filter(
            p => p.resource[`${property}`].reference === `${relatedResource.resourceType}/${relatedResource.id}`
        );

        // add it to each one since there can be multiple resources that point to the same related resource
        for (const matchingParentEntity of matchingParentEntities) {
            matchingParentEntity.containedEntries = matchingParentEntity.containedEntries.concat(
                relatedEntityAndContained
            );
        }
    }
}

// find elements in other collection that link to this object
/**
 * converts a query string into an args array
 * @type {import('mongodb').Document}
 */
function parseQueryStringIntoArgs(queryString) {
    return Object.fromEntries(new URLSearchParams(queryString));
}

/**
 * Gets related resources using reverse link and add them to containedEntries in parentEntities
 * @param {import('mongodb').Db} db
 * @param {string} parentCollectionName
 * @param {string} relatedResourceCollectionName
 * @param {string} base_version
 * @param {EntityAndContained[]}  parentEntities parent entities
 * @param {string} host
 * @param {string | null} filterProperty (Optional) filter the sublist by this property
 * @param {*} filterValue (Optional) match filterProperty to this value
 * @param {string} reverse_filter Do a reverse link from child to parent using this property
 */
async function get_reverse_related_resources(db, parentCollectionName, relatedResourceCollectionName, base_version, parentEntities, host, filterProperty, filterValue, reverse_filter) {
    if (!(reverse_filter)) {
        throw new Error('reverse_filter must be set');
    }
    // create comma separated list of ids
    const parentIdList = parentEntities.map(p => p.entityId);
    const reverseFilterWithParentIds = reverse_filter.replace('{ref}', parentIdList.toString());
    /**
     * @type {import('mongodb').Collection<Document>}
     */
    const collection = db.collection(`${relatedResourceCollectionName}_${base_version}`);
    /**
     * @type {function(?Object): Resource}
     */
    const RelatedResource = getResource(base_version, relatedResourceCollectionName);

    /**
     * @type {Object}
     */
    const args = parseQueryStringIntoArgs(reverseFilterWithParentIds);
    const searchParameterName = Object.keys(args)[0];
    const query = buildR4SearchQuery(relatedResourceCollectionName, args).query;

    const options = {};
    const projection = {};
    // also exclude _id so if there is a covering index the query can be satisfied from the covering index
    projection['_id'] = 0;
    options['projection'] = projection;

    /**
     * @type {import('mongodb').Cursor}
     */
    const cursor = collection.find(query, options);

    // find matching field name in searchParameter list
    /**
     * @type {string}
     */
    const fieldForSearchParameter = getFieldNameForSearchParameter(relatedResourceCollectionName, searchParameterName);

    while (await cursor.hasNext()) {
        const relatedResourcePropertyCurrent = await cursor.next();
        if (filterProperty !== null) {
            if (relatedResourcePropertyCurrent[`${filterProperty}`] !== filterValue) {
                continue;
            }
        }
        // now match to parent entity, so we can put under correct contained property
        const matchingParentEntity = parentEntities.find(
            p => `${p.resource.resourceType}/${p.resource.id}` === relatedResourcePropertyCurrent[`${fieldForSearchParameter}`]['reference']
        );
        if (matchingParentEntity) {
            matchingParentEntity.containedEntries.push(
                new EntityAndContained(
                    relatedResourcePropertyCurrent.id,
                    relatedResourcePropertyCurrent.resourceType,
                    getFullUrlForResource(host, base_version, relatedResourcePropertyCurrent),
                    removeNull(new RelatedResource(relatedResourcePropertyCurrent).toJSON()),
                    []
                )
            );
        }
    }
}

/**
 * returns whether the resource has the passed in property (handles nested properties)
 * @param {Resource} resource
 * @param {string} property
 * @param {string} filterProperty
 * @param {string} filterValue
 * @returns {*}
 */
function doesResourceHasProperty(resource, property, filterProperty, filterValue) {
    if (property.includes('.')) {
        /**
         * @type {string[]}
         */
        const propertyComponents = property.split('.');
        let currentElements = [resource];
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
        return resource[`${property}`];
    }
}

/**
 * processes a single graph link
 * @param {import('mongodb').Db} db
 * @param {string} base_version
 * @param {string} user
 * @param {string} scope
 * @param {{path: string, params: string, target: {type: string}[]}} link
 * @param {string} host
 * @param {[EntityAndContained]} parentEntities
 */
async function processOneGraphLink(db, base_version, user, scope, host, link,
                                   parentEntities) {

    let link_targets = link.target;
    for (const target of link_targets) {
        /**
         * @type {string}
         */
        const resourceType = target.type;
        // there are two types of linkages:
        // 1. forward linkage: a property in the current object is a reference to the target object (uses "path")
        // 2. reverse linkage: a property in the target object is a reference to the current object (uses "params")
        if (link.path) {
            // forward link
            /**
             * @type {string}
             */
            let property = link.path.replace('[x]', '');
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
            // if the property name includes . then it is a nested link
            // e.g, 'path': 'extension.extension:url=plan'
            // verifyHasValidScopes(resourceType, 'read', user, scope);
            // find parent entities that have a valid property
            const parentEntitiesWithValidProperty = parentEntities.filter(
                p => doesResourceHasProperty(p.resource, property, filterProperty, filterValue)
            );
            await get_related_resources(
                db,
                resourceType,
                base_version,
                host,
                parentEntitiesWithValidProperty,
                property,
                filterProperty,
                filterValue
            );
        } else if (target.params) {
            // reverse link
            /**
             * @type {string}
             */
            verifyHasValidScopes(resourceType, 'read', user, scope);
            await get_reverse_related_resources(
                db,
                resourceType,
                resourceType,
                base_version,
                parentEntities,
                host,
                null,
                null,
                target.params
            );
        }
    }

    /**
     * @type {EntityAndContained[]}
     */
    const childEntries = parentEntities.flatMap(p => p.containedEntries);
    if (childEntries && childEntries.length > 0) {
        // Now recurse down and process the link
        for (const target of link_targets) {
            /**
             * @type {[{path:string, params: string,target:[{type: string}]}]}
             */
            const childLinks = target.link;
            if (childLinks) {
                for (const childLink of childLinks) {
                    await processOneGraphLink(
                        db, base_version, user, scope, host,
                        childLink,
                        childEntries
                    );
                }
            }
        }
    }
}

/**
 * processes a list of graph links
 * @param {import('mongodb').Db} db
 * @param {string} base_version
 * @param {string} user
 * @param {string} scope
 * @param {string} host
 * @param {[Resource]} parentEntities
 * @param {[{path:string, params: string,target:[{type: string}]}]} linkItems
 * @return {Promise<[EntityAndContained]>}
 */
async function processGraphLinks(db, base_version, user, scope, host, parentEntities, linkItems) {
    /**
     * @type {[EntityAndContained]}
     */
    const resultEntities = parentEntities.map(e => new EntityAndContained(e.id, e.resourceType,
        getFullUrlForResource(host, base_version, e), e, []));
    for (const link of linkItems) {
        /**
         * @type {Resource}
         */
        /**
         * @type {EntityAndContained[]}
         */
        await processOneGraphLink(db, base_version, user, scope, host, link, resultEntities);
    }
    return resultEntities;
}

/**
 * prepends # character in references
 * @param {Resource} parent_entity
 * @param {[reference:string]} linkReferences
 * @return {Promise<Resource>}
 */
async function processReferences(parent_entity, linkReferences) {
    const uniqueReferences = new Set(linkReferences);
    if (parent_entity) {
        for (const link_reference of uniqueReferences) {
            // eslint-disable-next-line security/detect-non-literal-regexp
            let re = new RegExp('\\b' + link_reference + '\\b', 'g');
            parent_entity = JSON.parse(JSON.stringify(parent_entity).replace(re, '#'.concat(link_reference)));
        }
    }
    return parent_entity;
}

/**
 *
 * @param {EntityAndContained} entityAndContained
 * @returns {{resource: Resource, fullUrl: string}[]}
 */
function getRecursiveContainedEntities(entityAndContained) {
    /**
     * @type {{resource: Resource, fullUrl: string}[]}
     */
    let result = [];
    result = result.concat([{
        fullUrl: entityAndContained.fullUrl,
        resource: entityAndContained.resource
    }]);

    // now recurse
    result = result.concat(entityAndContained.containedEntries.flatMap(c => getRecursiveContainedEntities(c)));
    return result;
}


/**
 * removes duplicate items from array
 * @param {*[]} array
 * @param fnCompare
 * @returns {*[]}
 */
const removeDuplicatesWithLambda = (array, fnCompare) => {
    return array.filter((value, index, self) =>
            index === self.findIndex((t) => (
                fnCompare(t, value)
            ))
    );
};

/**
 * processing multiple ids
 * @param {import('mongodb').Db} db
 * @param {string} collection_name
 * @param {string} base_version
 * @param {string} resource_name
 * @param {string[]} accessCodes
 * @param {string} user
 * @param {string} scope
 * @param {string} host
 * @param {Resource} graphDefinition
 * @param {boolean} contained
 * @param {boolean} hash_references
 * @param {string[]} idList
 * @return {Promise<{resource: Resource, fullUrl: string}[]>}
 */
async function processMultipleIds(db, collection_name, base_version, resource_name, accessCodes, user,
                                  scope, host, graphDefinition,
                                  contained, hash_references,
                                  idList) {
    /**
     * @type {import('mongodb').Collection<Document>}
     */
    let collection = db.collection(`${collection_name}_${base_version}`);
    /**
     * @type {function(?Object): Resource}
     */
    const StartResource = getResource(base_version, resource_name);
    /**
     * @type {[{resource: Resource, fullUrl: string}]}
     */
    let entries = [];
    const query = {
        'id': {
            $in: idList
        }
    };
    const options = {};
    const projection = {};
    // also exclude _id so if there is a covering index the query can be satisfied from the covering index
    projection['_id'] = 0;
    options['projection'] = projection;

    /**
     * @type {number}
     */
    const maxMongoTimeMS = env.MONGO_TIMEOUT ? parseInt(env.MONGO_TIMEOUT) : (30 * 1000);
    // Now run the query to get a cursor we will enumerate next
    /**
     * mongo db cursor
     * @type {Promise<Cursor<Document>> | *}
     */
    let cursor = await pRetry(
        async () =>
            await collection.find(query, options).maxTimeMS(maxMongoTimeMS),
        {
            retries: 5,
            onFailedAttempt: async error => {
                let msg = `Search ${resource_name}/$graph/${JSON.stringify(idList)} Retry Number: ${error.attemptNumber}: ${error.message}`;
                logError(user, msg);
                await logMessageToSlack(msg);
            }
        }
    );

    /**
     * @type {[EntityAndContained]}
     */
    const topLevelBundleEntries = [];

    while (await cursor.hasNext()) {
        /**
         * element
         * @type {Resource}
         */
        const element = await cursor.next();
        // first add this object
        /**
         * @type {Resource}
         */
        const startResource = new StartResource(element);
        /**
         * @type {{resource: Resource, fullUrl: string}}
         */
        let current_entity = {
            'fullUrl': getFullUrlForResource(host, base_version, startResource),
            'resource': removeNull(startResource.toJSON())
        };
        entries = entries.concat([current_entity]);
        topLevelBundleEntries.push(current_entity);
    }

    /**
     * @type {[{path:string, params: string,target:[{type: string}]}]}
     */
    const linkItems = graphDefinition.link;
    /**
     * @type {[EntityAndContained]}
     */
    const allRelatedEntries = await processGraphLinks(db, base_version, user, scope, host,
        topLevelBundleEntries.map(e => e.resource), linkItems);

    for (const topLevelBundleEntry of topLevelBundleEntries) {
        // add related resources as container
        const matchingEntity = allRelatedEntries.find(e => e.entityId === topLevelBundleEntry.resource.id
            && e.entityResourceType === topLevelBundleEntry.resource.resourceType);
        /**
         * @type {[EntityAndContained]}
         */
        const related_entries = matchingEntity.containedEntries;
        if (env.HASH_REFERENCE || hash_references) {
            /**
             * @type {[string]}
             */
            const related_references = [];
            /**
             * @type {resource: Resource, fullUrl: string}
             */
            for (const related_item of related_entries) {
                related_references.push(related_item['resource']['resourceType'].concat('/', related_item['resource']['id']));
            }
            if (related_references.length > 0) {
                topLevelBundleEntry.resource = await processReferences(topLevelBundleEntry.resource, related_references);
            }
        }
        /**
         * @type {Resource[]}
         */
        const related_resources = related_entries.map(e => e.resource).filter(
            r => doesResourceHaveAnyAccessCodeFromThisList(
                accessCodes, user, scope, r
            )
        );
        if (contained) {
            if (related_resources.length > 0) {
                topLevelBundleEntry['resource']['contained'] = related_resources;
            }
        }
        if (!contained) {
            entries = entries.concat(related_entries.flatMap(r => getRecursiveContainedEntities(r)));
        }
    }

    entries = removeDuplicatesWithLambda(entries,
        (a, b) => a.resource.resourceType === b.resource.resourceType && a.resource.id === b.resource.id);
    return entries;
}

/**
 * process GraphDefinition and returns a bundle with all the related resources
 * @param {import('mongodb').Db} db
 * @param {string} collection_name
 * @param {string} base_version
 * @param {string} resource_name
 * @param {string[]} accessCodes
 * @param {string} user
 * @param {string} scope
 * @param {string} host
 * @param {string | string[]} id (accepts a single id or a list of ids)
 * @param {*} graphDefinitionJson (a GraphDefinition resource)
 * @param {boolean} contained
 * @param {boolean} hash_references
 * @return {Promise<{entry: [{resource: Resource, fullUrl: string}], id: string, resourceType: string}|{entry: *[], id: string, resourceType: string}>}
 */
async function processGraph(db, collection_name, base_version, resource_name, accessCodes, user, scope, host, id, graphDefinitionJson, contained, hash_references) {
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
     * @type {[{resource: Resource, fullUrl: string}]}
     */
    const entries = await processMultipleIds(
        db, collection_name, base_version, resource_name, accessCodes, user, scope, host, graphDefinition, contained, hash_references, id);

    // remove duplicate resources
    /**
     * @type {[{resource: Resource, fullUrl: string}]}
     */
    let uniqueEntries = removeDuplicatesWithLambda(entries,
        (a, b) => a.resource.resourceType === b.resource.resourceType && a.resource.id === b.resource.id);
    uniqueEntries = uniqueEntries.filter(
        e => doesResourceHaveAnyAccessCodeFromThisList(
            accessCodes, user, scope, e.resource
        )
    );
    // create a bundle
    return (
        {
            resourceType: 'Bundle',
            id: 'bundle-example',
            type: 'collection',
            timestamp: moment.utc().format('YYYY-MM-DDThh:mm:ss.sss') + 'Z',
            entry: uniqueEntries
        });
}

module.exports = {
    processGraph: processGraph
};
