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
const {assertTypeEquals} = require('../utils/assertType');


// This is needed for JSON.stringify() can handle regex
// https://stackoverflow.com/questions/12075927/serialization-of-regexp
// eslint-disable-next-line no-extend-native
Object.defineProperty(RegExp.prototype, 'toJSON', {
    value: RegExp.prototype.toString
});

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
            expandOperation
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
    }

    getRequestInfo(req) {
        /**
         * @type {string | null}
         */
        const user = (req.authInfo && req.authInfo.context && req.authInfo.context.username) ||
            (req.authInfo && req.authInfo.context && req.authInfo.context.subject) ||
            ((!req.user || typeof req.user === 'string') ? req.user : req.user.id);
        /**
         * @type {boolean}
         */
        const isUser = req.authInfo && req.authInfo.context && req.authInfo.context.isUser;
        /**
         * @type {string[] | null}
         */
        const patients = req.authInfo && req.authInfo.context && req.authInfo.context.fhirPatientIds;
        /**
         * @type {string|null}
         */
        const fhirPersonId = req.authInfo && req.authInfo.context && req.authInfo.context.fhirPersonId;
        /**
         * @type {string}
         */
        const scope = req.authInfo && req.authInfo.scope;
        /**
         * @type {string|null}
         */
        const remoteIpAddress = req.headers['X-Forwarded-For'] || req.connection.remoteAddress;
        /**
         * @type {string|null}
         */
        const requestId = req.id;
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
        const host = req.hostname;
        /**
         * @type {Object | Object[] | null}
         */
        const body = req.body;
        return new FhirRequestInfo(
            {
                user,
                scope,
                remoteIpAddress,
                requestId,
                protocol,
                originalUrl,
                path,
                host,
                body,
                accept,
                isUser,
                patients,
                fhirPersonId
            }
        );
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
         * @type {string[]}
         */
        let combined_args = get_all_args(req, args);
        if (req.body && Object.keys(req.body).length > 0) {
            combined_args = Object.assign({}, args, req.body);
        }

        return this.searchBundleOperation.searchBundle(
            this.getRequestInfo(req),
            combined_args, resourceType);
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
         * @type {string[]}
         */
        let combined_args = get_all_args(req, args);
        if (req.body && Object.keys(req.body).length > 0) {
            combined_args = Object.assign({}, args, req.body);
        }
        return this.searchStreamingOperation.searchStreaming(
            this.getRequestInfo(req),
            res,
            combined_args, resourceType);
    }

    /**
     * does a FHIR Search By Id
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
// eslint-disable-next-line no-unused-vars
    async searchById(args, {req}, resourceType) {
        return this.searchByIdOperation.searchById(
            this.getRequestInfo(req),
            args, resourceType);
    }

    /**
     * does a FHIR Create (POST)
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async create(args, {req}, resourceType) {
        /**
         * combined args
         * @type {string[]}
         */
        const combined_args = get_all_args(req, args);
        /**
         * @type {string}
         */
        const path = req.path;

        return this.createOperation.create(
            this.getRequestInfo(req),
            combined_args, path, resourceType);
    }

    /**
     * does a FHIR Update (PUT)
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async update(args, {req}, resourceType) {
        /**
         * combined args
         * @type {string[]}
         */
        const combined_args = get_all_args(req, args);

        return this.updateOperation.update(
            this.getRequestInfo(req),
            combined_args, resourceType);
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
         * @type {string[]}
         */
        const combined_args = get_all_args(req, args);

        return this.mergeOperation.merge(
            this.getRequestInfo(req),
            combined_args, resourceType);
    }

    /**
     * does a FHIR $everything
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async everything(args, {req}, resourceType) {
        /**
         * combined args
         * @type {string[]}
         */
        const combined_args = get_all_args(req, args);

        return this.everythingOperation.everything(
            this.getRequestInfo(req),
            combined_args, resourceType);
    }

    /**
     * does a FHIR Remove (DELETE)
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
// eslint-disable-next-line no-unused-vars
    async remove(args, {req}, resourceType) {
        /**
         * combined args
         * @type {string[]}
         */
        const combined_args = get_all_args(req, args);

        return this.removeOperation.remove(
            this.getRequestInfo(req),
            combined_args, resourceType);
    }

    /**
     * does a FHIR Search By Version
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
// eslint-disable-next-line no-unused-vars
    async searchByVersionId(args, {req}, resourceType) {
        return this.searchByVersionIdOperation.searchByVersionId(
            this.getRequestInfo(req),
            args, resourceType);
    }

    /**
     * does a FHIR History
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
// eslint-disable-next-line no-unused-vars
    async history(args, {req}, resourceType) {
        return this.historyOperation.history(
            this.getRequestInfo(req),
            args, resourceType);
    }

    /**
     * does a FHIR History By id
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
// eslint-disable-next-line no-unused-vars
    async historyById(args, {req}, resourceType) {
        return this.historyByIdOperation.historyById(
            this.getRequestInfo(req),
            args, resourceType);
    }

    /**
     * does a FHIR Patch
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
// eslint-disable-next-line no-unused-vars
    async patch(args, {req}, resourceType) {
        return this.patchOperation.patch(
            this.getRequestInfo(req),
            args, resourceType);
    }

    /**
     * does a FHIR Validate
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
    async validate(args, {req}, resourceType) {
        return this.validateOperation.validate(
            this.getRequestInfo(req),
            args, resourceType);
    }

    /**
     * Supports $graph
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     * @return {Promise<{entry: {resource: Resource, fullUrl: string}[], id: string, resourceType: string}|{entry: *[], id: string, resourceType: string}>}
     */
    async graph(args, {req}, resourceType) {
        /**
         * combined args
         * @type {string[]}
         */
        const combined_args = get_all_args(req, args);
        return this.graphOperation.graph(
            this.getRequestInfo(req),
            combined_args, resourceType);
    }

    /**
     * does a FHIR Search By Id
     * @param {string[]} args
     * @param {import('http').IncomingMessage} req
     * @param {string} resourceType
     */
// eslint-disable-next-line no-unused-vars
    async expand(args, {req}, resourceType) {
        return this.expandOperation.expand(
            this.getRequestInfo(req),
            args, resourceType);
    }
}

module.exports = {
    FhirOperationsManager
};
