const {SearchBundleOperation} = require('./search/searchBundle');
const {SearchByIdOperation} = require('./searchById/searchById');
const {ExpandOperation} = require('./expand/expand');
const {CreateOperation} = require('./create/create');
const {UpdateOperation} = require('./update/update');
const {MergeOperation} = require('./merge/merge');
const {EverythingOperation} = require('./everything/everything');
const {RemoveOperation} = require('./remove/remove');
const {SearchByVersionIdOperation} = require('./searchByVersionId/searchByVersionId');
const {HistoryOperation} = require('./history/history');
const {HistoryByIdOperation} = require('./historyById/historyById');
const {PatchOperation} = require('./patch/patch');
const {ValidateOperation} = require('./validate/validate');
const {GraphOperation} = require('./graph/graph');
const {get_all_args} = require('./common/get_all_args');
const {FhirRequestInfo} = require('../utils/fhirRequestInfo');
const {SearchStreamingOperation} = require('./search/searchStreaming');
const {assertTypeEquals, assertIsValid} = require('../utils/assertType');
const env = require('var');
const httpContext = require('express-http-context');
const {FhirResponseStreamer} = require('../utils/fhirResponseStreamer');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const {convertErrorToOperationOutcome} = require('../utils/convertErrorToOperationOutcome');
const contentType = require('content-type');
const {QueryRewriterManager} = require('../queryRewriters/queryRewriterManager');
const {R4ArgsParser} = require('./query/r4ArgsParser');
const {REQUEST_ID_TYPE} = require('../constants');
const {shouldStreamResponse} = require('../utils/requestHelpers');
const {ParametersBodyParser} = require('./common/parametersBodyParser');

// const {shouldStreamResponse} = require('../utils/requestHelpers');


class FhirOperationsManager {
    /**
     * constructor
     * @param searchBundleOperation
     * @param searchStreamingOperation
     * @param searchByIdOperation
     * @param createOperation
     * @param updateOperation
     * @param mergeOperation
     * @param everythingOperation
     * @param removeOperation
     * @param searchByVersionIdOperation
     * @param historyOperation
     * @param historyByIdOperation
     * @param patchOperation
     * @param validateOperation
     * @param graphOperation
     * @param expandOperation
     * @param {R4ArgsParser} r4ArgsParser
     * @param {QueryRewriterManager} queryRewriterManager
     */
    constructor(
        {
            searchBundleOperation,
            searchStreamingOperation,
            searchByIdOperation,
            createOperation,
            updateOperation,
            mergeOperation,
            everythingOperation,
            removeOperation,
            searchByVersionIdOperation,
            historyOperation,
            historyByIdOperation,
            patchOperation,
            validateOperation,
            graphOperation,
            expandOperation,
            r4ArgsParser,
            queryRewriterManager
        }
    ) {
        /**
         * @type {SearchBundleOperation}
         */
        this.searchBundleOperation = searchBundleOperation;
        assertTypeEquals(searchBundleOperation, SearchBundleOperation);
        /**
         * @type {SearchStreamingOperation}
         */
        this.searchStreamingOperation = searchStreamingOperation;
        assertTypeEquals(searchStreamingOperation, SearchStreamingOperation);
        /**
         * @type {SearchByIdOperation}
         */
        this.searchByIdOperation = searchByIdOperation;
        assertTypeEquals(searchByIdOperation, SearchByIdOperation);
        /**
         * @type {CreateOperation}
         */
        this.createOperation = createOperation;
        assertTypeEquals(createOperation, CreateOperation);
        /**
         * @type {UpdateOperation}
         */
        this.updateOperation = updateOperation;
        assertTypeEquals(updateOperation, UpdateOperation);
        /**
         * @type {MergeOperation}
         */
        this.mergeOperation = mergeOperation;
        assertTypeEquals(mergeOperation, MergeOperation);
        /**
         * @type {EverythingOperation}
         */
        this.everythingOperation = everythingOperation;
        assertTypeEquals(everythingOperation, EverythingOperation);
        /**
         * @type {RemoveOperation}
         */
        this.removeOperation = removeOperation;
        assertTypeEquals(removeOperation, RemoveOperation);
        /**
         * @type {SearchByVersionIdOperation}
         */
        this.searchByVersionIdOperation = searchByVersionIdOperation;
        assertTypeEquals(searchByVersionIdOperation, SearchByVersionIdOperation);
        /**
         * @type {HistoryOperation}
         */
        this.historyOperation = historyOperation;
        assertTypeEquals(historyOperation, HistoryOperation);
        /**
         * @type {HistoryByIdOperation}
         */
        this.historyByIdOperation = historyByIdOperation;
        assertTypeEquals(historyByIdOperation, HistoryByIdOperation);
        /**
         * @type {PatchOperation}
         */
        this.patchOperation = patchOperation;
        assertTypeEquals(patchOperation, PatchOperation);
        /**
         * @type {ValidateOperation}
         */
        this.validateOperation = validateOperation;
        assertTypeEquals(validateOperation, ValidateOperation);
        /**
         * @type {GraphOperation}
         */
        this.graphOperation = graphOperation;
        assertTypeEquals(graphOperation, GraphOperation);
        /**
         * @type {ExpandOperation}
         */
        this.expandOperation = expandOperation;
        assertTypeEquals(expandOperation, ExpandOperation);

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
     * @description Creates a FhirRequestInfo from the passed in request
     * @param {import('http').IncomingMessage} req
     * @return {FhirRequestInfo}
     */
    getRequestInfo(req) {
        assertIsValid(req, 'req is null');
        /**
         * @type {string | null}
         */
        const user = (req.authInfo && req.authInfo.context && req.authInfo.context.username) ||
            (req.authInfo && req.authInfo.context && req.authInfo.context.subject) ||
            ((!req.user || typeof req.user === 'string') ? req.user : req.user.name || req.user.id);
        /**
         * @type {boolean}
         */
        const isUser = req.authInfo && req.authInfo.context && req.authInfo.context.isUser;
        /**
         * @type {string[] | null}
         */
        const patientIdsFromJwtToken = req.authInfo && req.authInfo.context && req.authInfo.context.patientIdsFromJwtToken;
        /**
         * @type {string|null}
         */
        const personIdFromJwtToken = req.authInfo && req.authInfo.context && req.authInfo.context.personIdFromJwtToken;
        /**
         * @type {string}
         */
        const scope = req.authInfo && req.authInfo.scope;
        /**
         * @type {string|null}
         */
        const remoteIpAddress = req.header('X-Forwarded-For') || req.socket.remoteAddress;
        /**
         * @type {string|null}
         */
        const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
        /**
         * @type {string|null}
         */
        const userRequestId = httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID);
        /**
         * @type {string}
         */
        const path = req.path;
        /**
         * @type {string|null}
         */
        const accept = req.headers.accept;
        /**
         * @type {string}
         */
        const protocol = req.protocol;
        /**
         * @type {string | null}
         */
        const originalUrl = req.originalUrl;
        /**
         * @type {string | null}
         */
        const host = env.ENVIRONMENT === 'local' ? req.headers.host : req.hostname; // local will append port number to host
        /**
         * @type {Object | Object[] | null}
         */
        const body = req.body;

        /**
         * @type {string}
         */
        const method = req.method;

        /**
         * @type {Object}
         */
        const headers = req.headers;

        /**
         * @type {import('content-type').ContentType}
         */
        const contentTypeFromHeader = headers['content-type'] ? contentType.parse(headers['content-type']) : null;
        return new FhirRequestInfo(
            {
                user,
                scope,
                remoteIpAddress,
                requestId,
                userRequestId,
                protocol,
                originalUrl,
                path,
                host,
                body,
                accept,
                isUser,
                patientIdsFromJwtToken,
                personIdFromJwtToken,
                headers,
                method,
                contentTypeFromHeader
            }
        );
    }

    /**
     * Parse arguments
     * @param {Object} args
     * @param {string} resourceType
     * @param {Object|undefined} [headers]
     * @return {Promise<ParsedArgs>}
     */
    async getParsedArgsAsync({args, resourceType, headers}) {
        const {base_version} = args;
        /**
         * @type {ParsedArgs}
         */
        let parsedArgs = this.r4ArgsParser.parseArgs({resourceType, args});
        // see if any query rewriters want to rewrite the args
        parsedArgs = await this.queryRewriterManager.rewriteArgsAsync(
            {
                base_version, parsedArgs, resourceType
            }
        );
        if (headers) {
            parsedArgs.headers = headers;
        }
        return parsedArgs;
    }

    /**
     * does a FHIR Search
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     * @return {Resource[] | Resource} array of resources
     */
    async search(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        if (req.body) {
            combined_args = new ParametersBodyParser().parseIntoParameters(
                {
                    body: req.body,
                    args: combined_args
                }
            );
        }
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );
        return await this.searchBundleOperation.searchBundleAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType,
                useAggregationPipeline: false
            });
    }

    /**
     * does a FHIR Search and streams results
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {import('http').ServerResponse} res
     * @param {string} resourceType
     * @return {Resource[] | Resource} array of resources
     */
    async searchStreaming(args, {req, res}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);

        if (req.body) {
            combined_args = new ParametersBodyParser().parseIntoParameters(
                {
                    body: req.body,
                    args: combined_args
                }
            );
        }

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );
        return await this.searchStreamingOperation.searchStreamingAsync(
            {
                requestInfo: this.getRequestInfo(req),
                res,
                parsedArgs,
                resourceType
            });
    }

    /**
     * does a FHIR Search By Id
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async searchById(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );
        return await this.searchByIdOperation.searchByIdAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            }
        );
    }

    /**
     * does a FHIR Create (POST)
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     * @returns {Resource}
     */
    async create(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        const combined_args = get_all_args(req, args);
        /**
         * @type {string}
         */
        const path = req.path;
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
            args: combined_args, resourceType, headers: req.headers
        });

        return await this.createOperation.createAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                path, resourceType
            }
        );
    }

    /**
     * does a FHIR Update (PUT)
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     * @returns {{id: string,created: boolean, resource_version: string, resource: Resource}}
     */
    async update(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        const combined_args = get_all_args(req, args);
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );
        return await this.updateOperation.updateAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            }
        );
    }

    /**
     * does a FHIR Merge
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     * @return {Resource | Resource[]}
     */
    async merge(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        const combined_args = get_all_args(req, args);
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );
        return await this.mergeOperation.mergeAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            }
        );
    }

    /**
     * does a FHIR $everything
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {import('express').Response} res
     * @param {string} resourceType
     * @returns {Bundle}
     */
    async everything(args, {req, res}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        const combined_args = get_all_args(req, args);
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );

        if (shouldStreamResponse(req)) {
            const responseStreamer = new FhirResponseStreamer({
                response: res,
                requestId: req.id
            });
            await responseStreamer.startAsync();

            try {
                /**
                 * @type {Bundle}
                 */
                const result = await this.everythingOperation.everythingAsync(
                    {
                        requestInfo: this.getRequestInfo(req),
                        res,
                        parsedArgs,
                        resourceType,
                        responseStreamer
                    });
                await responseStreamer.endAsync();
                return result;
            } catch (err) {
                const status = err.statusCode || 500;
                /**
                 * @type {OperationOutcome}
                 */
                const operationOutcome = convertErrorToOperationOutcome({error: err});
                await responseStreamer.writeBundleEntryAsync({
                        bundleEntry: new BundleEntry({
                                resource: operationOutcome
                            }
                        )
                    }
                );
                await responseStreamer.setStatusCodeAsync({statusCode: status});
                await responseStreamer.endAsync();
            }
        } else {
            // noinspection UnnecessaryLocalVariableJS
            /**
             * @type {Bundle}
             */
            const result = await this.everythingOperation.everythingAsync(
                {
                    requestInfo: this.getRequestInfo(req),
                    res,
                    parsedArgs,
                    resourceType,
                });
            return result;
        }
    }

    /**
     * does a FHIR Remove (DELETE)
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async remove(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        const combined_args = get_all_args(req, args);
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );
        return await this.removeOperation.removeAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            }
        );
    }

    /**
     * does a FHIR Remove (DELETE)
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async remove_by_query(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        const combined_args = get_all_args(req, args);
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );
        return await this.removeOperation.removeAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            }
        );
    }

    /**
     * does a FHIR Search By Version
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async searchByVersionId(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );
        return await this.searchByVersionIdOperation.searchByVersionIdAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            }
        );
    }

    /**
     * does a FHIR History
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async history(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );

        return await this.historyOperation.historyAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            }
        );
    }

    /**
     * does a FHIR History By id
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async historyById(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );
        return await this.historyByIdOperation.historyByIdAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            });
    }

    /**
     * does a FHIR Patch
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     * @return {{id: string,created: boolean, resource_version: string, resource: Resource}}
     */
    async patch(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );
        return await this.patchOperation.patchAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            });
    }

    /**
     * does a FHIR Validate
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async validate(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );
        return await this.validateOperation.validateAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            });
    }

    /**
     * Supports $graph
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {import('http').ServerResponse} res
     * @param {string} resourceType
     * @return {Promise<Bundle>}
     */
    async graph(args, {req, res}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        const combined_args = get_all_args(req, args);
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );

        const responseStreamer = new FhirResponseStreamer({
            response: res,
            requestId: req.id
        });
        await responseStreamer.startAsync();
        try {
            /**
             * @type {Bundle}
             */
            const result = await this.graphOperation.graph(
                {
                    requestInfo: this.getRequestInfo(req),
                    res,
                    parsedArgs,
                    resourceType,
                    responseStreamer
                });
            await responseStreamer.endAsync();
            return result;
        } catch (err) {
            const status = err.statusCode || 500;
            /**
             * @type {OperationOutcome}
             */
            const operationOutcome = convertErrorToOperationOutcome({error: err});
            await responseStreamer.writeBundleEntryAsync({
                    bundleEntry: new BundleEntry({
                            resource: operationOutcome
                        }
                    )
                }
            );
            await responseStreamer.setStatusCodeAsync({statusCode: status});
            await responseStreamer.endAsync();
        }
    }

    /**
     * does a FHIR Search By Id
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async expand(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        const combined_args = get_all_args(req, args);
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers
            }
        );

        return await this.expandOperation.expandAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            }
        );
    }
}

module.exports = {
    FhirOperationsManager
};
