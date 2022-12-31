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
const {omitPropertyFromResource} = require('../../utils/omitProperties');
const {DatabaseBulkInserter} = require('../../dataLayer/databaseBulkInserter');
const {getCircularReplacer} = require('../../utils/getCircularReplacer');

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
        const {requestId, method} = requestInfo;
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
            accessRequested: 'read'
        });

        try {

            const currentDate = moment.utc().format('YYYY-MM-DD');
            let {base_version, id, patchContent} = args;
            // Get current record
            // Query our collection for this observation
            let data;
            try {
                const databaseQueryManager = this.databaseQueryFactory.createQuery(
                    {resourceType, base_version}
                );
                data = await databaseQueryManager.findOneAsync({query: {id: id.toString()}});
            } catch (e) {
                throw new NotFoundError(new Error(`Resource not found: ${resourceType}/${id}`));
            }
            if (!data) {
                throw new NotFoundError('Resource not found');
            }
            // Validate the patch
            let errors = validate(patchContent, data);
            if (errors && Object.keys(errors).length > 0) {
                throw new BadRequestError(errors[0]);
            }
            // Make the changes indicated in the patch
            let resource_incoming = applyPatch(data, patchContent).newDocument;

            let ResourceCreator = getResource(base_version, resourceType);
            let resource = new ResourceCreator(resource_incoming);
            /**
             * @type {Resource}
             */
            let foundResource;

            if (data && data.meta) {
                foundResource = new ResourceCreator(data);
                let meta = foundResource.meta;
                // noinspection JSUnresolvedVariable
                meta.versionId = `${parseInt(foundResource.meta.versionId) + 1}`;
                meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
                resource.meta = meta;
            } else {
                throw new BadRequestError(new Error('Unable to patch resource. Missing either data or metadata.'));
            }

            // Same as update from this point on
            /**
             * @type {Resource}
             */
            let doc = resource;

            // Insert/update our resource record
            /**
             * @type {{error: import('mongodb').Document, created: boolean} | null}
             */
            let res;
            doc = omitPropertyFromResource(doc, '_id');

            await this.databaseBulkInserter.replaceOneAsync(
                {
                    requestId, resourceType, id, doc,
                    previousVersionId: foundResource.meta.versionId,
                    patches: null // TODO: convert passed in patches to MergePatchEntry
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
                        requestId, eventType: 'U', resourceType, doc
                    });
                    await this.changeEventProducer.flushAsync({requestId});
                }
            });

            return {
                id: doc.id,
                created: res.lastErrorObject && !res.lastErrorObject.updatedExisting,
                resource_version: doc.meta.versionId,
                resource: doc
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
