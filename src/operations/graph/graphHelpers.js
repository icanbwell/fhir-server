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
 * @param {string | [string]} relatedResourceProperty property to link
 * @param {string | null} filterProperty (Optional) filter the sublist by this property
 * @param {*} filterValue (Optional) match filterProperty to this value
 * @return {Promise<[{resource: Resource, fullUrl: string}]|*[]>}
 */
async function get_related_resources(db, collectionName, base_version, host, relatedResourceProperty, filterProperty, filterValue) {
    /**
     * @type {import('mongodb').Collection<Document>}
     */
    const collection = db.collection(`${collectionName}_${base_version}`);
    /**
     * @type {function(?Object): Resource}
     */
    const RelatedResource = getResource(base_version, collectionName);
    /**
     * entries
     * @type {[{resource: Resource, fullUrl: string}]}
     */
    let entries = [];
    if (relatedResourceProperty) {
        // check if property is a list or not.  If not make it a list to make the code below handle both
        if (!(Array.isArray(relatedResourceProperty))) {
            relatedResourceProperty = [relatedResourceProperty];
        }
        /**
         * @type {string}
         */
        for (const relatedResourcePropertyCurrent of relatedResourceProperty) {
            if (filterProperty) {
                if (relatedResourcePropertyCurrent[`${filterProperty}`] !== filterValue) {
                    continue;
                }
            }
            if (relatedResourcePropertyCurrent.reference) {
                /**
                 * @type {string}
                 */
                const related_resource_id = relatedResourcePropertyCurrent.reference.replace(collectionName + '/', '');

                const options = {};
                const projection = {};
                // also exclude _id so if there is a covering index the query can be satisfied from the covering index
                projection['_id'] = 0;
                options['projection'] = projection;
                /**
                 * @type {Document | null}
                 */
                const found_related_resource = await collection.findOne({id: related_resource_id.toString()}, options);
                if (found_related_resource) {
                    // noinspection UnnecessaryLocalVariableJS
                    const relatedResource = new RelatedResource(found_related_resource);
                    entries = entries.concat([{
                        'fullUrl': getFullUrlForResource(host, base_version, relatedResource),
                        'resource': removeNull(relatedResource.toJSON())
                    }]);
                }
            }
        }
    }
    return entries;
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
 * Gets related resources using reverse link
 * @param {import('mongodb').Db} db
 * @param {string} parentCollectionName
 * @param {string} relatedResourceCollectionName
 * @param {string} base_version
 * @param {Resource} parent parent entity
 * @param {string} host
 * @param {string | null} filterProperty (Optional) filter the sublist by this property
 * @param {*} filterValue (Optional) match filterProperty to this value
 * @param {string} reverse_filter Do a reverse link from child to parent using this property
 * @return {Promise<[{resource: Resource, fullUrl: string}]>}
 */
async function get_reverse_related_resources(db, parentCollectionName, relatedResourceCollectionName, base_version, parent, host, filterProperty, filterValue, reverse_filter) {
    if (!(reverse_filter)) {
        throw new Error('reverse_filter must be set');
    }
    /**
     * @type {import('mongodb').Collection<Document>}
     */
    const collection = db.collection(`${relatedResourceCollectionName}_${base_version}`);
    /**
     * @type {function(?Object): Resource}
     */
    const RelatedResource = getResource(base_version, relatedResourceCollectionName);

    const query = buildR4SearchQuery(relatedResourceCollectionName, parseQueryStringIntoArgs(reverse_filter)).query;

    const options = {};
    const projection = {};
    // also exclude _id so if there is a covering index the query can be satisfied from the covering index
    projection['_id'] = 0;
    options['projection'] = projection;

    /**
     * @type {import('mongodb').Cursor}
     */
    const cursor = collection.find(query, options);

    /**
     * entries
     * @type {[{resource: Resource, fullUrl: string}]}
     */
    let entries = [];

    while (await cursor.hasNext()) {
        const relatedResourcePropertyCurrent = await cursor.next();
        if (filterProperty !== null) {
            if (relatedResourcePropertyCurrent[`${filterProperty}`] !== filterValue) {
                continue;
            }
        }
        entries = entries.concat([{
            'fullUrl': `https://${host}/${base_version}/${relatedResourcePropertyCurrent.resourceType}/${relatedResourcePropertyCurrent.id}`,
            'resource': removeNull(new RelatedResource(relatedResourcePropertyCurrent).toJSON())
        }]);
    }
    return entries;
}

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
 * processes a single graph link
 * @param {import('mongodb').Db} db
 * @param {string} base_version
 * @param {string} user
 * @param {string} scope
 * @param {{path: string, params: string, target: {type: string}[]}} link
 * @param {string} host
 * @param {Resource | [Resource]} parent_entity
 * @param {[Resource]} parentEntities
 * @return {Promise<[EntityAndContained]>}
 */
async function processOneGraphLink(db, base_version, user, scope, host, link,
                                   parent_entity, parentEntities) {
    /**
     * @type {EntityAndContained[]}
     */
    let result = [];
    for (const parentEntity of parentEntities) {
        /**
         * entries for processing the current link
         * @type {[{resource: Resource, fullUrl: string}]}
         */
        let entries_for_current_link = [];
        /**
         * full url to resource
         * @type {string}
         */
        const fullResourceUrl = getFullUrlForResource(host, base_version, parentEntity);
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
                if (property.includes('.')) {
                    /**
                     * @type {string[]}
                     */
                    const nestedProperties = property.split('.');
                    /**
                     * @type { Resource | [Resource]}
                     */
                    let parentEntityResources = parentEntity;
                    if (parentEntityResources) {
                        parentEntityResources = (
                            Array.isArray(parentEntityResources)
                                ? parentEntityResources
                                : [parentEntityResources]
                        );
                    }
                    /**
                     * @type {string}
                     */
                    for (const nestedPropertyName of nestedProperties) {
                        /**
                         * @type {[Resource]}
                         */
                        let resultParentEntityPropertyResources = [];
                        if (parentEntityResources) {
                            /**
                             * @type {Resource}
                             */
                            for (const parentEntityResource of parentEntityResources) {
                                // since this is a nested entity the value of parentEntityResource[`${nestedPropertyName}`]
                                //  will be a Resource
                                if (parentEntityResource[`${nestedPropertyName}`]) {
                                    if (Array.isArray(parentEntityResource[`${nestedPropertyName}`])) {
                                        resultParentEntityPropertyResources = resultParentEntityPropertyResources.concat(
                                            parentEntityResource[`${nestedPropertyName}`]
                                        );
                                    } else {
                                        resultParentEntityPropertyResources.push(parentEntityResource[`${nestedPropertyName}`]);
                                    }
                                }
                            }
                            parentEntityResources = resultParentEntityPropertyResources;
                        } else {
                            break;
                        }
                    }
                    if (parentEntityResources) {
                        if (filterProperty) {
                            parentEntityResources = (Array.isArray(parentEntityResources)
                                ? parentEntityResources
                                : [parentEntityResources])
                                .filter(e => e[`${filterProperty}`] === filterValue);
                        }
                        if (link.target && link.target.length > 0 && link.target[0].link) {
                            /**
                             * @type {Resource}
                             */
                            for (const parentResource of parentEntityResources) {
                                // if no target specified then we don't write the resource but try to process the links
                                entries_for_current_link = entries_for_current_link.concat([
                                    {
                                        'resource': parentResource,
                                        'fullUrl': ''
                                    }
                                ]);
                            }
                        } else {
                            /**
                             * @type {Resource}
                             */
                            for (const parentEntityProperty1 of parentEntityResources) {
                                verifyHasValidScopes(parentEntityProperty1.resourceType, 'read', user, scope);
                                entries_for_current_link = entries_for_current_link.concat(
                                    await get_related_resources(
                                        db,
                                        resourceType,
                                        base_version,
                                        host,
                                        parentEntityProperty1,
                                        filterProperty,
                                        filterValue
                                    )
                                );
                            }
                        }
                    }
                } else {
                    verifyHasValidScopes(parentEntity.resourceType, 'read', user, scope);
                    entries_for_current_link = entries_for_current_link.concat(
                        await get_related_resources(
                            db,
                            resourceType,
                            base_version,
                            host,
                            parentEntity[`${property}`],
                            filterProperty,
                            filterValue
                        )
                    );
                }
            } else if (target.params) {
                // reverse link
                /**
                 * @type {string}
                 */
                verifyHasValidScopes(parentEntity.resourceType, 'read', user, scope);
                entries_for_current_link = entries_for_current_link.concat(
                    await get_reverse_related_resources(
                        db,
                        parent_entity.resourceType,
                        resourceType,
                        base_version,
                        parentEntity,
                        host,
                        null,
                        null,
                        target.params.replace('{ref}', parent_entity['id'])
                    )
                );
            }
        }
        /**
         * @type {EntityAndContained}
         */
        const currentEntityAndContained = new EntityAndContained(parentEntity.id, parentEntity.resourceType,
            fullResourceUrl,
            parentEntity,
            entries_for_current_link.filter(e => e.resource['resourceType'] && e.fullUrl
            ).map(e => new EntityAndContained(e.resource.id, e.resource.resourceType, e.fullUrl, e.resource, [])));
        result = result.concat(currentEntityAndContained);

        // Now recurse down and process the link
        for (const target of link_targets) {
            /**
             * @type {[{path:string, params: string,target:[{type: string}]}]}
             */
            const childLinks = target.link;
            if (childLinks) {
                /**
                 * @type {EntityAndContained}
                 */
                for (const entryItem of currentEntityAndContained.containedEntries) {
                    for (const childLink of childLinks) {
                        // noinspection UnnecessaryLocalVariableJS
                        /**
                         * @type {EntityAndContained[]}
                         */
                        const entitiesAndContained = await processOneGraphLink(
                            db, base_version, user, scope, host,
                            childLink,
                            entryItem.resource,
                            [entryItem.resource]
                        );
                        const matchingEntryItem = entitiesAndContained.find(
                            m => m.entityId === entryItem.entityId
                                && m.entityResourceType === entryItem.entityResourceType);
                        if (matchingEntryItem) {
                            entryItem.containedEntries = entryItem.containedEntries.concat(matchingEntryItem.containedEntries);
                        }
                    }
                }
            }
        }
    }
    return result;
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
        for (const parentEntity of parentEntities) {
            /**
             * @type {EntityAndContained[]}
             */
            const entitiesAndContained = await processOneGraphLink(db, base_version, user, scope, host, link, parentEntity, parentEntities);
            // match up with existing entities
            for (const resultEntity of resultEntities) {
                /**
                 * @type {EntityAndContained}
                 */
                const matchingEntity = entitiesAndContained.find(x => x.entityId === resultEntity.entityId
                    && x.entityResourceType === resultEntity.entityResourceType);
                if (matchingEntity && matchingEntity.containedEntries.length > 0) {
                    resultEntity.containedEntries = resultEntity.containedEntries.concat(matchingEntity.containedEntries);
                }
            }

        }
    }
    // now flatten the contained arrays
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
     * @type {Resource[]}
     */
    const resources = [];
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
        resources.push(startResource);
    }

    for (const resource of resources) {
        /**
         * @type {{resource: Resource, fullUrl: string}}
         */
        let current_entity = {
            'fullUrl': getFullUrlForResource(host, base_version, resource),
            'resource': removeNull(resource.toJSON())
        };
        /**
         * @type {[{path:string, params: string,target:[{type: string}]}]}
         */
        const linkItems = graphDefinition.link;
        // add related resources as container
        /**
         * @type {[EntityAndContained]}
         */
        const allEntries = await processGraphLinks(db, base_version, user, scope, host, [resource], linkItems);
        const matchingEntity = allEntries.find(e => e.entityId === current_entity.resource.id
            && e.entityResourceType === current_entity.resource.resourceType);
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
                current_entity.resource = await processReferences(current_entity.resource, related_references);
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
                current_entity['resource']['contained'] = related_resources;
            }
        }
        entries = entries.concat([current_entity]);
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
