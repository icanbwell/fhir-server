// noinspection ExceptionCaughtLocallyJS

const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {AuditLogger} = require('../../utils/auditLogger');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {ConfigManager} = require('../../utils/configManager');
const {QueryRewriterManager} = require('../../queryRewriters/queryRewriterManager');
const {ParsedArgs} = require('../query/parsedArgs');
const {PostRequestProcessor} = require('../../utils/postRequestProcessor');
const {SearchManager} = require('../search/searchManager');
const {OPERATIONS: {DELETE}} = require('../../constants');
const {logInfo, logWarn} = require('../common/logging');
const { RemoveHelper } = require('./removeHelper');
const { BadRequestError } = require('../../utils/httpErrors');
const { createExtendedGroupDeleteTooCostlyError } = require('../../utils/fhirErrorFactory');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../utils/mongoGroupExtendedTag');
const { MongoGroupMemberRepository } = require('../../dataLayer/repositories/mongoGroupMemberRepository');

class RemoveOperation {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {AuditLogger} auditLogger
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ConfigManager} configManager
     * @param {QueryRewriterManager} queryRewriterManager
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {SearchManager} searchManager
     * @param {RemoveHelper} removeHelper
     * @param {MongoGroupMemberRepository} mongoGroupMemberRepository
     */
    constructor(
        {
            databaseQueryFactory,
            auditLogger,
            fhirLoggingManager,
            scopesValidator,
            configManager,
            queryRewriterManager,
            postRequestProcessor,
            searchManager,
            removeHelper,
            mongoGroupMemberRepository
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);
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
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {QueryRewriterManager}
         */
        this.queryRewriterManager = queryRewriterManager;
        assertTypeEquals(queryRewriterManager, QueryRewriterManager);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        /**
         * @type {RemoveHelper}
         */
        this.removeHelper = removeHelper;
        assertTypeEquals(removeHelper, RemoveHelper);

        /**
         * @type {MongoGroupMemberRepository}
         */
        this.mongoGroupMemberRepository = mongoGroupMemberRepository;
        assertTypeEquals(mongoGroupMemberRepository, MongoGroupMemberRepository);
    }

    /**
     * does a FHIR Remove (DELETE)
     * @param {Object} params
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {ParsedArgs} params.parsedArgs
     * @param {string} params.resourceType
     * @returns {Promise<{deleted: number}>}
     */
    async removeAsync({requestInfo, parsedArgs, resourceType}) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'remove';

        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string|null} */
            user,
            /** @type {string|null} */
            scope,
            /** @type {string|null} */
            requestId,
            /** @type {boolean | null} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken,
            /** @type {boolean} */
            useAccessIndex
        } = requestInfo;

        if (parsedArgs.get('id') &&
            (
                !parsedArgs.get('id').queryParameterValue ||
                parsedArgs.get('id').queryParameterValue.value === '0'
            )
        ) {
            parsedArgs.remove('id');
        }
        if (parsedArgs.get('_id') &&
            (
                !parsedArgs.get('_id').queryParameterValue ||
                parsedArgs.get('_id').queryParameterValue.value === '0'
            )
        ) {
            parsedArgs.remove('_id');
        }

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'write'
        });

        try {
            const {base_version} = parsedArgs;
            const {
                /** @type {import('mongodb').Document}**/
                query
            } = await this.searchManager.constructQueryAsync(
                {
                    user,
                    scope,
                    isUser,
                    resourceType,
                    useAccessIndex,
                    personIdFromJwtToken,
                    parsedArgs,
                    operation: DELETE,
                    accessRequested: 'write'
                }
            );

            if (Object.keys(query).length === 0) {
                // don't delete everything
                return {deleted: 0};
            }
            // Delete our resource record
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                {resourceType, base_version}
            );

            const cursor = await databaseQueryManager.findAsync({query});
            /**
             * @type {string[]}
             */
            const resourceIdsToDelete = [];
            let resourceArrayToDelete = [];

            while (await cursor.hasNext()) {
                const resource = await cursor.nextObject();

                // isAccessToResourceAllowedByAccessAndPatientScopes will throw forbidden error so wrap this under try catch
                try {
                    await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                        requestInfo, resource, base_version
                    });

                    resourceIdsToDelete.push(resource._uuid);
                    resourceArrayToDelete.push(resource);
                } catch (err) {
                    logWarn(`${user} with scope ${scope} is trying to delete ${resource.resourceType}/${resource.id}`);
                }
            }

            await this.cascadeDeleteExtendedGroupMembersAsync({
                requestInfo, base_version, resourceType, resources: resourceArrayToDelete
            });

            const deletedResourceCount = await this.removeHelper.deleteManyAsync({
                requestInfo,
                resources: resourceArrayToDelete,
                resourceType,
                base_version
            });

            if (resourceType !== 'AuditEvent') {
                this.postRequestProcessor.add({
                    requestId,
                    fnTask: async () => {
                        // log access to audit logs
                        await this.auditLogger.logAuditEntryAsync(
                            {
                                requestInfo,
                                base_version,
                                resourceType,
                                operation: 'delete',
                                args: parsedArgs.getRawArgs(),
                                ids: resourceIdsToDelete
                            }
                        );
                    }
                });
            }


            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });
            return {deleted: deletedResourceCount};
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
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

    /**
     * An extended Group's roster lives in GroupMember_4_0_0, not on the Group document, so deleting
     * just the document would orphan those rows. Tombstones and hard-deletes the roster of the
     * extended Group among the resources about to be deleted -- always before the caller deletes
     * the Group itself. No-op for anything other than Group, and for embedded Groups.
     *
     * Rejects, before writing anything, a delete that includes an extended Group while extended
     * Group support is disabled, or that matches more than one extended Group.
     * @param {Object} params
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {string} params.resourceType
     * @param {Resource[]} params.resources - the resources about to be deleted
     * @returns {Promise<void>}
     * @private
     */
    async cascadeDeleteExtendedGroupMembersAsync({requestInfo, base_version, resourceType, resources}) {
        if (resourceType !== 'Group') {
            return;
        }
        const extendedGroups = resources.filter(r => r[MONGO_GROUP_EXTENDED_FIELD] === true);
        if (extendedGroups.length === 0) {
            return;
        }
        if (!this.configManager.enableExtendedGroup) {
            throw new BadRequestError(new Error(
                'Cannot delete an extended Group while extended Group support is disabled'
            ));
        }
        if (extendedGroups.length > 1) {
            const { message, options } = createExtendedGroupDeleteTooCostlyError({
                matched: extendedGroups.length
            });
            throw new BadRequestError({ message }, options);
        }
        await this.mongoGroupMemberRepository.cascadeDeleteForGroupAsync({
            requestInfo, base_version, groupUuid: extendedGroups[0]._uuid
        });
    }
}

module.exports = {
    RemoveOperation
};
