const {SimpleContainer} = require('./utils/simpleContainer');
const {KafkaClient} = require('./utils/kafkaClient');
const env = require('var');
const {ChangeEventProducer} = require('./utils/changeEventProducer');
const {ResourceManager} = require('./operations/common/resourceManager');
const {DatabaseBulkInserter} = require('./dataLayer/databaseBulkInserter');
const {DatabaseBulkLoader} = require('./dataLayer/databaseBulkLoader');
const {PostRequestProcessor} = require('./utils/postRequestProcessor');
const {AuditLogger} = require('./utils/auditLogger');
const {ErrorReporter} = require('./utils/slack.logger');
const {MongoCollectionManager} = require('./utils/mongoCollectionManager');
const {IndexManager} = require('./indexes/index.util');
const {ValueSetManager} = require('./utils/valueSet.util');
const {DatabaseQueryFactory} = require('./dataLayer/databaseQueryFactory');
const {ResourceLocatorFactory} = require('./operations/common/resourceLocatorFactory');
const {DatabaseHistoryFactory} = require('./dataLayer/databaseHistoryFactory');
const {MergeManager} = require('./operations/merge/mergeManager');
const {DatabaseUpdateFactory} = require('./dataLayer/databaseUpdateFactory');
const {SearchManager} = require('./operations/search/searchManager');
const {GraphHelper} = require('./operations/graph/graphHelpers');
const {FhirRouter} = require('./middleware/fhir/router');
const {ControllerUtils} = require('./middleware/fhir/controller.utils');
const {CustomOperationsController} = require('./middleware/fhir/4_0_0/controllers/operations.controller');
const {GenericController} = require('./middleware/fhir/4_0_0/controllers/generic_controller');
const {FhirOperationsManager} = require('./operations/fhirOperationsManager');
const {SearchBundleOperation} = require('./operations/search/searchBundle');
const {SearchStreamingOperation} = require('./operations/search/searchStreaming');
const {CreateOperation} = require('./operations/create/create');
const {UpdateOperation} = require('./operations/update/update');
const {MergeOperation} = require('./operations/merge/merge');
const {EverythingOperation} = require('./operations/everything/everything');
const {RemoveOperation} = require('./operations/remove/remove');
const {SearchByVersionIdOperation} = require('./operations/searchByVersionId/searchByVersionId');
const {HistoryByIdOperation} = require('./operations/historyById/historyById');
const {HistoryOperation} = require('./operations/history/history');
const {PatchOperation} = require('./operations/patch/patch');
const {ValidateOperation} = require('./operations/validate/validate');
const {GraphOperation} = require('./operations/graph/graph');
const {ExpandOperation} = require('./operations/expand/expand');
const {SearchByIdOperation} = require('./operations/searchById/searchById');

/**
 * Creates a container and sets up all the services
 * @return {SimpleContainer}
 */
const createContainer = function () {
    const container = new SimpleContainer();
    container.register('kafkaClient', () => new KafkaClient(
        env.KAFKA_CLIENT_ID,
        env.KAFKA_URLS ? env.KAFKA_URLS.split(',') : '')
    );
    container.register('changeEventProducer', c => new ChangeEventProducer(
        c.kafkaClient, c.resourceManager
    ));
    container.register('errorReporter', () => new ErrorReporter());
    container.register('indexManager', c => new IndexManager(c.errorReporter));
    container.register('collectionManager', c => new MongoCollectionManager(c.indexManager));
    container.register('valueSetManager', c => new ValueSetManager(c.databaseQueryFactory));
    container.register('resourceLocatorFactory', c => new ResourceLocatorFactory(c.collectionManager));

    container.register('databaseQueryFactory', c => new DatabaseQueryFactory(c.resourceLocatorFactory));
    container.register('databaseHistoryFactory', c => new DatabaseHistoryFactory(c.resourceLocatorFactory));
    container.register('databaseUpdateFactory', c => new DatabaseUpdateFactory(c.resourceLocatorFactory));

    container.register('resourceManager', () => new ResourceManager());
    container.register('searchManager', c => new SearchManager(
        c.databaseQueryFactory, c.resourceLocatorFactory
    ));
    container.register('mergeManager', c => new MergeManager(c.databaseQueryFactory, c.auditLogger));
    container.register('databaseBulkInserter', c => new DatabaseBulkInserter(
        c.resourceManager, c.postRequestProcessor, c.errorReporter, c.collectionManager, c.resourceLocatorFactory));
    container.register('databaseBulkLoader', c => new DatabaseBulkLoader(c.databaseQueryFactory));
    container.register('postRequestProcessor', c => new PostRequestProcessor(c.errorReporter));
    container.register('auditLogger', c => new AuditLogger(
        c.postRequestProcessor, c.databaseBulkInserter, c.errorReporter));
    container.register('graphHelper', c => new GraphHelper(c.databaseQueryFactory));

    // register fhir operations
    container.register('searchBundleOperation', c => new SearchBundleOperation(
            {
                searchManager: c.searchManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                auditLogger: c.auditLogger,
                errorReporter: c.errorReporter
            }
        )
    );
    container.register('searchStreamingOperation', c => new SearchStreamingOperation(
            {
                searchManager: c.searchManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                auditLogger: c.auditLogger,
                errorReporter: c.errorReporter
            }
        )
    );
    container.register('searchByIdOperation', () => new SearchByIdOperation());
    container.register('createOperation', () => new CreateOperation());
    container.register('updateOperation', () => new UpdateOperation());
    container.register('mergeOperation', c => new MergeOperation(
        {
            mergeManager: c.mergeManager,
            postRequestProcessor: c.postRequestProcessor,
            collectionManager: c.collectionManager,
            changeEventProducer: c.changeEventProducer,
            databaseBulkLoader: c.databaseBulkLoader,
            databaseBulkInserter: c.databaseBulkInserter
        }
    ));
    container.register('everythingOperation', () => new EverythingOperation());
    container.register('removeOperation', () => new RemoveOperation());
    container.register('searchByVersionIdOperation', () => new SearchByVersionIdOperation());
    container.register('historyOperation', () => new HistoryOperation());
    container.register('historyByIdOperation', () => new HistoryByIdOperation());
    container.register('patchOperation', () => new PatchOperation());
    container.register('validateOperation', () => new ValidateOperation());
    container.register('graphOperation', () => new GraphOperation());
    container.register('expandOperation', () => new ExpandOperation());

    // now register the routing for fhir
    container.register('fhirOperationsManager', c => new FhirOperationsManager(
            {
                searchBundleOperation: c.searchBundleOperation,
                searchStreamingOperation: c.searchStreamingOperation,
                searchByIdOperation: c.searchByIdOperation,
                createOperation: c.createOperation,
                updateOperation: c.updateOperation,
                mergeOperation: c.mergeOperation,
                everythingOperation: c.everythingOperation,
                removeOperation: c.removeOperation,
                searchByVersionIdOperation: c.searchByVersionIdOperation,
                historyOperation: c.historyOperation,
                historyByIdOperation: c.historyByIdOperation,
                patchOperation: c.patchOperation,
                validateOperation: c.validateOperation,
                graphOperation: c.graphOperation,
                expandOperation: c.expandOperation
            }
        )
    );
    container.register('genericController', c => new GenericController(c.postRequestProcessor, c.fhirOperationsManager));
    container.register('controllerUtils', c => new ControllerUtils(c.genericController));
    container.register('customOperationsController', c => new CustomOperationsController({
            postRequestProcessor: c.postRequestProcessor,
            fhirOperationsManager: c.fhirOperationsManager
        })
    );
    container.register('fhirRouter', c => new FhirRouter(c.controllerUtils, c.customOperationsController));

    return container;
};
module.exports = {
    createContainer
};
