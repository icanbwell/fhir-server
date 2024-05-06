// noinspection ExceptionCaughtLocallyJS

const { NotAllowedError } = require('../../utils/httpErrors');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { AuditLogger } = require('../../utils/auditLogger');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { ConfigManager } = require('../../utils/configManager');
const { QueryRewriterManager } = require('../../queryRewriters/queryRewriterManager');
const { ParsedArgs } = require('../query/parsedArgs');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { SearchManager } = require('../search/searchManager');
const { OPERATIONS: { DELETE } } = require('../../constants');
const { logInfo } = require('../common/logging');

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
     */
    constructor (
        {
            databaseQueryFactory,
            auditLogger,
            fhirLoggingManager,
            scopesValidator,
            configManager,
            queryRewriterManager,
            postRequestProcessor,
            searchManager
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
    }

    /**
     * does a FHIR Remove (DELETE)
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<{deleted: number}>}
     */
    async removeAsync ({ requestInfo, parsedArgs, resourceType }) {
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
            const { base_version } = parsedArgs;
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
                return { deleted: 0 };
            }
            // Delete our resource record
            let res;
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                { resourceType, base_version }
            );

            try {
                res = await databaseQueryManager.findAsync({ query });
                const resourcesToDelete = {};

                while (await res.hasNext()) {
                    const resource = await res.next();

                    // eslint-disable-next-line no-useless-catch
                    try {
                        await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                            requestInfo, resource, base_version
                        });

                        resourcesToDelete[resource._uuid] = {
                            id: resource.id,
                            uuid: resource._uuid,
                            sourceAssigningAuthority: resource._sourceAssigningAuthority,
                            resourceType: resource.resourceType,
                            created: false,
                            deleted: true
                        };
                    } catch (e) {}
                }
                /**
                 * @type {DeleteManyResult}
                 */
                res = await databaseQueryManager.deleteManyAsync({
                    requestId,
                    query: { _uuid: { $in: Object.keys(resourcesToDelete) } }
                });

                Object.values(resourcesToDelete).forEach(data => {
                    logInfo('Resource Deleted', {
                        action: currentOperationName,
                        ...data
                    });
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
                                    ids: Object.keys(resourcesToDelete)
                                }
                            );
                        }
                    });
                }
            } catch (e) {
                throw new NotAllowedError(e.message);
            }

            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
            return { deleted: res.deletedCount };
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
    RemoveOperation
};
