// noinspection ExceptionCaughtLocallyJS

const {NotAllowedError, ForbiddenError} = require('../../utils/httpErrors');
const env = require('var');
const {buildStu3SearchQuery} = require('../query/stu3');
const {buildDstu2SearchQuery} = require('../query/dstu2');
const {R4SearchQueryCreator} = require('../query/r4');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {AuditLogger} = require('../../utils/auditLogger');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');
const {ConfigManager} = require('../../utils/configManager');
const {SecurityTagSystem} = require('../../utils/securityTagSystem');
const {R4ArgsParser} = require('../query/r4ArgsParser');
const {QueryRewriterManager} = require('../../queryRewriters/queryRewriterManager');
const {ParsedArgs} = require('../query/parsedArgsItem');

class RemoveOperation {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {AuditLogger} auditLogger
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ConfigManager} configManager
     * @param {R4SearchQueryCreator} r4SearchQueryCreator
     * @param {R4ArgsParser} r4ArgsParser
     * @param {QueryRewriterManager} queryRewriterManager
     */
    constructor(
        {
            databaseQueryFactory,
            auditLogger,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            configManager,
            r4SearchQueryCreator,
            r4ArgsParser,
            queryRewriterManager
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
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
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
         * @type {R4SearchQueryCreator}
         */
        this.r4SearchQueryCreator = r4SearchQueryCreator;
        assertTypeEquals(r4SearchQueryCreator, R4SearchQueryCreator);

        /**
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);

        /**
         * @type {QueryRewriterManager}
         */
        this.queryRewriterManager = queryRewriterManager;
        assertTypeEquals(queryRewriterManager, QueryRewriterManager);
    }

    /**
     * does a FHIR Remove (DELETE)
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     */
    async remove({requestInfo, args, parsedArgs, resourceType}) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'remove';

        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {user, scope, /** @type {string|null} */ requestId, /** @type {string} */ method} = requestInfo;

        if (args['id'] === '0') {
            delete args['id'];
        }
        /**
         * @type {string[]}
         */
        let securityTags = [];
        // add any access codes from scopes
        const accessCodes = this.scopesManager.getAccessCodesFromScopes('read', user, scope);
        if (env.AUTH_ENABLED === '1') {
            // fail if there are no access codes
            if (accessCodes.length === 0) {
                let errorMessage = 'user ' + user + ' with scopes [' + scope + '] has no access scopes';
                throw new ForbiddenError(errorMessage);
            }
            // see if we have the * access code
            else if (accessCodes.includes('*')) {
                // no security check since user has full access to everything
            } else {
                securityTags = accessCodes;
            }
        }
        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'write'
        });

        try {
            let {base_version} = args;
            /**
             * @type {import('mongodb').Document}
             */
            let query = {};
            // eslint-disable-next-line no-useless-catch
            try {
                if (base_version === VERSIONS['3_0_1']) {
                    query = buildStu3SearchQuery(args);
                } else if (base_version === VERSIONS['1_0_2']) {
                    query = buildDstu2SearchQuery(args);
                } else {
                    ({query} = this.r4SearchQueryCreator.buildR4SearchQuery(
                        {
                            resourceType, parsedArgs
                        }));
                }
            } catch (e) {
                throw e;
            }

            // add in $and statements for security tags
            if (securityTags && securityTags.length > 0) {
                // add as a separate $and statement
                if (query.$and === undefined) {
                    query.$and = [];
                }
                query.$and.push(
                    {
                        'meta.security': {
                            '$elemMatch': {
                                'system': SecurityTagSystem.access,
                                'code': {
                                    '$in': securityTags
                                }
                            }
                        }
                    }
                );
            }

            if (Object.keys(query).length === 0) {
                // don't delete everything
                return {deleted: 0};
            }
            // Delete our resource record
            let res;
            try {
                const databaseQueryManager = this.databaseQueryFactory.createQuery(
                    {resourceType, base_version}
                );
                /**
                 * @type {DeleteManyResult}
                 */
                res = await databaseQueryManager.deleteManyAsync({
                    requestId,
                    query
                });

                // log access to audit logs
                await this.auditLogger.logAuditEntryAsync(
                    {
                        requestInfo, base_version, resourceType,
                        operation: 'delete', args, ids: []
                    }
                );
                const currentDate = moment.utc().format('YYYY-MM-DD');
                await this.auditLogger.flushAsync({requestId, currentDate, method});

            } catch (e) {
                throw new NotAllowedError(e.message);
            }

            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
            return {deleted: res.deletedCount};
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
    RemoveOperation
};

