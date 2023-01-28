// noinspection ExceptionCaughtLocallyJS

const {BadRequestError, NotFoundError} = require('../../utils/httpErrors');
const {validate, applyPatch} = require('fast-json-patch');
const {getResource} = require('../common/getResource');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {ChangeEventProducer} = require('../../utils/changeEventProducer');
const {PostRequestProcessor} = require('../../utils/postRequestProcessor');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {DatabaseBulkInserter} = require('../../dataLayer/databaseBulkInserter');
const {getCircularReplacer} = require('../../utils/getCircularReplacer');
const {fhirContentTypes} = require('../../utils/contentTypes');

class PatchOperation {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ChangeEventProducer} changeEventProducer
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {DatabaseBulkInserter} databaseBulkInserter
     */
    constructor(
        {
            databaseQueryFactory,
            changeEventProducer,
            postRequestProcessor,
            fhirLoggingManager,
            scopesValidator,
            databaseBulkInserter
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {ChangeEventProducer}
         */
        this.changeEventProducer = changeEventProducer;
        assertTypeEquals(changeEventProducer, ChangeEventProducer);
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
    }

    /**
     * does a FHIR Patch
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @returns {{id: string,created: boolean, resource_version: string, resource: Resource}}
     */
    async patch({requestInfo, args, resourceType}) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'patch';
        const {
            requestId,
            method,
            body: patchContent,
            /** @type {import('content-type').ContentType} */ contentTypeFromHeader
        } = requestInfo;

        // currently we only support JSONPatch
        if (!contentTypeFromHeader || contentTypeFromHeader.type !== fhirContentTypes.jsonPatch) {
            const message = `Content-Type ${contentTypeFromHeader ? contentTypeFromHeader.type : ''} ` +
                ' is not supported for patch. ' +
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
            args,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'write'
        });

        try {

            const currentDate = moment.utc().format('YYYY-MM-DD');
            // http://hl7.org/fhir/http.html#patch
            // patchContent is passed in JSON Patch format https://jsonpatch.com/
            let {base_version, id} = args;
            // Get current record
            // Query our collection for this observation
            /**
             * @type {Resource}
             */
            let foundResource;
            try {
                const databaseQueryManager = this.databaseQueryFactory.createQuery(
                    {resourceType, base_version}
                );
                foundResource = await databaseQueryManager.findOneAsync({query: {id: id.toString()}});
            } catch (e) {
                throw new NotFoundError(new Error(`Resource not found: ${resourceType}/${id}`));
            }
            if (!foundResource) {
                throw new NotFoundError('Resource not found');
            }
            // Validate the patch
            let errors = validate(patchContent, foundResource);
            if (errors && Object.keys(errors).length > 0) {
                throw new BadRequestError(errors[0]);
            }
            // Make the changes indicated in the patch
            /**
             * @type {Object}
             */
            let resource_incoming = applyPatch(foundResource.toJSONInternal(), patchContent).newDocument;

            let ResourceCreator = getResource(base_version, resourceType);
            /**
             * @type {Resource}
             */
            let resource = new ResourceCreator(resource_incoming);

            if (foundResource && foundResource.meta) {
                let meta = foundResource.meta;
                // noinspection JSUnresolvedVariable
                meta.versionId = `${parseInt(foundResource.meta.versionId) + 1}`;
                meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
                resource.meta = meta;
            } else {
                throw new BadRequestError(new Error('Unable to patch resource. Missing either foundResource or metadata.'));
            }

            // Same as update from this point on
            // Insert/update our resource record
            await this.databaseBulkInserter.replaceOneAsync(
                {
                    requestId, resourceType, doc: resource,
                    id,
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
                    method
                }
            );
            if (!mergeResults || mergeResults.length === 0 || (!mergeResults[0].created && !mergeResults[0].updated)) {
                throw new BadRequestError(new Error(JSON.stringify(mergeResults[0].issue, getCircularReplacer())));
            }

            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName
                });


            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => {
                    await this.changeEventProducer.fireEventsAsync({
                        requestId, eventType: 'U', resourceType, doc: resource
                    });
                    await this.changeEventProducer.flushAsync({requestId});
                }
            });

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
                    args,
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
