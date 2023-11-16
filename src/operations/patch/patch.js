// noinspection ExceptionCaughtLocallyJS

const {BadRequestError, NotFoundError} = require('../../utils/httpErrors');
const {validate, applyPatch, compare} = require('fast-json-patch');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {PostRequestProcessor} = require('../../utils/postRequestProcessor');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {DatabaseBulkInserter} = require('../../dataLayer/databaseBulkInserter');
const {getCircularReplacer} = require('../../utils/getCircularReplacer');
const {fhirContentTypes} = require('../../utils/contentTypes');
const {ParsedArgs} = require('../query/parsedArgs');
const {FhirResourceCreator} = require('../../fhir/fhirResourceCreator');
const {DatabaseAttachmentManager} = require('../../dataLayer/databaseAttachmentManager');
const {ConfigManager} = require('../../utils/configManager');
const {DELETE, RETRIEVE} = require('../../constants').GRIDFS;
const { BwellPersonFinder } = require('../../utils/bwellPersonFinder');
const {PostSaveProcessor} = require('../../dataLayer/postSaveProcessor');
const { isTrue } = require('../../utils/isTrue');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { SearchManager } = require('../search/searchManager');

class PatchOperation {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {PostSaveProcessor} postSaveProcessor
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {ConfigManager} configManager
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {SearchManager} searchManager
     */
    constructor(
        {
            databaseQueryFactory,
            postSaveProcessor,
            postRequestProcessor,
            fhirLoggingManager,
            scopesValidator,
            databaseBulkInserter,
            databaseAttachmentManager,
            configManager,
            bwellPersonFinder,
            searchManager
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);
        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);

        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);
    }

    /**
     * does a FHIR Patch
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<{id: string,created: boolean, resource_version: string, resource: Resource}>}
     */
    async patchAsync({requestInfo, parsedArgs, resourceType}) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'patch';
        const extraInfo = {
            currentOperationName: currentOperationName
        };
        const {
            requestId,
            method,
            body: patchContent,
            /** @type {import('content-type').ContentType} */ contentTypeFromHeader,
            /**@type {string} */ userRequestId,
            user,
            /**@type {string | null} */ scope,
            /** @type {string[]} */
            patientIdsFromJwtToken,
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken,
        } = requestInfo;

        // currently we only support JSONPatch
        if (!contentTypeFromHeader || contentTypeFromHeader.type !== fhirContentTypes.jsonPatch) {
            const message = `Content-Type ${contentTypeFromHeader ? contentTypeFromHeader.type : ''} ` +
                'is not supported for patch. ' +
                `Only ${fhirContentTypes.jsonPatch} is supported.`;
            throw new BadRequestError(
                {
                    'message': message,
                    toString: function () {
                        return message;
                    }
                }
            );
        }

        /**
         * @type {number}
         */
        const startTime = Date.now();

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'write'
        });

        try {

            const currentDate = moment.utc().format('YYYY-MM-DD');
            // http://hl7.org/fhir/http.html#patch
            // patchContent is passed in JSON Patch format https://jsonpatch.com/
            let {base_version, id} = parsedArgs;
            // Get current record
            // Query our collection for this observation
            /**
             * @type {Resource}
             */
            let foundResource;
            /**
             * @type {boolean}
             */
            const useAccessIndex = (this.configManager.useAccessIndex || isTrue(parsedArgs['_useAccessIndex']));

            /**
             * @type {{base_version, columns: Set, query: import('mongodb').Document}}
             */
            const {
                /** @type {import('mongodb').Document}**/
                query,
                // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync({
                user,
                scope,
                isUser,
                patientIdsFromJwtToken,
                resourceType,
                useAccessIndex,
                personIdFromJwtToken,
                parsedArgs,
            });
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                { resourceType, base_version },
            );
            /**
             * @type {DatabasePartitionedCursor}
             */
            let cursor = await databaseQueryManager.findAsync({ query: query, extraInfo });
            /**
             * @type {[Resource] | null}
             */
            let resources = await cursor.toArrayAsync();

            if (resources.length > 1) {
                const sourceAssigningAuthorities = resources.flatMap(
                    r => r.meta && r.meta.security ?
                        r.meta.security
                            .filter(tag => tag.system === SecurityTagSystem.sourceAssigningAuthority)
                            .map(tag => tag.code)
                        : [],
                ).sort();
                throw new BadRequestError(new Error(
                    `Multiple resources found with id ${id}.  ` +
                    'Please either specify the owner/sourceAssigningAuthority tag: ' +
                    sourceAssigningAuthorities.map(sa => `${id}|${sa}`).join(' or ') +
                    ' OR use uuid to query.',
                ));
            } else if (resources.length === 0) {
                throw new NotFoundError(new Error(`Resource not found: ${resourceType}/${id}`));
            }
            foundResource = resources[0];
            if (!foundResource) {
                throw new NotFoundError('Resource not found');
            }
            const originalResource = foundResource.clone();
            foundResource = await this.databaseAttachmentManager.transformAttachments(
                foundResource, RETRIEVE, patchContent
            );

            // Validate the patch
            let errors = validate(patchContent, foundResource);
            if (errors) {
                const error = Array.isArray(errors) && errors.length && errors.find(e => !!e) ? errors.find(e => !!e) : errors;
                throw new BadRequestError(error);
            }
            // Make the changes indicated in the patch
            /**
             * @type {Object}
             */
            let resource_incoming = applyPatch(foundResource.toJSONInternal(), patchContent).newDocument;
            const appliedPatchContent = compare(foundResource.toJSONInternal(), resource_incoming);
            /**
             * @type {Resource}
             */
            let resource = FhirResourceCreator.createByResourceType(resource_incoming, resourceType);

            // source in metadata must exist either in incoming resource or found resource
            if (foundResource?.meta && (foundResource.meta.source || (resource?.meta?.source))) {
                let meta = foundResource.meta;
                // noinspection JSUnresolvedVariable
                meta.versionId = `${parseInt(foundResource.meta.versionId) + 1}`;
                meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
                meta.source = meta.source || resource.meta.source;
                resource.meta = meta;
            } else {
                throw new BadRequestError(new Error(
                    'Unable to patch resource. Missing either foundResource, metadata or metadata source.'
                ));
            }

            // removing the files that are patched
            await this.databaseAttachmentManager.transformAttachments(
                originalResource, DELETE, appliedPatchContent.filter(patch => patch.op !== 'add')
            );

            // converting attachment.data to attachment._file_id for the response
            resource = await this.databaseAttachmentManager.transformAttachments(resource);

            // Same as update from this point on
            // Insert/update our resource record
            await this.databaseBulkInserter.replaceOneAsync(
                {
                    requestId, resourceType, doc: resource,
                    uuid: resource._uuid,
                    patches: patchContent.map(
                        p => {
                            return {
                                op: p.op,
                                path: p.path,
                                value: p.value
                            };
                        }
                    )
                }
            );
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await this.databaseBulkInserter.executeAsync(
                {
                    requestId, currentDate, base_version: base_version,
                    method,
                    userRequestId,
                }
            );
            if (!mergeResults || mergeResults.length === 0 || (!mergeResults[0].created && !mergeResults[0].updated)) {
                throw new BadRequestError(new Error(JSON.stringify(mergeResults[0].issue, getCircularReplacer())));
            }

            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });


            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => {
                    await this.postSaveProcessor.afterSaveAsync({
                        requestId, eventType: 'U', resourceType, doc: resource
                    });
                }
            });

            // converting attachment._file_id to attachment.data for the response
            resource = await this.databaseAttachmentManager.transformAttachments(resource, RETRIEVE);

            return {
                id: resource.id,
                created: false,
                updated: true,
                resource_version: resource.meta.versionId,
                resource: resource
            };
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: e
                });
            throw e;
        }
    }
}

module.exports = {
    PatchOperation
};
