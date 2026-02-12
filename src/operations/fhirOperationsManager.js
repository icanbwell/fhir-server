const {SearchBundleOperation} = require('./search/searchBundle');
const {SearchByIdOperation} = require('./searchById/searchById');
const {ExpandOperation} = require('./expand/expand');
const {ExportOperation} = require('./export/export');
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
const {FhirRequestInfoBuilder} = require('../utils/fhirRequestInfoBuilder');
const {SearchStreamingOperation} = require('./search/searchStreaming');
const {assertTypeEquals} = require('../utils/assertType');
const {FhirResponseStreamer} = require('../utils/fhirResponseStreamer');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const {convertErrorToOperationOutcome} = require('../utils/convertErrorToOperationOutcome');
const {QueryRewriterManager} = require('../queryRewriters/queryRewriterManager');
const {R4ArgsParser} = require('./query/r4ArgsParser');
const {PERSON_PROXY_PREFIX} = require('../constants');
const {shouldStreamResponse} = require('../utils/requestHelpers');
const {ParametersBodyParser} = require('./common/parametersBodyParser');
const {
    fhirContentTypes,
    hasNdJsonContentType
} = require('../utils/contentTypes');
const {ExportByIdOperation} = require('./export/exportById');
const {FhirResponseNdJsonStreamer} = require('../utils/fhirResponseNdJsonStreamer');
const {READ, WRITE} = require('../constants').OPERATIONS;
const {vulcanIgSearchQueries} = require('./query/customQueries');
const {ParsedArgs} = require('./query/parsedArgs');
const {getNestedValueByPath} = require('../utils/object');
const {ConfigManager} = require('../utils/configManager');
const {SummaryOperation} = require("./summary/summary");
const { ResponseStreamerFactory } = require('../utils/responseStreamerFactory');
const { BadRequestError } = require('../utils/httpErrors');
const { ResponseHandlerFactory } = require('../utils/responseHandler/responseHandlerFactory');
const { BaseResponseHandler } = require('../utils/responseHandler/baseResponseHandler');

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
     * @param summaryOperation
     * @param removeOperation
     * @param searchByVersionIdOperation
     * @param historyOperation
     * @param historyByIdOperation
     * @param patchOperation
     * @param validateOperation
     * @param graphOperation
     * @param expandOperation
     * @param exportOperation
     * @param exportByIdOperation
     * @param {R4ArgsParser} r4ArgsParser
     * @param {QueryRewriterManager} queryRewriterManager
     * @param {ConfigManager} configManager
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
            summaryOperation,
            removeOperation,
            searchByVersionIdOperation,
            historyOperation,
            historyByIdOperation,
            patchOperation,
            validateOperation,
            graphOperation,
            expandOperation,
            exportOperation,
            exportByIdOperation,
            r4ArgsParser,
            queryRewriterManager,
            configManager
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
         * @type {SummaryOperation}
         */
        this.summaryOperation = summaryOperation;
        assertTypeEquals(summaryOperation, SummaryOperation);
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
         * @type {ExportOperation}
         */
        this.exportOperation = exportOperation;
        assertTypeEquals(exportOperation, ExportOperation);
        /**
         * @type {ExportByIdOperation}
         */
        this.exportByIdOperation = exportByIdOperation;
        assertTypeEquals(exportByIdOperation, ExportByIdOperation);

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

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * @description Creates a FhirRequestInfo from the passed in request
     * @param {import('http').IncomingMessage} req
     * @return {FhirRequestInfo}
     */
    getRequestInfo(req) {
        return FhirRequestInfoBuilder.fromRequest(req);
    }

    /**
     * Parse arguments
     * @param {Object} args
     * @param {string} resourceType
     * @param {Object|undefined} [headers]
     * @param {string} operation
     * @param {boolean} [allowMultipleIds=true]
     * @return {Promise<ParsedArgs>}
     */
    async getParsedArgsAsync({args, resourceType, headers, operation, allowMultipleIds = true}) {
        const {base_version} = args;
        /**
         * @type {ParsedArgs}
         */
        let parsedArgs = this.r4ArgsParser.parseArgs({resourceType, args});

        if (!allowMultipleIds && parsedArgs.id?.includes(',')) {
            throw new BadRequestError(new Error('Multiple IDs are not allowed'));
        }

        // see if any query rewriters want to rewrite the args
        parsedArgs = await this.queryRewriterManager.rewriteArgsAsync(
            {
                base_version, parsedArgs, resourceType, operation
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
        combined_args = this.parseParametersFromBody({req, combined_args});
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: READ
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
        combined_args = this.parseParametersFromBody({req, combined_args});
        const requestInfo = this.getRequestInfo(req);

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: READ
            }
        );

        if (this.configManager.enableVulcanIgQuery) {
            for (const parsedArg of parsedArgs.parsedArgItems) {
                const vulcanIgSearchQuery =
                    vulcanIgSearchQueries?.[resourceType]?.[parsedArg.queryParameter];
                if (vulcanIgSearchQuery) {
                    const combinedFilterValues = new Set();
                    // combine if single filter corresponds to multiple filters
                    for (const vulcanIgFilter of vulcanIgSearchQuery.filters) {
                        const vulcanIgFilterArgs = {
                            _debug: true,
                            base_version: '4_0_0',
                            _elements: vulcanIgFilter.filterField.split('.')[0]
                        };

                        // for missing modifier handling needs to be done while applying filter to parent
                        if (
                            (parsedArg.modifiers.length === 0 ||
                                parsedArg.modifiers[0] !== 'missing') &&
                            vulcanIgFilter.searchParam
                        ) {
                            vulcanIgFilterArgs[vulcanIgFilter.searchParam] =
                                parsedArg.queryParameterValue.value;
                        }

                        const bundle = await this.searchBundleOperation.searchBundleAsync({
                            requestInfo,
                            resourceType: vulcanIgFilter.resourceType,
                            parsedArgs: await this.getParsedArgsAsync({
                                args: vulcanIgFilterArgs,
                                resourceType: vulcanIgFilter.resourceType,
                                operation: READ
                            }),
                            useAggregationPipeline: false
                        });

                        bundle?.entry?.forEach((element) => {
                            let value = getNestedValueByPath(
                                element.resource,
                                vulcanIgFilter.filterField
                            );
                            if (typeof value === 'string' && value !== '') {
                                if (vulcanIgFilter.extractValueFn) {
                                    const extractValue = new Function('x', vulcanIgFilter.extractValueFn);
                                    value = extractValue(value);
                                }
                                combinedFilterValues.add(value);
                            }
                        });
                    }

                    /**
                     * @type {string[]}
                     */
                    let parentResourceFilterValue = [];
                    let existingFilterValues = null;

                    // for taking union with existing filter
                    const existingParseArgItem = parsedArgs.parsedArgItems.find(
                        (a) =>
                            a.queryParameter ===
                            (vulcanIgSearchQuery.resultSearchParam === 'id' ? '_id'
                                : vulcanIgSearchQuery.resultSearchParam) &&
                            a.modifiers.length === 0
                    );
                    if (existingParseArgItem) {
                        existingFilterValues =
                            existingParseArgItem.queryParameterValue.value.split(',');
                        for (const filterValue of combinedFilterValues) {
                            if (existingFilterValues.includes(filterValue)) {
                                parentResourceFilterValue.push(filterValue);
                            }
                        }
                    } else {
                        parentResourceFilterValue = Array.from(combinedFilterValues);
                    }

                    // for handling missing modifier to reverse the search applied to parent resource
                    const parentResourceArgName =
                        vulcanIgSearchQuery.resultSearchParam +
                        (parsedArg.modifiers[0] === 'missing' &&
                        parsedArg.queryParameterValue.value === 'true' ? ':not'
                            : '');

                    const parentResourceParsedArg = await this.getParsedArgsAsync({
                        args: {
                            base_version: '4_0_0',
                            [parentResourceArgName]:
                                parentResourceFilterValue.length > 0 ? parentResourceFilterValue.join(',')
                                    : '__invalid__' // for handling case when no result is found
                        },
                        resourceType,
                        operation: READ
                    });

                    parsedArgs.add(parentResourceParsedArg.parsedArgItems[1]);
                }
            }
        }

        return await this.searchStreamingOperation.searchStreamingAsync(
            {
                requestInfo,
                res,
                parsedArgs,
                resourceType
            });
    }

    parseParametersFromBody({req, combined_args}) {
        let args = combined_args;
        if (req.body) {
            if (req.headers['content-type'] === fhirContentTypes.form_urlencoded) {
                args = new ParametersBodyParser().parseFormUrlEncoded(
                    {
                        body: req.body,
                        args: combined_args
                    }
                );
            } else {
                args = new ParametersBodyParser().parseParametersResource(
                    {
                        body: req.body,
                        args: combined_args
                    }
                );
            }
        }
        return args;
    }

    /**
     * does a FHIR Search By Id
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     * @returns {Promise<Resource | null | undefined>}
     */
    async searchById(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: READ
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
     * @returns {Promise<Resource>}
     */
    async create(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});
        /**
         * @type {string}
         */
        const path = req.path;
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
            args: combined_args, resourceType, headers: req.headers, operation: WRITE
        });

        return await this.createOperation.createAsync(
            {
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                path,
                resourceType
            }
        );
    }

    /**
     * does a FHIR Update (PUT)
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     * @returns {Promise<{id: string,created: boolean, resource_version: string, resource: Resource}>}
     */
    async update(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: WRITE
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
     * Does a FHIR Merge
     * Automatically chooses between streaming or standard merge
     *
     * @param {string[]} args
     * @param {{ req: import('http').IncomingMessage, res?: import('http').ServerResponse }} context
     * @param {string} resourceType
     * @return {Promise<Resource | Resource[] | void>}
     */
    async merge(args, {req, res}, resourceType) {
        // Combine args
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});

        const parsedArgs = await this.getParsedArgsAsync({
            args: combined_args,
            resourceType,
            headers: req.headers,
            operation: WRITE
        });

        // Detect if the client wants streaming
        const contentTypeNdjson = req.headers['content-type']?.includes('application/fhir+ndjson');

        if (contentTypeNdjson) {
            // Bidirectional streaming: pass request stream as-is
            return await this.mergeOperation.mergeAsyncStream({
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType,
                req,
                res
            });
        } else {
            // Fallback to standard merge
            return await this.mergeOperation.mergeAsync({
                requestInfo: this.getRequestInfo(req),
                parsedArgs,
                resourceType
            });
        }
    }


    /**
     * does a FHIR $everything
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {import('express').Response} res
     * @param {string} resourceType
     * @returns {Promise<Bundle | undefined>}
     */
    async everything(args, {req, res}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});

        // map Person GET $everything to Patient GET $everything
        if (resourceType === 'Person' && req.method === 'GET') {
            resourceType = 'Patient';
            if (combined_args._id) {
                combined_args.id = combined_args._id;
                delete combined_args._id;
            }
            if (combined_args.id) {
                const ids = combined_args.id.split(',').map(id => `${PERSON_PROXY_PREFIX}${id}`);
                combined_args.id = ids.join(',');
            }
        }

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: READ
            }
        );

        /**
         * @type {FhirRequestInfo}
         */
        const requestInfo = this.getRequestInfo(req);
        if (shouldStreamResponse(req)) {
            /**
             * response streamer to use
             * @type {BaseResponseStreamer}
             */
            let responseStreamer;
            if (hasNdJsonContentType(requestInfo.accept)) {
                responseStreamer = new FhirResponseNdJsonStreamer({
                        response: res,
                        requestId: req.id
                    }
                );
            } else {
                responseStreamer = ResponseStreamerFactory.create({
                    res,
                    requestId: req.id,
                    requestInfo,
                    parsedArgs
                });
            }
            // Start the response streamer
            await responseStreamer.startAsync();

            try {
                /**
                 * @type {Bundle}
                 */
                const result = await this.everythingOperation.everythingAsync(
                    {
                        requestInfo,
                        res,
                        parsedArgs,
                        resourceType,
                        responseStreamer
                    });
                await responseStreamer.endAsync();
                return undefined;
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
                    requestInfo,
                    res,
                    parsedArgs,
                    resourceType
                });
            return result;
        }
    }

    /**
     * does a FHIR $summary
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {import('express').Response} res
     * @param {string} resourceType
     * @returns {Promise<Bundle|undefined>}
     */
    async summary(args, {req, res}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});

        // map Person $summary to Proxy Patient $summary
        if (resourceType === 'Person') {
            resourceType = 'Patient';
            combined_args.id = `${PERSON_PROXY_PREFIX}${combined_args.id}`;
        }

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
            args: combined_args,
            resourceType,
            headers: req.headers,
            operation: READ,
            allowMultipleIds: false
        });

        /**
         * @type {FhirRequestInfo}
         */
        const requestInfo = this.getRequestInfo(req);
        /**
         * response streamer to use
         * @type {BaseResponseHandler}
         */
        let responseHandler = ResponseHandlerFactory.create({
            res,
            requestId: req.id,
            requestInfo,
            parsedArgs
        });

        try {
            await this.summaryOperation.summaryAsync(
                {
                    requestInfo,
                    res,
                    parsedArgs,
                    resourceType,
                    responseHandler
                });
            return undefined;
        } catch (err) {
            const operationOutcome = convertErrorToOperationOutcome({error: err});
            await responseHandler.setStatusCodeAsync({statusCode: err.statusCode || 500});
            await responseHandler.writeOperationOutcomeAsync(operationOutcome);
        }
    }

    /**
     * does a FHIR Remove (DELETE)
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     * @returns {Promise<{deleted: number}>}
     */
    async remove(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: WRITE
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
     * @returns {Promise<{deleted: number}>}
     */
    async remove_by_query(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: WRITE
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
     * @returns {Promise<any | undefined>}
     */
    async searchByVersionId(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: READ
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
     * @returns {Promise<any>}
     */
    async history(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: READ
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
     * @returns { Promise<any | undefined>}
     */
    async historyById(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: READ
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
     * @returns {{id: string,created: boolean, resource_version: string, resource: Resource}}
     */
    async patch(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: WRITE
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
     * @returns {Promise<Resource>}
     */
    async validate(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: READ
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
     * @return {Promise<Bundle|undefined>}
     */
    async graph(args, {req, res}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: READ
            }
        );

        /**
         * @type {FhirRequestInfo}
         */
        const requestInfo = this.getRequestInfo(req);

        /**
         * @type {BaseResponseStreamer}
         */
        const responseStreamer = hasNdJsonContentType(requestInfo.accept) ?
            new FhirResponseNdJsonStreamer({
                    response: res,
                    requestId: req.id
                }
            ) : new FhirResponseStreamer({
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
                    requestInfo,
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
     * @returns {Promise<Resource>}
     */
    async expand(args, {req}, resourceType) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = await this.getParsedArgsAsync({
                args: combined_args, resourceType, headers: req.headers, operation: READ
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

    /**
     * does FHIR Bulk export
     * @param {string[]} args
     * @param {{ req: import('http').IncomingMessage }}
     * @return {Promise<Resource | Resource[]>}
     */
    async export(args, {req}) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});
        /**
         * @type {FhirRequestInfo}
         */
        const requestInfo = this.getRequestInfo(req);

        return await this.exportOperation.exportAsync({requestInfo, args: combined_args});
    }

    /**
     * returns status for the bulk export
     * @param {string[]} args
     * @param {{ req: import('http').IncomingMessage }}
     * @return {Promise<Resource | Resource[]>}
     */
    async exportById(args, {req}) {
        /**
         * combined args
         * @type {Object}
         */
        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({req, combined_args});
        /**
         * @type {FhirRequestInfo}
         */
        const requestInfo = this.getRequestInfo(req);

        return await this.exportByIdOperation.exportByIdAsync({requestInfo, args: combined_args});
    }
}

module.exports = {
    FhirOperationsManager
};
