// noinspection ExceptionCaughtLocallyJS

const {VERSIONS} = require('@asymmetrik/node-fhir-server-core').constants;
const {CLIENT_DB} = require('../../constants');
const moment = require('moment-timezone');
const globals = require('../../globals');
// noinspection JSCheckFunctionSignatures
/**
 * @type {import('winston').logger}
 */
const logger = require('@asymmetrik/node-fhir-server-core').loggers.get();
const {validateResource} = require('../../utils/validator.util');
const {
    NotAllowedError,
    NotFoundError,
    BadRequestError,
    ForbiddenError
} = require('../../utils/httpErrors');
const {validate, applyPatch} = require('fast-json-patch');
const organizationEverythingGraph = require('../../graphs/organization/everything.json');
const practitionerEverythingGraph = require('../../graphs/practitioner/everything.json');
const slotEverythingGraph = require('../../graphs/slot/everything.json');

const async = require('async');
const env = require('var');
const {get_all_args} = require('../../operations/common/get_all_args');
const {logRequest, logDebug} = require('../../operations/common/logging');
const {verifyHasValidScopes, isAccessToResourceAllowedBySecurityTags, doesResourceHaveAccessTags,
    getAccessCodesFromScopes, doesResourceHaveAnyAccessCodeFromThisList
} = require('../../operations/security/scopes');
const {getResource} = require('../../operations/common/getResource');
const {buildStu3SearchQuery} = require('../../operations/search/query/stu3');
const {buildDstu2SearchQuery} = require('../../operations/search/query/dstu2');
const {isTrue} = require('../../operations/common/isTrue');
const {search} = require('../../operations/search/search');
const {searchById} = require('../../operations/searchById/searchById');
const {create} = require('../../operations/create/create');
const {update} = require('../../operations/update/update');
const {merge} = require('../../operations/merge/merge');


// This is needed for JSON.stringify() can handle regex
// https://stackoverflow.com/questions/12075927/serialization-of-regexp
// eslint-disable-next-line no-extend-native
Object.defineProperty(RegExp.prototype, 'toJSON', {
    value: RegExp.prototype.toString
});

/**
 * does a FHIR Search
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 * @return {Resource[] | Resource} array of resources
 */
module.exports.search = async (args, {req}, resource_name, collection_name) => {
    return search(args, {req}, resource_name, collection_name);
};

/**
 * does a FHIR Search By Id
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 */
// eslint-disable-next-line no-unused-vars
module.exports.searchById = async (args, {req}, resource_name, collection_name) => {
    return searchById(args, {req}, resource_name, collection_name);
};

/**
 * does a FHIR Create (POST)
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 */
module.exports.create = async (args, {req}, resource_name, collection_name) => {
    return create(args, {req}, resource_name, collection_name);
};

/**
 * does a FHIR Update (PUT)
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 */
module.exports.update = async (args, {req}, resource_name, collection_name) => {
    return update(args, {req}, resource_name, collection_name);
};

/**
 * does a FHIR Merge
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 * @return {Resource | Resource[]}
 */
module.exports.merge = async (args, {req}, resource_name, collection_name) => {
    return merge(args, {req}, resource_name, collection_name);
};

/**
 * does a FHIR $everything
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 */
module.exports.everything = async (args, {req}, resource_name, collection_name) => {
    logRequest(req.user, `${resource_name} >>> everything`);
    verifyHasValidScopes(resource_name, 'read', req.user, req.authInfo && req.authInfo.scope);

    try {
        let {id} = args;

        logRequest(req.user, `id=${id}`);
        logDebug(req.user, `req=${req}`);

        let query = {};
        query.id = id;
        // Grab an instance of our DB and collection
        if (collection_name === 'Practitioner') {
            // noinspection JSUndefinedPropertyAssignment
            req.body = practitionerEverythingGraph;
            return await module.exports.graph(args, {req}, resource_name, collection_name);
        } else if (collection_name === 'Organization') {
            // noinspection JSUndefinedPropertyAssignment
            req.body = organizationEverythingGraph;
            return await module.exports.graph(args, {req}, resource_name, collection_name);
        } else if (collection_name === 'Slot') {
            // noinspection JSUndefinedPropertyAssignment
            req.body = slotEverythingGraph;
            return await module.exports.graph(args, {req}, resource_name, collection_name);
        } else {
            // noinspection ExceptionCaughtLocallyJS
            throw new Error('$everything is not supported for resource: ' + collection_name);
        }
    } catch (err) {
        logger.error(`Error with ${resource_name}.everything: `, err);
        throw new BadRequestError(err);
    }
};

/**
 * does a FHIR Remove (DELETE)
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 */
// eslint-disable-next-line no-unused-vars
module.exports.remove = async (args, {req}, resource_name, collection_name) => {
    logRequest(req.user, `${resource_name} >>> remove`);
    verifyHasValidScopes(resource_name, 'write', req.user, req.authInfo && req.authInfo.scope);

    let {base_version, id} = args;

    logDebug(req.user, `Deleting id=${id}`);

    // Grab an instance of our DB and collection
    let db = globals.get(CLIENT_DB);
    let collection = db.collection(`${collection_name}_${base_version}`);
    // Delete our resource record
    let res;
    try {
        res = await collection.deleteOne({id: id});
    } catch (e) {
        logger.error(`Error with ${resource_name}.remove`);
        throw new NotAllowedError(e.message);
    }
    // delete history as well.  You can chose to save history.  Up to you
    let history_collection = db.collection(`${collection_name}_${base_version}_History`);
    try {
        await history_collection.deleteMany({id: id});
    } catch (e) {
        logger.error(`Error with ${resource_name}.remove`);
        throw new NotAllowedError(e.message);
    }
    return {deleted: res.result && res.result.n};
};

/**
 * does a FHIR Search By Version
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 */
// eslint-disable-next-line no-unused-vars
module.exports.searchByVersionId = async (args, {req}, resource_name, collection_name) => {
    logRequest(req.user, `${resource_name} >>> searchByVersionId`);
    verifyHasValidScopes(resource_name, 'read', req.user, req.authInfo && req.authInfo.scope);

    let {base_version, id, version_id} = args;

    let Resource = getResource(base_version, resource_name);

    let db = globals.get(CLIENT_DB);
    let history_collection = db.collection(`${collection_name}_${base_version}_History`);

    // Query our collection for this observation
    let resource;
    try {
        resource = await history_collection.findOne(
            {id: id.toString(), 'meta.versionId': `${version_id}`});
    } catch (e) {
        throw new BadRequestError(e);
    }
    if (resource) {
        if (!(isAccessToResourceAllowedBySecurityTags(resource, req))) {
            throw new ForbiddenError(
                'user ' + req.user + ' with scopes [' + req.authInfo.scope + '] has no access to resource ' +
                resource.resourceType + ' with id ' + id);
        }
        return (new Resource(resource));
    } else {
        throw new NotFoundError();
    }
};

/**
 * does a FHIR History
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 */
// eslint-disable-next-line no-unused-vars
module.exports.history = async (args, {req}, resource_name, collection_name) => {
    logRequest(req.user, `${resource_name} >>> history`);
    verifyHasValidScopes(resource_name, 'read', req.user, req.authInfo && req.authInfo.scope);

    // Common search params
    let {base_version} = args;

    let query = {};

    if (base_version === VERSIONS['3_0_1']) {
        query = buildStu3SearchQuery(args);
    } else if (base_version === VERSIONS['1_0_2']) {
        query = buildDstu2SearchQuery(args);
    }

    // Grab an instance of our DB and collection
    let db = globals.get(CLIENT_DB);
    let history_collection = db.collection(`${collection_name}_${base_version}_History`);
    let Resource = getResource(base_version, resource_name);

    // Query our collection for this observation
    let cursor;
    try {
        cursor = await history_collection.find(query);
    } catch (e) {
        throw new NotFoundError(e.message);
    }
    const resources = [];
    while (await cursor.hasNext()) {
        const element = await cursor.next();
        const resource = new Resource(element);
        if (isAccessToResourceAllowedBySecurityTags(resource, req)) {
            resources.push(resource);
        }
    }
    if (resources.length === 0) {
        throw new NotFoundError();
    }
    return (resources);
};

/**
 * does a FHIR History By Id
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 */
// eslint-disable-next-line no-unused-vars
module.exports.historyById = async (args, {req}, resource_name, collection_name) => {
    logRequest(req.user, `${resource_name} >>> historyById`);
    verifyHasValidScopes(resource_name, 'read', req.user, req.authInfo && req.authInfo.scope);

    let {base_version, id} = args;
    let query = {};

    if (base_version === VERSIONS['3_0_1']) {
        query = buildStu3SearchQuery(args);
    } else if (base_version === VERSIONS['1_0_2']) {
        query = buildDstu2SearchQuery(args);
    }

    query.id = `${id}`;

    // Grab an instance of our DB and collection
    let db = globals.get(CLIENT_DB);
    let history_collection = db.collection(`${collection_name}_${base_version}_History`);
    let Resource = getResource(base_version, resource_name);

    // Query our collection for this observation
    let cursor;
    try {
        cursor = await history_collection.find(query);
    } catch (e) {
        logger.error(`Error with ${resource_name}.historyById: `, e);
        throw new BadRequestError(e);
    }
    const resources = [];
    while (await cursor.hasNext()) {
        const element = await cursor.next();
        const resource = new Resource(element);
        if (isAccessToResourceAllowedBySecurityTags(resource, req)) {
            resources.push(resource);
        }
    }
    if (resources.length === 0) {
        throw new NotFoundError();
    }
    return (resources);
};

/**
 * does a FHIR Patch
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 */
// eslint-disable-next-line no-unused-vars
module.exports.patch = async (args, {req}, resource_name, collection_name) => {
    logRequest(req.user, 'Patient >>> patch');
    verifyHasValidScopes(resource_name, 'write', req.user, req.authInfo && req.authInfo.scope);

    let {base_version, id, patchContent} = args;

    // Grab an instance of our DB and collection
    let db = globals.get(CLIENT_DB);
    let collection = db.collection(`${collection_name}_${base_version}`);

    // Get current record
    // Query our collection for this observation
    let data;
    try {
        data = await collection.findOne({id: id.toString()});
    } catch (e) {
        logger.error(`Error with ${resource_name}.patch: `, e);
        throw new BadRequestError(e);
    }
    if (!data) {
        throw new NotFoundError();
    }
    // Validate the patch
    let errors = validate(patchContent, data);
    if (errors && Object.keys(errors).length > 0) {
        logger.error('Error with patch contents');
        throw new BadRequestError(errors[0]);
    }
    // Make the changes indicated in the patch
    let resource_incoming = applyPatch(data, patchContent).newDocument;

    let Resource = getResource(base_version, resource_name);
    let resource = new Resource(resource_incoming);

    if (data && data.meta) {
        let foundResource = new Resource(data);
        let meta = foundResource.meta;
        // noinspection JSUnresolvedVariable
        meta.versionId = `${parseInt(foundResource.meta.versionId) + 1}`;
        resource.meta = meta;
    } else {
        throw new BadRequestError(new Error('Unable to patch resource. Missing either data or metadata.'));
    }

    // Same as update from this point on
    let cleaned = JSON.parse(JSON.stringify(resource));
    let doc = Object.assign(cleaned, {_id: id});

    // Insert/update our resource record
    let res;
    try {
        res = await collection.findOneAndUpdate({id: id}, {$set: doc}, {upsert: true});
    } catch (e) {
        logger.error(`Error with ${resource_name}.update: `, e);
        throw new BadRequestError(e);
    }
    // Save to history
    let history_collection = db.collection(`${collection_name}_${base_version}_History`);
    let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});

    // Insert our resource record to history but don't assign _id
    try {
        await history_collection.insertOne(history_resource);
    } catch (e) {
        logger.error(`Error with ${resource_name}History.create: `, e);
        throw new BadRequestError(e);
    }
    return {
        id: doc.id,
        created: res.lastErrorObject && !res.lastErrorObject.updatedExisting,
        resource_version: doc.meta.versionId,
    };
};

/**
 * does a FHIR Validate
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 */
module.exports.validate = async (args, {req}, resource_name, collection_name) => {
    logRequest(req.user, `${resource_name} >>> validate`);

    // no auth check needed to call validate

    let resource_incoming = req.body;

    // eslint-disable-next-line no-unused-vars
    // let {base_version} = args;

    logDebug(req.user, '--- request ----');
    logDebug(req.user, req);
    logDebug(req.user, collection_name);
    logDebug(req.user, '-----------------');

    logDebug(req.user, '--- body ----');
    logDebug(req.user, resource_incoming);
    logDebug(req.user, '-----------------');


    logDebug(req.user, '--- validate schema ----');
    const operationOutcome = validateResource(resource_incoming, resource_name, req.path);
    if (operationOutcome && operationOutcome.statusCode === 400) {
        return operationOutcome;
    }

    if (!doesResourceHaveAccessTags(resource_incoming)) {
        return {
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'Resource is missing a security access tag with system: https://www.icanbwell.com/access'
                    },
                    expression: [
                        resource_name
                    ]
                }
            ]
        };
    }
    return {
        resourceType: 'OperationOutcome',
        issue: [
            {
                severity: 'information',
                code: 'informational',
                details: {
                    text: 'OK'
                },
                expression: [
                    resource_name
                ]
            }
        ]
    };
};

/**
 * Supports $graph
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 * @return {Promise<{entry: {resource: Resource, fullUrl: string}[], id: string, resourceType: string}|{entry: *[], id: string, resourceType: string}>}
 */
module.exports.graph = async (args, {req}, resource_name, collection_name) => {
    logRequest(req.user, `${resource_name} >>> graph`);
    verifyHasValidScopes(resource_name, 'read', req.user, req.authInfo && req.authInfo.scope);

    const accessCodes = getAccessCodesFromScopes('read', req.user, req.authInfo && req.authInfo.scope);

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
                /**
                 * @type {string}
                 */
                const related_resource_id = relatedResourcePropertyCurrent.reference.replace(collectionName + '/', '');

                /**
                 * @type {Document | null}
                 */
                const found_related_resource = await collection.findOne({id: related_resource_id.toString()});
                if (found_related_resource) {
                    // noinspection UnnecessaryLocalVariableJS
                    entries = entries.concat([{
                        'fullUrl': `https://${host}/${base_version}/${found_related_resource.resourceType}/${found_related_resource.id}`,
                        'resource': new RelatedResource(found_related_resource)
                    }]);
                }
            }
        }
        return entries;
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
     * @param {string} reverse_property (Optional) Do a reverse link from child to parent using this property
     * @return {Promise<[{resource: Resource, fullUrl: string}]>}
     */
    async function get_reverse_related_resources(db, parentCollectionName, relatedResourceCollectionName, base_version, parent, host, filterProperty, filterValue, reverse_property) {
        if (!(reverse_property)) {
            throw new Error('reverse_property must be set');
        }
        /**
         * @type {import('mongodb').Collection<Document>}
         */
        const collection = db.collection(`${relatedResourceCollectionName}_${base_version}`);
        /**
         * @type {function(?Object): Resource}
         */
        const RelatedResource = getResource(base_version, relatedResourceCollectionName);
        /**
         * @type {[import('mongodb').Document]}
         */
        let relatedResourcePropertyDocuments;
        // find elements in other collection that link to this object
        /**
         * @type {import('mongodb').Document}
         */
        const query = {
            [reverse_property + '.reference']: parentCollectionName + '/' + parent['id']
        };
        /**
         * @type {import('mongodb').FindCursor}
         */
        const cursor = collection.find(query);
        // noinspection JSUnresolvedFunction
        relatedResourcePropertyDocuments = await cursor.toArray();
        /**
         * entries
         * @type {[{resource: Resource, fullUrl: string}]}
         */
        let entries = [];
        if (relatedResourcePropertyDocuments) {
            /**
             * relatedResourcePropertyCurrent
             * @type Resource
             */
            for (const relatedResourcePropertyCurrent of relatedResourcePropertyDocuments) {
                if (filterProperty !== null) {
                    if (relatedResourcePropertyCurrent[`${filterProperty}`] !== filterValue) {
                        continue;
                    }
                }
                entries = entries.concat([{
                    'fullUrl': `https://${host}/${base_version}/${relatedResourcePropertyCurrent.resourceType}/${relatedResourcePropertyCurrent.id}`,
                    'resource': new RelatedResource(relatedResourcePropertyCurrent)
                }]);

            }
        }
        return entries;
    }

    /**
     * process GraphDefinition and returns a bundle with all the related resources
     * @param {import('mongodb').Db} db
     * @param {string} base_version
     * @param {string} host
     * @param {string | string[]} id (accepts a single id or a list of ids)
     * @param {*} graphDefinitionJson (a GraphDefinition resource)
     * @param {boolean} contained
     * @param {boolean} hash_references
     * @return {Promise<{entry: [{resource: Resource, fullUrl: string}], id: string, resourceType: string}|{entry: *[], id: string, resourceType: string}>}
     */
    async function processGraph(db, base_version, host, id, graphDefinitionJson, contained, hash_references) {
        /**
         * @type {function(?Object): Resource}
         */
        const GraphDefinitionResource = getResource(base_version, 'GraphDefinition');
        /**
         * @type {Resource}
         */
        const graphDefinition = new GraphDefinitionResource(graphDefinitionJson);
        /**
         * @type {import('mongodb').Collection<Document>}
         */
        let collection = db.collection(`${collection_name}_${base_version}`);
        /**
         * @type {function(?Object): Resource}
         */
        const StartResource = getResource(base_version, resource_name);

        if (!(Array.isArray(id))) {
            id = [id];
        }

        /**
         * processes a list of graph links
         * @param {Resource | [Resource]} parent_entity
         * @param {[{path:string, params: string,target:[{type: string}]}]} linkItems
         * @return {Promise<[{resource: Resource, fullUrl: string}]>}
         */
        async function processGraphLinks(parent_entity, linkItems) {
            /**
             * entries
             * @type {[{resource: Resource, fullUrl: string}]}
             */
            let entries = [];
            /**
             * @type {[Resource]}
             */
            const parentEntities = Array.isArray(parent_entity) ? parent_entity : [parent_entity];
            for (const link of linkItems) {
                for (const parentEntity of parentEntities) {
                    /**
                     * entries
                     * @type {[{resource: Resource, fullUrl: string}]}
                     */
                    let entries_for_current_link = [];
                    if (link.target && link.target.length > 0) {
                        /**
                         * @type {string}
                         */
                        const resourceType = link.target[0].type;
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
                            // e.g, "path": "extension.extension:url=plan"
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
                                            verifyHasValidScopes(parentEntityProperty1.resourceType, 'read', req.user, req.authInfo && req.authInfo.scope);
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
                                verifyHasValidScopes(parentEntity.resourceType, 'read', req.user, req.authInfo && req.authInfo.scope);
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
                        } else if (link.target && link.target.length > 0 && link.target[0].params) {
                            // reverse link
                            /**
                             * @type {string}
                             */
                            const reverseProperty = link.target[0].params.replace('={ref}', '');
                            verifyHasValidScopes(parentEntity.resourceType, 'read', req.user, req.authInfo && req.authInfo.scope);
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
                                    reverseProperty
                                )
                            );
                        }
                    }
                    entries = entries.concat(
                        entries_for_current_link.filter(e => e.resource['resourceType'] && e.fullUrl)
                    );
                    if (link.target && link.target.length > 0) {
                        /**
                         * @type {[{path:string, params: string,target:[{type: string}]}]}
                         */
                        const childLinks = link.target[0].link;
                        if (childLinks) {
                            /**
                             * @type {resource: Resource, fullUrl: string}
                             */
                            for (const entryItem of entries_for_current_link) {
                                entries = entries.concat(
                                    await processGraphLinks(entryItem.resource, childLinks)
                                );
                            }
                        }
                    }
                }
            }
            return entries;
        }

        /**
         * prepends # character in references
         * @param {Resource} parent_entity
         * @param {[reference:string]} linkReferences
         * @return {Promise<Resource>}
         */
        async function processReferences(parent_entity, linkReferences) {
            if (parent_entity) {
                for (const link_reference of linkReferences) {
                    // eslint-disable-next-line security/detect-non-literal-regexp
                    let re = new RegExp('\\b' + link_reference + '\\b', 'g');
                    parent_entity = JSON.parse(JSON.stringify(parent_entity).replace(re, '#'.concat(link_reference)));
                }
            }
            return parent_entity;
        }

        async function processSingleId(id1) {
            /**
             * @type {[{resource: Resource, fullUrl: string}]}
             */
            let entries = [];
            /**
             * @type {?import('mongodb').Document | null}
             */
            let start_entry = await collection.findOne({id: id1.toString()});

            if (start_entry) {
                // first add this object
                /**
                 * @type {{resource: Resource, fullUrl: string}}
                 */
                let current_entity = {
                    'fullUrl': `https://${host}/${base_version}/${start_entry.resourceType}/${start_entry.id}`,
                    'resource': new StartResource(start_entry)
                };
                /**
                 * @type {[{path:string, params: string,target:[{type: string}]}]}
                 */
                const linkItems = graphDefinition.link;
                // add related resources as container
                /**
                 * @type {[{resource: Resource, fullUrl: string}]}
                 */
                const related_entries = await processGraphLinks(new StartResource(start_entry), linkItems);
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
                    current_entity.resource = await processReferences(current_entity.resource, related_references);
                }
                if (contained) {
                    /**
                     * @type {Resource[]}
                     */
                    const related_resources = related_entries.map(e => e.resource).filter(
                        resource => doesResourceHaveAnyAccessCodeFromThisList(
                            accessCodes, req.user, req.authInfo.scope, resource
                        )
                    );

                    if (related_resources.length > 0) {
                        current_entity['resource']['contained'] = related_resources;
                    }
                }
                entries = entries.concat([current_entity]);
                if (!contained) {
                    entries = entries.concat(related_entries);
                }
            }
            return entries;
        }

        /**
         * @type {[[{resource: Resource, fullUrl: string}]]}]
         */
        const entriesById = await async.map(id, async x => await processSingleId(x));
        /**
         * @type {[{resource: Resource, fullUrl: string}]}
         */
        let entries = entriesById.flat(2);
        // remove duplicate resources
        /**
         * @type {[{resource: Resource, fullUrl: string}]}
         */
        const uniqueEntries = entries.reduce((acc, item) => {
            if (!acc.find(a => a.resourceType === item.resource.resourceType && a.id === item.resource.id)) {
                acc.push(item);
            }
            return acc;
        }, []).filter(
            e => doesResourceHaveAnyAccessCodeFromThisList(
                accessCodes, req.user, req.authInfo.scope, e.resource
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

    try {
        /**
         * @type {string}
         */
        const host = req.headers.host;
        const combined_args = get_all_args(req, args);
        let {base_version, id} = combined_args;

        logRequest(req.user, `id=${id}`);
        logDebug(req.user, `req=${req}`);

        id = id.split(',');
        /**
         * @type {boolean}
         */
        const contained = isTrue(combined_args['contained']);
        /**
         * @type {boolean}
         */
        const hash_references = isTrue(combined_args['_hash_references']);
        // Grab an instance of our DB and collection
        /**
         * @type {import('mongodb').Db}
         */
        let db = globals.get(CLIENT_DB);
        // get GraphDefinition from body
        const graphDefinitionRaw = req.body;
        logDebug(req.user, '--- validate schema of GraphDefinition ----');
        const operationOutcome = validateResource(graphDefinitionRaw, 'GraphDefinition', req.path);
        if (operationOutcome && operationOutcome.statusCode === 400) {
            logDebug(req.user, 'GraphDefinition schema failed validation');
            return operationOutcome;
        }
        // noinspection UnnecessaryLocalVariableJS
        /**
         * @type {{entry: {resource: Resource, fullUrl: string}[], id: string, resourceType: string}|{entry: *[], id: string, resourceType: string}}
         */
        const result = await processGraph(
            db,
            base_version,
            host,
            id,
            graphDefinitionRaw,
            contained,
            hash_references
        );
        // const operationOutcomeResult = validateResource(result, 'Bundle', req.path);
        // if (operationOutcomeResult && operationOutcomeResult.statusCode === 400) {
        //     return operationOutcomeResult;
        // }
        return result;
    } catch (err) {
        logger.error(`Error with ${resource_name}.graph: `, err);
        throw new BadRequestError(err);
    }
};
