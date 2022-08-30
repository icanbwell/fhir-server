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
const {SecurityTagManager} = require('./operations/common/securityTagManager');
const {FhirLoggingManager} = require('./operations/common/fhirLoggingManager');
const {ScopesManager} = require('./operations/security/scopesManager');
const {ScopesValidator} = require('./operations/security/scopesValidator');
const {ResourcePreparer} = require('./operations/common/resourcePreparer');
const {DummyKafkaClient} = require('./utils/dummyKafkaClient');
const {isTrue} = require('./utils/isTrue');
const {BundleManager} = require('./operations/common/bundleManager');
const {ResourceCleaner} = require('./operations/common/resourceCleaner');

/**
 * Creates a container and sets up all the services
 * @return {SimpleContainer}
 */
const createContainer = function () {
    // Note the order of registration does NOT matter
    const container = new SimpleContainer();

    container.register('scopesManager', () => new ScopesManager());
    container.register('resourcePreparer', c => new ResourcePreparer(
        {
            scopesManager: c.scopesManager
        }
    ));

    container.register('scopesValidator', c => new ScopesValidator({
        scopesManager: c.scopesManager,
        fhirLoggingManager: c.fhirLoggingManager
    }));

    container.register('fhirLoggingManager', c => new FhirLoggingManager({
        scopesManager: c.scopesManager
    }));
    container.register('kafkaClient', () =>
        isTrue(env.ENABLE_EVENTS_KAFKA) ?
            new KafkaClient(
                {
                    clientId: env.KAFKA_CLIENT_ID,
                    brokers: env.KAFKA_URLS ? env.KAFKA_URLS.split(',') : '',
                    ssl: isTrue(env.KAFKA_SSL)
                }
            ) :
            new DummyKafkaClient({clientId: '', brokers: []})
    );
    container.register('changeEventProducer', c => new ChangeEventProducer(
        {
            kafkaClient: c.kafkaClient,
            resourceManager: c.resourceManager,
            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events'
        }
    ));

    /**
     * @type {string}
     */
    const image = env.DOCKER_IMAGE || '';
    /**
     * @type {string|null}
     */
    const version = image ? image.slice(image.lastIndexOf(':') + 1) : null;

    container.register('errorReporter', () => new ErrorReporter(version));
    container.register('indexManager', c => new IndexManager(
        {
            errorReporter: c.errorReporter
        })
    );
    container.register('collectionManager', c => new MongoCollectionManager(
        {
            indexManager: c.indexManager
        }));
    container.register('valueSetManager', c => new ValueSetManager(
        {
            databaseQueryFactory: c.databaseQueryFactory
        }));
    container.register('resourceLocatorFactory', c => new ResourceLocatorFactory(
        {
            collectionManager: c.collectionManager
        }));

    container.register('databaseQueryFactory', c => new DatabaseQueryFactory(
        {
            resourceLocatorFactory: c.resourceLocatorFactory
        }));
    container.register('databaseHistoryFactory', c => new DatabaseHistoryFactory(
        {
            resourceLocatorFactory: c.resourceLocatorFactory
        }));
    container.register('databaseUpdateFactory', c => new DatabaseUpdateFactory(
        {
            resourceLocatorFactory: c.resourceLocatorFactory
        }));

    container.register('resourceManager', () => new ResourceManager());
    container.register('searchManager', c => new SearchManager(
            {
                databaseQueryFactory: c.databaseQueryFactory,
                resourceLocatorFactory: c.resourceLocatorFactory,
                securityTagManager: c.securityTagManager,
                resourcePreparer: c.resourcePreparer
            }
        )
    );

    container.register('securityTagManager', c => new SecurityTagManager(
        {
            scopesManager: c.scopesManager
        }));

    container.register('mergeManager', c => new MergeManager(
            {
                databaseQueryFactory: c.databaseQueryFactory,
                auditLogger: c.auditLogger,
                databaseBulkInserter: c.databaseBulkInserter,
                databaseBulkLoader: c.databaseBulkLoader,
                scopesManager: c.scopesManager
            }
        )
    );
    container.register('databaseBulkInserter', c => new DatabaseBulkInserter(
            {
                resourceManager: c.resourceManager,
                postRequestProcessor: c.postRequestProcessor,
                errorReporter: c.errorReporter,
                collectionManager: c.collectionManager,
                resourceLocatorFactory: c.resourceLocatorFactory
            }
        )
    );
    container.register('databaseBulkLoader', c => new DatabaseBulkLoader(
        {
            databaseQueryFactory: c.databaseQueryFactory
        }));
    container.register('postRequestProcessor', c => new PostRequestProcessor(
        {
            errorReporter: c.errorReporter
        }));
    container.register('auditLogger', c => new AuditLogger(
            {
                postRequestProcessor: c.postRequestProcessor,
                databaseBulkInserter: c.databaseBulkInserter,
                errorReporter: c.errorReporter
            }
        )
    );
    container.register('graphHelper', c => new GraphHelper(
            {
                databaseQueryFactory: c.databaseQueryFactory,
                securityTagManager: c.securityTagManager,
                scopesManager: c.scopesManager,
                scopesValidator: c.scopesValidator
            }
        )
    );

    container.register('bundleManager', () => new BundleManager());
    container.register('resourceCleaner', () => new ResourceCleaner());

    // register fhir operations
    container.register('searchBundleOperation', c => new SearchBundleOperation(
            {
                searchManager: c.searchManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                auditLogger: c.auditLogger,
                errorReporter: c.errorReporter,
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator,
                bundleManager: c.bundleManager
            }
        )
    );
    container.register('searchStreamingOperation', c => new SearchStreamingOperation(
            {
                searchManager: c.searchManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                auditLogger: c.auditLogger,
                errorReporter: c.errorReporter,
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator,
                bundleManager: c.bundleManager
            }
        )
    );
    container.register('searchByIdOperation', c => new SearchByIdOperation(
        {
            searchManager: c.searchManager,
            databaseQueryFactory: c.databaseQueryFactory,
            auditLogger: c.auditLogger,
            securityTagManager: c.securityTagManager,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator
        }
    ));
    container.register('createOperation', c => new CreateOperation(
            {
                postRequestProcessor: c.postRequestProcessor,
                auditLogger: c.auditLogger,
                changeEventProducer: c.changeEventProducer,
                databaseUpdateFactory: c.databaseUpdateFactory,
                databaseHistoryFactory: c.databaseHistoryFactory,
                scopesManager: c.scopesManager,
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator
            }
        )
    );
    container.register('updateOperation', c => new UpdateOperation(
            {
                postRequestProcessor: c.postRequestProcessor,
                auditLogger: c.auditLogger,
                changeEventProducer: c.changeEventProducer,
                databaseHistoryFactory: c.databaseHistoryFactory,
                databaseQueryFactory: c.databaseQueryFactory,
                scopesManager: c.scopesManager,
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator
            }
        )
    );
    container.register('mergeOperation', c => new MergeOperation(
        {
            mergeManager: c.mergeManager,
            postRequestProcessor: c.postRequestProcessor,
            collectionManager: c.collectionManager,
            changeEventProducer: c.changeEventProducer,
            databaseBulkLoader: c.databaseBulkLoader,
            databaseBulkInserter: c.databaseBulkInserter,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            bundleManager: c.bundleManager,
            resourceLocatorFactory: c.resourceLocatorFactory,
            resourceCleaner: c.resourceCleaner
        }
    ));
    container.register('everythingOperation', c => new EverythingOperation({
        graphOperation: c.graphOperation,
        fhirLoggingManager: c.fhirLoggingManager,
        scopesValidator: c.scopesValidator
    }));

    container.register('removeOperation', c => new RemoveOperation(
        {
            databaseQueryFactory: c.databaseQueryFactory,
            auditLogger: c.auditLogger,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator
        }
    ));
    container.register('searchByVersionIdOperation', c => new SearchByVersionIdOperation(
        {
            databaseHistoryFactory: c.databaseHistoryFactory,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator
        }
    ));
    container.register('historyOperation', c => new HistoryOperation(
        {
            databaseHistoryFactory: c.databaseHistoryFactory,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            bundleManager: c.bundleManager,
            resourceLocatorFactory: c.resourceLocatorFactory
        }
    ));
    container.register('historyByIdOperation', c => new HistoryByIdOperation(
        {
            databaseHistoryFactory: c.databaseHistoryFactory,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            bundleManager: c.bundleManager,
            resourceLocatorFactory: c.resourceLocatorFactory
        }
    ));
    container.register('patchOperation', c => new PatchOperation(
        {
            databaseQueryFactory: c.databaseQueryFactory,
            databaseHistoryFactory: c.databaseHistoryFactory,
            changeEventProducer: c.changeEventProducer,
            postRequestProcessor: c.postRequestProcessor,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator
        }
    ));
    container.register('validateOperation', c => new ValidateOperation(
        {
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager
        }
    ));
    container.register('graphOperation', c => new GraphOperation(
        {
            graphHelper: c.graphHelper,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator
        }
    ));
    container.register('expandOperation', c => new ExpandOperation(
        {
            valueSetManager: c.valueSetManager,
            databaseQueryFactory: c.databaseQueryFactory,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator
        }
    ));

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
    container.register('genericController', c => new GenericController(
            {
                postRequestProcessor: c.postRequestProcessor,
                fhirOperationsManager: c.fhirOperationsManager
            }
        )
    );
    container.register('controllerUtils', c => new ControllerUtils(
            {
                genericController: c.genericController
            }
        )
    );
    container.register('customOperationsController', c => new CustomOperationsController(
            {
                postRequestProcessor: c.postRequestProcessor,
                fhirOperationsManager: c.fhirOperationsManager
            }
        )
    );
    container.register('fhirRouter', c => new FhirRouter(
            {
                controllerUtils: c.controllerUtils,
                customOperationsController: c.customOperationsController
            }
        )
    );

    return container;
};
module.exports = {
    createContainer
};
