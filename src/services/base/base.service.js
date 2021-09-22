// noinspection ExceptionCaughtLocallyJS

const {VERSIONS} = require('@asymmetrik/node-fhir-server-core').constants;
const scopeChecker = require('@asymmetrik/sof-scope-checker');
const {CLIENT_DB} = require('../../constants');
const moment = require('moment-timezone');
const globals = require('../../globals');
// noinspection JSCheckFunctionSignatures
/**
 * @type {import('winston').logger}
 */
const logger = require('@asymmetrik/node-fhir-server-core').loggers.get();
const {getUuid} = require('../../utils/uid.util');
const {validateResource} = require('../../utils/validator.util');
const {
    NotAllowedError,
    NotFoundError,
    BadRequestError,
    NotValidatedError,
    ForbiddenError
} = require('../../utils/httpErrors');
const {validate, applyPatch, compare} = require('fast-json-patch');
const deepmerge = require('deepmerge');
const deepcopy = require('deepcopy');
// const deepEqual = require('deep-equal');
const deepEqual = require('fast-deep-equal');
const sendToS3 = require('../../utils/aws-s3');
const organizationEverythingGraph = require('../../graphs/organization/everything.json');
const practitionerEverythingGraph = require('../../graphs/practitioner/everything.json');
const slotEverythingGraph = require('../../graphs/slot/everything.json');

const async = require('async');
const env = require('var');
const {get_all_args} = require('../../operations/common/get_all_args');
const {logRequest, logDebug} = require('../../operations/common/logging');
const {search} = require('../../operations/search/search');
const {searchById} = require('../../operations/searchById/searchById');
const {verifyHasValidScopes, isAccessToResourceAllowedBySecurityTags, doesResourceHaveAccessTags, parseScopes,
    getAccessCodesFromScopes, doesResourceHaveAnyAccessCodeFromThisList
} = require('../../operations/security/scopes');
const {getResource} = require('../../operations/common/getResource');
const {getMeta} = require('../../operations/common/getMeta');
const {buildStu3SearchQuery} = require('../../operations/search/query/stu3');
const {buildDstu2SearchQuery} = require('../../operations/search/query/dstu2');
const {isTrue} = require('../../operations/common/isTrue');


// This is needed for JSON.stringify() can handle regex
// https://stackoverflow.com/questions/12075927/serialization-of-regexp
// eslint-disable-next-line no-extend-native
Object.defineProperty(RegExp.prototype, 'toJSON', {
    value: RegExp.prototype.toString
});

const check_fhir_mismatch = (cleaned, patched) => {
    if (deepEqual(cleaned, patched) === false) {
        let diff = compare(cleaned, patched);
        logger.warn('Possible FHIR mismatch between incoming resource and updated resource - ' + cleaned.resourceType + cleaned.id + ':' + cleaned.resourceType);
        logger.warn(diff);
    }
};

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
    logRequest(req.user, `${resource_name} >>> create`);

    verifyHasValidScopes(resource_name, 'write', req.user, req.authInfo && req.authInfo.scope);

    let resource_incoming = req.body;

    let {base_version} = args;

    logDebug(req.user, '--- request ----');
    logDebug(req.user, req);
    logDebug(req.user, '-----------------');

    logDebug(req.user, '--- body ----');
    logDebug(req.user, JSON.stringify(resource_incoming));
    logDebug(req.user, '-----------------');
    const uuid = getUuid(resource_incoming);

    if (env.LOG_ALL_SAVES) {
        const currentDate = moment.utc().format('YYYY-MM-DD');
        await sendToS3('logs',
            resource_name,
            resource_incoming,
            currentDate,
            uuid,
            'create'
        );
    }

    const combined_args = get_all_args(req, args);
    if (env.VALIDATE_SCHEMA || combined_args['_validate']) {
        logDebug(req.user, '--- validate schema ----');
        const operationOutcome = validateResource(resource_incoming, resource_name, req.path);
        if (operationOutcome && operationOutcome.statusCode === 400) {
            const currentDate = moment.utc().format('YYYY-MM-DD');
            operationOutcome.expression = [
                resource_name + '/' + uuid
            ];
            await sendToS3('validation_failures',
                resource_name,
                resource_incoming,
                currentDate,
                uuid,
                'create');
            await sendToS3('validation_failures',
                'OperationOutcome',
                operationOutcome,
                currentDate,
                uuid,
                'create_failure');
            throw new NotValidatedError(operationOutcome);
        }
        logDebug(req.user, '-----------------');
    }

    try {
        // Grab an instance of our DB and collection (by version)
        let db = globals.get(CLIENT_DB);
        let collection = db.collection(`${collection_name}_${base_version}`);

        // Get current record
        let Resource = getResource(base_version, resource_name);
        logDebug(req.user, `Resource: ${Resource}`);
        let resource = new Resource(resource_incoming);
        // noinspection JSUnresolvedFunction
        logDebug(req.user, `resource: ${resource.toJSON()}`);

        if (env.CHECK_ACCESS_TAG_ON_SAVE === '1') {
            if (!doesResourceHaveAccessTags(resource)) {
                throw new BadRequestError(new Error('Resource is missing a security access tag with system: https://www.icanbwell.com/access '));
            }
        }

        // If no resource ID was provided, generate one.
        let id = getUuid(resource);
        logDebug(req.user, `id: ${id}`);

        // Create the resource's metadata
        /**
         * @type {function({Object}): Meta}
         */
        let Meta = getMeta(base_version);
        if (!resource_incoming.meta) {
            resource_incoming.meta = new Meta({
                versionId: '1',
                lastUpdated: moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'),
            });
        } else {
            resource_incoming.meta['versionId'] = '1';
            resource_incoming.meta['lastUpdated'] = moment.utc().format('YYYY-MM-DDTHH:mm:ssZ');
        }

        // Create the document to be inserted into Mongo
        // noinspection JSUnresolvedFunction
        let doc = JSON.parse(JSON.stringify(resource.toJSON()));
        Object.assign(doc, {id: id});

        // Create a clone of the object without the _id parameter before assigning a value to
        // the _id parameter in the original document
        let history_doc = Object.assign({}, doc);
        Object.assign(doc, {_id: id});

        logDebug(req.user, '---- inserting doc ---');
        logDebug(req.user, doc);
        logDebug(req.user, '----------------------');

        // Insert our resource record
        try {
            await collection.insertOne(doc);
        } catch (e) {
            // noinspection ExceptionCaughtLocallyJS
            throw new BadRequestError(e);
        }
        // Save the resource to history
        let history_collection = db.collection(`${collection_name}_${base_version}_History`);

        // Insert our resource record to history but don't assign _id
        await history_collection.insertOne(history_doc);
        return {id: doc.id, resource_version: doc.meta.versionId};
    } catch (e) {
        const currentDate = moment.utc().format('YYYY-MM-DD');
        logger.error(`Error with creating resource ${resource_name} with id: ${uuid} `, e);

        await sendToS3('errors',
            resource_name,
            resource_incoming,
            currentDate,
            uuid,
            'create');
        throw e;
    }
};

/**
 * does a FHIR Update (PUT)
 * @param {string[]} args
 * @param {IncomingMessage} req
 * @param {string} resource_name
 * @param {string} collection_name
 */
module.exports.update = async (args, {req}, resource_name, collection_name) => {
    logRequest(req.user, `'${resource_name} >>> update`);

    verifyHasValidScopes(resource_name, 'write', req.user, req.authInfo && req.authInfo.scope);

    logDebug(req.user, '--- request ----');
    logDebug(req.user, req);

    // read the incoming resource from request body
    let resource_incoming = req.body;
    let {base_version, id} = args;
    logDebug(req.user, base_version);
    logDebug(req.user, id);
    logDebug(req.user, '--- body ----');
    logDebug(req.user, JSON.stringify(resource_incoming));

    if (env.LOG_ALL_SAVES) {
        const currentDate = moment.utc().format('YYYY-MM-DD');
        await sendToS3('logs',
            resource_name,
            resource_incoming,
            currentDate,
            id,
            'update');
    }

    const combined_args = get_all_args(req, args);
    if (env.VALIDATE_SCHEMA || combined_args['_validate']) {
        logDebug(req.user, '--- validate schema ----');
        const operationOutcome = validateResource(resource_incoming, resource_name, req.path);
        if (operationOutcome && operationOutcome.statusCode === 400) {
            const currentDate = moment.utc().format('YYYY-MM-DD');
            const uuid = getUuid(resource_incoming);
            operationOutcome.expression = [
                resource_name + '/' + uuid
            ];
            await sendToS3('validation_failures',
                resource_name,
                resource_incoming,
                currentDate,
                uuid,
                'update');
            await sendToS3('validation_failures',
                resource_name,
                operationOutcome,
                currentDate,
                uuid,
                'update_failure');
            throw new NotValidatedError(operationOutcome);
        }
        logDebug(req.user, '-----------------');
    }

    try {
        // Grab an instance of our DB and collection
        let db = globals.get(CLIENT_DB);
        let collection = db.collection(`${collection_name}_${base_version}`);

        // Get current record
        // Query our collection for this observation
        // noinspection JSUnresolvedVariable
        const data = await collection.findOne({id: id.toString()});
        // create a resource with incoming data
        let Resource = getResource(base_version, resource_name);

        let cleaned;
        let doc;

        // check if resource was found in database or not
        // noinspection JSUnresolvedVariable
        if (data && data.meta) {
            // found an existing resource
            logDebug(req.user, 'found resource: ' + data);
            let foundResource = new Resource(data);
            if (!(isAccessToResourceAllowedBySecurityTags(foundResource, req))) {
                throw new ForbiddenError(
                    'user ' + req.user + ' with scopes [' + req.authInfo.scope + '] has no access to resource ' +
                    foundResource.resourceType + ' with id ' + id);
            }

            logDebug(req.user, '------ found document --------');
            logDebug(req.user, data);
            logDebug(req.user, '------ end found document --------');

            // use metadata of existing resource (overwrite any passed in metadata)
            resource_incoming.meta = foundResource.meta;
            logDebug(req.user, '------ incoming document --------');
            logDebug(req.user, resource_incoming);
            logDebug(req.user, '------ end incoming document --------');

            // now create a patch between the document in db and the incoming document
            //  this returns an array of patches
            let patchContent = compare(data, resource_incoming);
            // ignore any changes to _id since that's an internal field
            patchContent = patchContent.filter(item => item.path !== '/_id');
            logDebug(req.user, '------ patches --------');
            logDebug(req.user, patchContent);
            logDebug(req.user, '------ end patches --------');
            // see if there are any changes
            if (patchContent.length === 0) {
                logDebug(req.user, 'No changes detected in updated resource');
                return {
                    id: id,
                    created: false,
                    resource_version: foundResource.meta.versionId,
                };
            }
            if (env.LOG_ALL_SAVES) {
                const currentDate = moment.utc().format('YYYY-MM-DD');
                await sendToS3('logs',
                    resource_name,
                    patchContent,
                    currentDate,
                    id,
                    'update_patch');
            }
            // now apply the patches to the found resource
            let patched_incoming_data = applyPatch(data, patchContent).newDocument;
            let patched_resource_incoming = new Resource(patched_incoming_data);
            // update the metadata to increment versionId
            /**
             * @type {Meta}
             */
            let meta = foundResource.meta;
            meta.versionId = `${parseInt(foundResource.meta.versionId) + 1}`;
            meta.lastUpdated = moment.utc().format('YYYY-MM-DDTHH:mm:ssZ');
            patched_resource_incoming.meta = meta;
            logDebug(req.user, '------ patched document --------');
            logDebug(req.user, patched_resource_incoming);
            logDebug(req.user, '------ end patched document --------');
            // Same as update from this point on
            cleaned = JSON.parse(JSON.stringify(patched_resource_incoming));
            doc = Object.assign(cleaned, {_id: id});
            check_fhir_mismatch(cleaned, patched_incoming_data);
        } else {
            // not found so insert
            logDebug(req.user, 'update: new resource: ' + resource_incoming);
            if (env.CHECK_ACCESS_TAG_ON_SAVE === '1') {
                if (!doesResourceHaveAccessTags(resource_incoming)) {
                    throw new BadRequestError(new Error('Resource is missing a security access tag with system: https://www.icanbwell.com/access '));
                }
            }

            // create the metadata
            let Meta = getMeta(base_version);
            if (!resource_incoming.meta) {
                resource_incoming.meta = new Meta({
                    versionId: '1',
                    lastUpdated: moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'),
                });
            } else {
                resource_incoming.meta['versionId'] = '1';
                resource_incoming.meta['lastUpdated'] = moment.utc().format('YYYY-MM-DDTHH:mm:ssZ');
            }

            cleaned = JSON.parse(JSON.stringify(resource_incoming));
            doc = Object.assign(cleaned, {_id: id});
        }

        // Insert/update our resource record
        // When using the $set operator, only the specified fields are updated
        const res = await collection.findOneAndUpdate({id: id}, {$set: doc}, {upsert: true});
        // save to history
        let history_collection = db.collection(`${collection_name}_${base_version}_History`);

        // let history_resource = Object.assign(cleaned, {id: id});
        let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});
        // delete history_resource['_id']; // make sure we don't have an _id field when inserting into history

        // Insert our resource record to history but don't assign _id
        await history_collection.insertOne(history_resource);

        return {
            id: id,
            created: res.lastErrorObject && !res.lastErrorObject.updatedExisting,
            resource_version: doc.meta.versionId,
        };
    } catch (e) {
        const currentDate = moment.utc().format('YYYY-MM-DD');
        logger.error(`Error with updating resource ${resource_name}.update with id: ${id} `, e);

        await sendToS3('errors',
            resource_name,
            resource_incoming,
            currentDate,
            id,
            'update');
        throw e;
    }
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
    /**
     * @type {string}
     */
    const scope = req.authInfo && req.authInfo.scope;
    logRequest(req.user, `'${resource_name} >>> merge` + ' scopes:' + scope);

    /**
     * @type {string[]}
     */
    const scopes = parseScopes(scope);

    verifyHasValidScopes(resource_name, 'write', req.user, scope);

    // read the incoming resource from request body
    /**
     * @type {Object[]}
     */
    let resources_incoming = req.body;
    logDebug(req.user, JSON.stringify(args));
    /**
     * @type {String}
     */
    let {base_version} = args;

    // logDebug('--- request ----');
    // logDebug(req);
    // logDebug('-----------------');

    // Assign a random number to this batch request
    /**
     * @type {string}
     */
    const requestId = Math.random().toString(36).substring(0, 5);
    /**
     * @type {string}
     */
    const currentDate = moment.utc().format('YYYY-MM-DD');

    logDebug(req.user, '--- body ----');
    logDebug(req.user, JSON.stringify(resources_incoming));
    logDebug(req.user, '-----------------');

    async function preMergeChecks(resourceToMerge) {
        let id = resourceToMerge.id;
        if (!(resourceToMerge.resourceType)) {
            /**
             * @type {OperationOutcome}
             */
            const operationOutcome = {
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'exception',
                        details: {
                            text: 'Error merging: ' + JSON.stringify(resourceToMerge)
                        },
                        diagnostics: 'resource is missing resourceType',
                        expression: [
                            resource_name + '/' + id
                        ]
                    }
                ]
            };
            return {
                id: id,
                created: false,
                updated: false,
                issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
                operationOutcome: operationOutcome
            };
        }

        const combined_args = get_all_args(req, args);
        if (isTrue(env.AUTH_ENABLED)) {
            let {success} = scopeChecker(resourceToMerge.resourceType, 'write', scopes);
            if (!success) {
                const operationOutcome = {
                    resourceType: 'OperationOutcome',
                    issue: [
                        {
                            severity: 'error',
                            code: 'exception',
                            details: {
                                text: 'Error merging: ' + JSON.stringify(resourceToMerge)
                            },
                            diagnostics: 'user ' + req.user + ' with scopes [' + scopes + '] failed access check to [' + resourceToMerge.resourceType + '.' + 'write' + ']',
                            expression: [
                                resourceToMerge.resourceType + '/' + id
                            ]
                        }
                    ]
                };
                return {
                    id: id,
                    created: false,
                    updated: false,
                    issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
                    operationOutcome: operationOutcome
                };
            }
        }

        if (env.VALIDATE_SCHEMA || combined_args['_validate']) {
            logDebug(req.user, '--- validate schema ----');
            /**
             * @type {?OperationOutcome}
             */
            const operationOutcome = validateResource(resourceToMerge, resourceToMerge.resourceType, req.path);
            if (operationOutcome && operationOutcome.statusCode === 400) {
                operationOutcome['expression'] = [
                    resourceToMerge.resourceType + '/' + id
                ];
                if (!(operationOutcome['details']) || !(operationOutcome['details']['text'])) {
                    operationOutcome['details'] = {
                        text: ''
                    };
                }
                operationOutcome['details']['text'] = operationOutcome['details']['text'] + ',' + JSON.stringify(resourceToMerge);

                await sendToS3('validation_failures',
                    resourceToMerge.resourceType,
                    resourceToMerge,
                    currentDate,
                    id,
                    'merge');
                await sendToS3('validation_failures',
                    resourceToMerge.resourceType,
                    operationOutcome,
                    currentDate,
                    id,
                    'merge_failure');
                return {
                    id: id,
                    created: false,
                    updated: false,
                    issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
                    operationOutcome: operationOutcome
                };
            }
            logDebug(req.user, '-----------------');
        }

        if (env.CHECK_ACCESS_TAG_ON_SAVE === '1') {
            if (!doesResourceHaveAccessTags(resourceToMerge)) {
                const operationOutcome = {
                    resourceType: 'OperationOutcome',
                    issue: [
                        {
                            severity: 'error',
                            code: 'exception',
                            details: {
                                text: 'Error merging: ' + JSON.stringify(resourceToMerge)
                            },
                            diagnostics: 'Resource is missing a meta.security tag with system: https://www.icanbwell.com/access',
                            expression: [
                                resourceToMerge.resourceType + '/' + id
                            ]
                        }
                    ]
                };
                return {
                    id: id,
                    created: false,
                    updated: false,
                    issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
                    operationOutcome: operationOutcome
                };
            }
        }

        return false;
    }

    async function performMergeDbUpdate(resourceToMerge, doc, cleaned) {
        let id = resourceToMerge.id;
        /**
         * @type {import('mongodb').Db}
         */
        let db = globals.get(CLIENT_DB);
        /**
         * @type {import('mongodb').Collection}
         */
        let collection = db.collection(`${resourceToMerge.resourceType}_${base_version}`);
        // Insert/update our resource record
        // When using the $set operator, only the specified fields are updated
        /**
         * @type {Object}
         */
        let res = await collection.findOneAndUpdate({id: id.toString()}, {$set: doc}, {upsert: true});

        // save to history
        /**
         * @type {import('mongodb').Collection}
         */
        let history_collection = db.collection(`${collection_name}_${base_version}_History`);
        /**
         * @type {import('mongodb').Document}
         */
        let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});
        /**
         * @type {boolean}
         */
        const created_entity = res.lastErrorObject && !res.lastErrorObject.updatedExisting;
        // Insert our resource record to history but don't assign _id
        delete history_resource['_id']; // make sure we don't have an _id field when inserting into history
        await history_collection.insertOne(history_resource);
        return {
            id: id,
            created: created_entity,
            updated: res.lastErrorObject.updatedExisting,
            resource_version: doc.meta.versionId
        };
    }

    async function mergeExisting(resourceToMerge, data) {
        let id = resourceToMerge.id;
        // create a resource with incoming data
        /**
         * @type {function({Object}):Resource}
         */
        let Resource = getResource(base_version, resourceToMerge.resourceType);

        // found an existing resource
        logDebug(req.user, resourceToMerge.resourceType + ': merge found resource ' + '[' + data.id + ']: ' + JSON.stringify(data));
        /**
         * @type {Resource}
         */
        let foundResource = new Resource(data);
        logDebug(req.user, '------ found document --------');
        logDebug(req.user, data);
        logDebug(req.user, '------ end found document --------');
        // use metadata of existing resource (overwrite any passed in metadata)
        if (!resourceToMerge.meta) {
            resourceToMerge.meta = {};
        }
        // compare without checking source so we don't create a new version just because of a difference in source
        /**
         * @type {string}
         */
        const original_source = resourceToMerge.meta.source;
        resourceToMerge.meta.versionId = foundResource.meta.versionId;
        resourceToMerge.meta.lastUpdated = foundResource.meta.lastUpdated;
        resourceToMerge.meta.source = foundResource.meta.source;
        logDebug(req.user, '------ incoming document --------');
        logDebug(req.user, resourceToMerge);
        logDebug(req.user, '------ end incoming document --------');

        /**
         * @type {Object}
         */
        const my_data = deepcopy(data);
        delete my_data['_id']; // remove _id since that is an internal

        // for speed, first check if the incoming resource is exactly the same
        if (deepEqual(my_data, resourceToMerge) === true) {
            logDebug(req.user, 'No changes detected in updated resource');
            return {
                id: id,
                created: false,
                updated: false,
                resource_version: foundResource.meta.versionId,
                message: 'No changes detected in updated resource'
            };
        }

        let mergeObjectOrArray;

        /**
         * @type {{customMerge: (function(*): *)}}
         */
            // noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
        const options = {
                // eslint-disable-next-line no-unused-vars
                customMerge: (/*key*/) => {
                    return mergeObjectOrArray;
                }
            };

        /**
         * @param {?Object | Object[]} oldItem
         * @param {?Object | Object[]} newItem
         * @return {?Object | Object[]}
         */
        mergeObjectOrArray = (oldItem, newItem) => {
            if (deepEqual(oldItem, newItem)) {
                return oldItem;
            }
            if (Array.isArray(oldItem)) {
                /**
                 * @type {? Object[]}
                 */
                let result_array = null;
                // iterate through all the new array and find any items that are not present in old array
                for (let i = 0; i < newItem.length; i++) {
                    /**
                     * @type {Object}
                     */
                    let my_item = newItem[`${i}`];

                    if (my_item === null) {
                        continue;
                    }

                    // if newItem[i] does not matches any item in oldItem then insert
                    if (oldItem.every(a => deepEqual(a, my_item) === false)) {
                        if (typeof my_item === 'object' && 'id' in my_item) {
                            // find item in oldItem array that matches this one by id
                            /**
                             * @type {number}
                             */
                            const matchingOldItemIndex = oldItem.findIndex(x => x['id'] === my_item['id']);
                            if (matchingOldItemIndex > -1) {
                                // check if id column exists and is the same
                                //  then recurse down and merge that item
                                if (result_array === null) {
                                    result_array = deepcopy(oldItem); // deep copy so we don't change the original object
                                }
                                result_array[`${matchingOldItemIndex}`] = deepmerge(oldItem[`${matchingOldItemIndex}`], my_item, options);
                                continue;
                            }
                        }
                        // insert based on sequence if present
                        if (typeof my_item === 'object' && 'sequence' in my_item) {
                            /**
                             * @type {Object[]}
                             */
                            result_array = [];
                            // go through the list until you find a sequence number that is greater than the new
                            // item and then insert before it
                            /**
                             * @type {number}
                             */
                            let index = 0;
                            /**
                             * @type {boolean}
                             */
                            let insertedItem = false;
                            while (index < oldItem.length) {
                                /**
                                 * @type {Object}
                                 */
                                const element = oldItem[`${index}`];
                                // if item has not already been inserted then insert before the next sequence
                                if (!insertedItem && (element['sequence'] > my_item['sequence'])) {
                                    result_array.push(my_item); // add the new item before
                                    result_array.push(element); // then add the old item
                                    insertedItem = true;
                                } else {
                                    result_array.push(element); // just add the old item
                                }
                                index += 1;
                            }
                            if (!insertedItem) {
                                // if no sequence number greater than this was found then add at the end
                                result_array.push(my_item);
                            }
                        } else {
                            // no sequence property is set on this item so just insert at the end
                            if (result_array === null) {
                                result_array = deepcopy(oldItem); // deep copy so we don't change the original object
                            }
                            result_array.push(my_item);
                        }
                    }
                }
                if (result_array !== null) {
                    return result_array;
                } else {
                    return oldItem;
                }
            }
            return deepmerge(oldItem, newItem, options);
        };

        // data seems to get updated below
        /**
         * @type {Object}
         */
        let resource_merged = deepmerge(data, resourceToMerge, options);

        // now create a patch between the document in db and the incoming document
        //  this returns an array of patches
        /**
         * @type {Operation[]}
         */
        let patchContent = compare(data, resource_merged);
        // ignore any changes to _id since that's an internal field
        patchContent = patchContent.filter(item => item.path !== '/_id');
        logDebug(req.user, '------ patches --------');
        logDebug(req.user, patchContent);
        logDebug(req.user, '------ end patches --------');
        // see if there are any changes
        if (patchContent.length === 0) {
            logDebug(req.user, 'No changes detected in updated resource');
            return {
                id: id,
                created: false,
                updated: false,
                resource_version: foundResource.meta.versionId,
                message: 'No changes detected in updated resource'
            };
        }
        if (!(isAccessToResourceAllowedBySecurityTags(foundResource, req))) {
            throw new ForbiddenError(
                'user ' + req.user + ' with scopes [' + req.authInfo.scope + '] has no access to resource ' +
                foundResource.resourceType + ' with id ' + id);
        }
        logRequest(req.user, `${resourceToMerge.resourceType} >>> merging ${id}`);
        // now apply the patches to the found resource
        // noinspection JSCheckFunctionSignatures
        /**
         * @type {Object}
         */
        let patched_incoming_data = applyPatch(data, patchContent).newDocument;
        /**
         * @type {Object}
         */
        let patched_resource_incoming = new Resource(patched_incoming_data);
        // update the metadata to increment versionId
        /**
         * @type {{versionId: string, lastUpdated: string, source: string}}
         */
        let meta = foundResource.meta;
        meta.versionId = `${parseInt(foundResource.meta.versionId) + 1}`;
        meta.lastUpdated = moment.utc().format('YYYY-MM-DDTHH:mm:ssZ');
        // set the source from the incoming resource
        meta.source = original_source;
        // These properties are set automatically
        patched_resource_incoming.meta.versionId = meta.versionId;
        patched_resource_incoming.meta.lastUpdated = meta.lastUpdated;
        // If not source is provided then use the source of the previous entity
        if (!(patched_resource_incoming.meta.source)) {
            patched_resource_incoming.meta.source = meta.source;
        }
        // If no security tags are provided then use the source of the previous entity
        if (!(patched_resource_incoming.meta.security)) {
            patched_resource_incoming.meta.security = meta.security;
        }
        logDebug(req.user, '------ patched document --------');
        logDebug(req.user, patched_resource_incoming);
        logDebug(req.user, '------ end patched document --------');
        // Same as update from this point on
        const cleaned = JSON.parse(JSON.stringify(patched_resource_incoming));
        check_fhir_mismatch(cleaned, patched_incoming_data);
        const doc = Object.assign(cleaned, {_id: id});
        if (env.LOG_ALL_MERGES) {
            await sendToS3('logs',
                resourceToMerge.resourceType,
                {
                    'old': data,
                    'new': resourceToMerge,
                    'patch': patchContent,
                    'after': doc
                },
                currentDate,
                id,
                'merge_' + meta.versionId + '_' + requestId);
        }
        return await performMergeDbUpdate(resourceToMerge, doc, cleaned);
    }

    async function mergeInsert(resourceToMerge) {
        let id = resourceToMerge.id;
        // not found so insert
        logDebug(req.user,
            resourceToMerge.resourceType +
            ': merge new resource ' +
            '[' + resourceToMerge.id + ']: '
            + JSON.stringify(resourceToMerge)
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
            let Meta = getMeta(base_version);
            resourceToMerge.meta = new Meta({
                versionId: '1',
                lastUpdated: moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'),
            });
        } else {
            resourceToMerge.meta.versionId = '1';
            resourceToMerge.meta.lastUpdated = moment.utc().format('YYYY-MM-DDTHH:mm:ssZ');
        }

        const cleaned = JSON.parse(JSON.stringify(resourceToMerge));
        const doc = Object.assign(cleaned, {_id: id});

        return await performMergeDbUpdate(resourceToMerge, doc, cleaned);
    }

    // this function is called for each resource
    // returns an OperationOutcome
    /**
     * Merges a single resource
     * @param {Object} resource_to_merge
     * @return {Promise<{operationOutcome: ?OperationOutcome, issue: {severity: string, diagnostics: string, code: string, expression: [string], details: {text: string}}, created: boolean, id: String, updated: boolean}>}
     */
    async function merge_resource(resource_to_merge) {
        /**
         * @type {String}
         */
        let id = resource_to_merge.id;

        if (env.LOG_ALL_SAVES) {
            await sendToS3('logs',
                resource_to_merge.resourceType,
                resource_to_merge,
                currentDate,
                id,
                'merge_' + requestId);
        }

        const preMergeCheckFailures = await preMergeChecks(resource_to_merge);
        if (preMergeCheckFailures) {
            return preMergeCheckFailures;
        }

        try {
            logDebug(req.user, '-----------------');
            logDebug(req.user, base_version);
            logDebug(req.user, '--- body ----');
            logDebug(req.user, resource_to_merge);

            // Grab an instance of our DB and collection
            /**
             * @type {import('mongodb').Db}
             */
            let db = globals.get(CLIENT_DB);
            /**
             * @type {import('mongodb').Collection}
             */
            let collection = db.collection(`${resource_to_merge.resourceType}_${base_version}`);

            // Query our collection for this id
            /**
             * @type {Object}
             */
            let data = await collection.findOne({id: id.toString()});

            logDebug('test?', '------- data -------');
            logDebug('test?', `${resource_to_merge.resourceType}_${base_version}`);
            logDebug('test?', data);
            logDebug('test?', '------- end data -------');

            let res;

            // check if resource was found in database or not
            // noinspection JSUnusedLocalSymbols
            if (data && data.meta) {
                res = await mergeExisting(resource_to_merge, data);
            } else {
                res = await mergeInsert(resource_to_merge);
            }

            return res;
        } catch (e) {
            logger.error(`Error with merging resource ${resource_to_merge.resourceType}.merge with id: ${id} `, e);
            const operationOutcome = {
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'exception',
                        details: {
                            text: 'Error merging: ' + JSON.stringify(resource_to_merge)
                        },
                        diagnostics: e.toString(),
                        expression: [
                            resource_to_merge.resourceType + '/' + id
                        ]
                    }
                ]
            };
            await sendToS3('errors',
                resource_to_merge.resourceType,
                resource_to_merge,
                currentDate,
                id,
                'merge');
            await sendToS3('errors',
                resource_to_merge.resourceType,
                operationOutcome,
                currentDate,
                id,
                'merge_error');
            return {
                id: id,
                created: false,
                updated: false,
                issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
                operationOutcome: operationOutcome
            };
        }
    }

    /**
     * Tries to merge and retries if there is an error to protect against race conditions where 2 calls are happening
     *  in parallel for the same resource. Both of them see that the resource does not exist, one of them inserts it
     *  and then the other ones tries to insert too
     * @param {Object} resource_to_merge
     * @return {Promise<{operationOutcome: ?OperationOutcome, issue: {severity: string, diagnostics: string, code: string, expression: [string], details: {text: string}}, created: boolean, id: String, updated: boolean}>}
     */
    /**
     * merges resources and retries on error
     * @param resource_to_merge
     * @return {Promise<{operationOutcome: ?OperationOutcome, issue: {severity: string, diagnostics: string, code: string, expression: [string], details: {text: string}}, created: boolean, id: String, updated: boolean}>}
     */
    async function merge_resource_with_retry(resource_to_merge) {
        let triesLeft = 2;

        do {
            try {
                return await merge_resource(resource_to_merge);
            } catch (e) {
                triesLeft = triesLeft - 1;
            }
        } while (triesLeft >= 0);
    }

    // if the incoming request is a bundle then unwrap the bundle
    if ((!(Array.isArray(resources_incoming))) && resources_incoming['resourceType'] === 'Bundle') {
        logDebug(req.user, '--- validate schema of Bundle ----');
        const operationOutcome = validateResource(resources_incoming, 'Bundle', req.path);
        if (operationOutcome && operationOutcome.statusCode === 400) {
            return operationOutcome;
        }
        // unwrap the resources
        resources_incoming = resources_incoming.entry.map(e => e.resource);
    }
    if (Array.isArray(resources_incoming)) {
        const ids_of_resources = resources_incoming.map(r => r.id);
        logRequest(req.user,
            '==================' + resource_name + ': Merge received array ' +
            ', len= ' + resources_incoming.length +
            ' [' + ids_of_resources.toString() + '] ' +
            '===================='
        );
        // find items without duplicates and run them in parallel
        // but items with duplicate ids should run in serial so we can merge them properly (otherwise the first item
        //  may not finish adding to the db before the next item tries to merge
        // https://stackoverflow.com/questions/53212020/get-list-of-duplicate-objects-in-an-array-of-objects
        // create a lookup_by_id for duplicate ids
        /**
         * @type {Object}
         */
        const lookup_by_id = resources_incoming.reduce((a, e) => {
            a[e.id] = ++a[e.id] || 0;
            return a;
        }, {});
        /**
         * @type {Object[]}
         */
        const duplicate_id_resources = resources_incoming.filter(e => lookup_by_id[e.id]);
        /**
         * @type {Object[]}
         */
        const non_duplicate_id_resources = resources_incoming.filter(e => !lookup_by_id[e.id]);

        const result = await Promise.all([
            async.map(non_duplicate_id_resources, async x => await merge_resource_with_retry(x)), // run in parallel
            async.mapSeries(duplicate_id_resources, async x => await merge_resource_with_retry(x)) // run in series
        ]);
        const returnVal = result.flat(1);
        logDebug(req.user, '--- Merge array result ----');
        logDebug(req.user, JSON.stringify(returnVal));
        logDebug(req.user, '-----------------');
        return returnVal;
    } else {
        const returnVal = await merge_resource_with_retry(resources_incoming);
        logDebug(req.user, '--- Merge result ----');
        logDebug(req.user, JSON.stringify(returnVal));
        logDebug(req.user, '-----------------');
        return returnVal;
    }
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
