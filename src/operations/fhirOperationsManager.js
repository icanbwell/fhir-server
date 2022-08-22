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
const {RequestInfo} = require('../utils/requestInfo');
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
        const user = (req.authInfo && req.authInfo.context && req.authInfo.context.username) ||
            (req.authInfo && req.authInfo.context && req.authInfo.context.subject) ||
            ((!req.user || typeof req.user === 'string') ? req.user : req.user.id);
        return new RequestInfo(
            user,
            req.authInfo && req.authInfo.scope,
            req.headers['X-Forwarded-For'] || req.connection.remoteAddress,
            req.id,
            req.protocol,
            req.originalUrl,
            req.path,
            req.hostname,
            req.body,
            req.headers.accept,
            req.authInfo && req.authInfo.context && req.authInfo.context.isUser,
            req.authInfo && req.authInfo.context && req.authInfo.context.fhirPatientIds,
            req.authInfo && req.authInfo.context && req.authInfo.context.fhirPersonId
        );
    }

    getContainer(req) {
        return req.container;
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

        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.searchBundleOperation.searchBundle(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.searchStreamingOperation.searchStreaming(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.searchByIdOperation.searchById(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.createOperation.create(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.updateOperation.update(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.mergeOperation.merge(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.everythingOperation.everything(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.removeOperation.remove(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.searchByVersionIdOperation.searchByVersionId(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.historyOperation.history(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.historyByIdOperation.historyById(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.patchOperation.patch(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.validateOperation.validate(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.graphOperation.graph(
            container,
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
        /**
         * @type {SimpleContainer}
         */
        const container = this.getContainer(req);
        return this.expandOperation.expand(
            container,
            this.getRequestInfo(req),
            args, resourceType);
    }
}

module.exports = {
    FhirOperationsManager
};
