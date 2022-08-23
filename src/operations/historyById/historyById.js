// noinspection ExceptionCaughtLocallyJS

const {logOperationAsync} = require('../common/logging');
const {isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const {buildStu3SearchQuery} = require('../query/stu3');
const {buildDstu2SearchQuery} = require('../query/dstu2');
const {getResource} = require('../common/getResource');
const {BadRequestError, NotFoundError} = require('../../utils/httpErrors');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseHistoryFactory} = require('../../dataLayer/databaseHistoryFactory');
const {VERSIONS} = require('@asymmetrik/node-fhir-server-core').constants;

class HistoryByIdOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     */
    constructor(
        {
            databaseHistoryFactory
        }
    ) {
        /**
         * @type {DatabaseHistoryFactory}
         */
        this.databaseHistoryFactory = databaseHistoryFactory;
        assertTypeEquals(databaseHistoryFactory, DatabaseHistoryFactory);
    }

    /**
     * does a FHIR History By id
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     */
    async historyById( requestInfo, args, resourceType) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'historyById';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const user = requestInfo.user;
        const scope = requestInfo.scope;

        await verifyHasValidScopesAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        let {base_version, id} = args;
        let query = {};

        if (base_version === VERSIONS['3_0_1']) {
            query = buildStu3SearchQuery(args);
        } else if (base_version === VERSIONS['1_0_2']) {
            query = buildDstu2SearchQuery(args);
        }

        query.id = `${id}`;

        /**
         * @type {boolean}
         */
        const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

        let Resource = getResource(base_version, resourceType);

        try {
            /**
             * @type {DatabasePartitionedCursor}
             */
            let cursor;
            try {
                cursor = await this.databaseHistoryFactory.createDatabaseHistoryManager(resourceType, base_version, useAtlas)
                    .findAsync(query);
            } catch (e) {
                throw new BadRequestError(e);
            }
            const resources = [];
            while (await cursor.hasNext()) {
                const element = await cursor.next();
                const resource = new Resource(element);
                if (isAccessToResourceAllowedBySecurityTags(resource, user, scope)) {
                    resources.push(resource);
                }
            }
            if (resources.length === 0) {
                throw new NotFoundError();
            }
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationCompleted',
                action: currentOperationName
            });
            return resources;
        } catch (e) {
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationFailed',
                action: currentOperationName,
                error: e
            });
            throw e;
        }
    }
}

module.exports = {
    HistoryByIdOperation
};
