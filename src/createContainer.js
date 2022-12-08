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
const {IndexManager} = require('./indexes/indexManager');
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
const {GenericController} = require('./middleware/fhir/4_0_0/controllers/generic.controller');
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
const {getImageVersion} = require('./utils/getImageVersion');
const {ResourceMerger} = require('./operations/common/resourceMerger');
const {ResourceValidator} = require('./operations/common/resourceValidator');
const {PartitioningManager} = require('./partitioners/partitioningManager');
const {ConfigManager} = require('./utils/configManager');
const {AccessIndexManager} = require('./operations/common/accessIndexManager');
const {FhirResponseWriter} = require('./middleware/fhir/fhirResponseWriter');
const {IndexHinter} = require('./indexes/indexHinter');
const {IndexProvider} = require('./indexes/indexProvider');
const {MongoDatabaseManager} = require('./utils/mongoDatabaseManager');
const {R4SearchQueryCreator} = require('./operations/query/r4');
const {FhirTypesManager} = require('./fhir/fhirTypesManager');
const {PreSaveManager} = require('./preSaveHandlers/preSave');
const {EnrichmentManager} = require('./enrich/enrich');
const {QueryRewriterManager} = require('./queryRewriters/queryRewriterManager');
const {ExplanationOfBenefitsEnrichmentProvider} = require('./enrich/providers/explanationOfBenefitsEnrichmentProvider');
const {IdEnrichmentProvider} = require('./enrich/providers/idEnrichmentProvider');
const {PatientProxyQueryRewriter} = require('./queryRewriters/rewriters/patientProxyQueryRewriter');
const {DateColumnHandler} = require('./preSaveHandlers/handlers/dateColumnHandler');
const {SourceIdColumnHandler} = require('./preSaveHandlers/handlers/sourceIdColumnHandler');
const {UuidColumnHandler} = require('./preSaveHandlers/handlers/uuidColumnHandler');
const {AccessColumnHandler} = require('./preSaveHandlers/handlers/accessColumnHandler');
const {SourceAssigningAuthorityColumnHandler} = require('./preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const {PersonToPatientIdsExpander} = require('./utils/personToPatientIdsExpander');
const {AdminPersonPatientLinkManager} = require('./admin/adminPersonPatientLinkManager');
const {BwellPersonFinder} = require('./utils/bwellPersonFinder');
const {RequestSpecificCache} = require('./utils/requestSpecificCache');
const {PatientFilterManager} = require('./fhir/patientFilterManager');
const {AdminPersonPatientDataManager} = require('./admin/adminPersonPatientDataManager');
const {ProxyPatientReferenceEnrichmentProvider} = require('./enrich/providers/proxyPatientReferenceEnrichmentProvider');

/**
 * Creates a container and sets up all the services
 * @return {SimpleContainer}
 */
const createContainer = function () {
    // Note: the order of registration does NOT matter since everything is lazy evaluated
    const container = new SimpleContainer();

    container.register('configManager', () => new ConfigManager());

    container.register('scopesManager', (c) => new ScopesManager(
        {
            configManager: c.configManager
        }
    ));

    container.register('requestSpecificCache', () => new RequestSpecificCache());

    container.register('patientFilterManager', () => new PatientFilterManager());


    container.register('enrichmentManager', () => new EnrichmentManager({
        enrichmentProviders: [
            new ExplanationOfBenefitsEnrichmentProvider(),
            new IdEnrichmentProvider(),
            new ProxyPatientReferenceEnrichmentProvider()
        ]
    }));
    container.register('resourcePreparer', (c) => new ResourcePreparer(
        {
            scopesManager: c.scopesManager,
            accessIndexManager: c.accessIndexManager,
            enrichmentManager: c.enrichmentManager
        }
    ));
    container.register('preSaveManager', () => new PreSaveManager({
        preSaveHandlers: [
            new DateColumnHandler(),
            new SourceIdColumnHandler(),
            new UuidColumnHandler(),
            new AccessColumnHandler(),
            new SourceAssigningAuthorityColumnHandler()
        ]
    }));
    container.register('resourceMerger', (c) => new ResourceMerger({
        preSaveManager: c.preSaveManager
    }));
    container.register('scopesValidator', (c) => new ScopesValidator({
        scopesManager: c.scopesManager,
        fhirLoggingManager: c.fhirLoggingManager,
        configManager: c.configManager
    }));
    container.register('resourceValidator', () => new ResourceValidator());
    container.register('fhirLoggingManager', (c) => new FhirLoggingManager({
        scopesManager: c.scopesManager,
        imageVersion: getImageVersion()
    }));
    container.register('kafkaClient', () =>
        isTrue(env.ENABLE_EVENTS_KAFKA) ?
            new KafkaClient(
                {
                    clientId: env.KAFKA_CLIENT_ID,
                    brokers: env.KAFKA_URLS ? env.KAFKA_URLS.split(',') : '',
                    ssl: isTrue(env.KAFKA_SSL),
                    sasl: isTrue(env.KAFKA_SASL) ? {
                        // https://kafka.js.org/docs/configuration#sasl
                        mechanism: env.KAFKA_SASL_MECHANISM || 'aws',
                        authorizationIdentity: env.KAFKA_SASL_IDENTITY ? env.KAFKA_SASL_IDENTITY : null, // UserId or RoleId
                        username: env.KAFKA_SASL_USERNAME || null,
                        password: env.KAFKA_SASL_PASSWORD || null,
                        accessKeyId: env.KAFKA_SASL_ACCESS_KEY_ID || null,
                        secretAccessKey: env.KAFKA_SASL_ACCESS_KEY_SECRET || null
                    } : null,
                }
            ) :
            new DummyKafkaClient({clientId: '', brokers: []})
    );
    container.register('changeEventProducer', (c) => new ChangeEventProducer(
        {
            kafkaClient: c.kafkaClient,
            resourceManager: c.resourceManager,
            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
            taskChangeTopic: env.KAFKA_TASK_CHANGE_TOPIC || 'business.events',
            observationChangeTopic: env.KAFKA_OBSERVATION_CHANGE_TOPIC || 'business.events',
            bwellPersonFinder: c.bwellPersonFinder,
            requestSpecificCache: c.requestSpecificCache
        }
    ));

    container.register('partitioningManager', (c) => new PartitioningManager(
        {
            configManager: c.configManager,
            mongoDatabaseManager: c.mongoDatabaseManager
        }));
    container.register('errorReporter', () => new ErrorReporter(getImageVersion()));
    container.register('indexProvider', (c) => new IndexProvider({
        configManager: c.configManager
    }));
    container.register('mongoDatabaseManager', () => new MongoDatabaseManager());
    container.register('indexManager', (c) => new IndexManager(
        {
            errorReporter: c.errorReporter,
            indexProvider: c.indexProvider,
            mongoDatabaseManager: c.mongoDatabaseManager
        })
    );
    container.register('mongoCollectionManager', (c) => new MongoCollectionManager(
        {
            indexManager: c.indexManager
        }));
    container.register('valueSetManager', (c) => new ValueSetManager(
        {
            databaseQueryFactory: c.databaseQueryFactory
        }));
    container.register('resourceLocatorFactory', (c) => new ResourceLocatorFactory(
        {
            mongoCollectionManager: c.mongoCollectionManager,
            partitioningManager: c.partitioningManager,
            mongoDatabaseManager: c.mongoDatabaseManager
        }));

    container.register('databaseQueryFactory', (c) => new DatabaseQueryFactory(
        {
            resourceLocatorFactory: c.resourceLocatorFactory
        }));
    container.register('databaseHistoryFactory', (c) => new DatabaseHistoryFactory(
        {
            resourceLocatorFactory: c.resourceLocatorFactory
        }));
    container.register('databaseUpdateFactory', (c) => new DatabaseUpdateFactory(
        {
            resourceLocatorFactory: c.resourceLocatorFactory
        }));

    container.register('resourceManager', () => new ResourceManager());
    container.register('indexHinter', (c) => new IndexHinter({
        indexProvider: c.indexProvider
    }));
    container.register('personToPatientIdsExpander', (c) => new PersonToPatientIdsExpander({
        databaseQueryFactory: c.databaseQueryFactory
    }));

    container.register('queryRewriterManager', (c) => new QueryRewriterManager({
        queryRewriters: [
            new PatientProxyQueryRewriter({
                personToPatientIdsExpander: c.personToPatientIdsExpander
            })
        ]
    }));

    container.register('searchManager', (c) => new SearchManager(
            {
                databaseQueryFactory: c.databaseQueryFactory,
                resourceLocatorFactory: c.resourceLocatorFactory,
                securityTagManager: c.securityTagManager,
                resourcePreparer: c.resourcePreparer,
                indexHinter: c.indexHinter,
                r4SearchQueryCreator: c.r4SearchQueryCreator,
                configManager: c.configManager,
                queryRewriterManager: c.queryRewriterManager,
                personToPatientIdsExpander: c.personToPatientIdsExpander,
                scopesManager: c.scopesManager
            }
        )
    );

    container.register('securityTagManager', (c) => new SecurityTagManager(
        {
            scopesManager: c.scopesManager,
            accessIndexManager: c.accessIndexManager,
            patientFilterManager: c.patientFilterManager
        }));

    container.register('mergeManager', (c) => new MergeManager(
            {
                databaseQueryFactory: c.databaseQueryFactory,
                auditLogger: c.auditLogger,
                databaseBulkInserter: c.databaseBulkInserter,
                databaseBulkLoader: c.databaseBulkLoader,
                scopesManager: c.scopesManager,
                resourceMerger: c.resourceMerger,
                resourceValidator: c.resourceValidator,
                preSaveManager: c.preSaveManager,
                configManager: c.configManager
            }
        )
    );
    container.register('databaseBulkInserter', (c) => new DatabaseBulkInserter(
            {
                resourceManager: c.resourceManager,
                postRequestProcessor: c.postRequestProcessor,
                errorReporter: c.errorReporter,
                mongoCollectionManager: c.mongoCollectionManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                changeEventProducer: c.changeEventProducer,
                preSaveManager: c.preSaveManager,
                requestSpecificCache: c.requestSpecificCache
            }
        )
    );
    container.register('databaseBulkLoader', (c) => new DatabaseBulkLoader(
        {
            databaseQueryFactory: c.databaseQueryFactory,
            requestSpecificCache: c.requestSpecificCache
        }));
    container.register('postRequestProcessor', (c) => new PostRequestProcessor(
        {
            errorReporter: c.errorReporter,
            requestSpecificCache: c.requestSpecificCache
        }));
    container.register('auditLogger', (c) => new AuditLogger(
            {
                postRequestProcessor: c.postRequestProcessor,
                databaseBulkInserter: c.databaseBulkInserter,
                errorReporter: c.errorReporter
            }
        )
    );
    container.register('graphHelper', (c) => new GraphHelper(
            {
                databaseQueryFactory: c.databaseQueryFactory,
                securityTagManager: c.securityTagManager,
                scopesManager: c.scopesManager,
                scopesValidator: c.scopesValidator,
                configManager: c.configManager,
                bundleManager: c.bundleManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                r4SearchQueryCreator: c.r4SearchQueryCreator,
                searchManager: c.searchManager,
                enrichmentManager: c.enrichmentManager
            }
        )
    );

    container.register('bundleManager', (c) => new BundleManager({
        resourceManager: c.resourceManager
    }));
    // register fhir operations
    container.register('searchBundleOperation', (c) => new SearchBundleOperation(
            {
                searchManager: c.searchManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                auditLogger: c.auditLogger,
                errorReporter: c.errorReporter,
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator,
                bundleManager: c.bundleManager,
                configManager: c.configManager
            }
        )
    );
    container.register('searchStreamingOperation', (c) => new SearchStreamingOperation(
            {
                searchManager: c.searchManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                auditLogger: c.auditLogger,
                errorReporter: c.errorReporter,
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator,
                bundleManager: c.bundleManager,
                configManager: c.configManager
            }
        )
    );
    container.register('searchByIdOperation', (c) => new SearchByIdOperation(
        {
            searchManager: c.searchManager,
            databaseQueryFactory: c.databaseQueryFactory,
            auditLogger: c.auditLogger,
            securityTagManager: c.securityTagManager,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            enrichmentManager: c.enrichmentManager,
            configManager: c.configManager
        }
    ));
    container.register('createOperation', (c) => new CreateOperation(
            {
                postRequestProcessor: c.postRequestProcessor,
                auditLogger: c.auditLogger,
                changeEventProducer: c.changeEventProducer,
                scopesManager: c.scopesManager,
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator,
                resourceValidator: c.resourceValidator,
                databaseBulkInserter: c.databaseBulkInserter
            }
        )
    );
    container.register('updateOperation', (c) => new UpdateOperation(
            {
                postRequestProcessor: c.postRequestProcessor,
                auditLogger: c.auditLogger,
                changeEventProducer: c.changeEventProducer,
                databaseQueryFactory: c.databaseQueryFactory,
                scopesManager: c.scopesManager,
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator,
                resourceValidator: c.resourceValidator,
                bundleManager: c.bundleManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                databaseBulkInserter: c.databaseBulkInserter,
                resourceMerger: c.resourceMerger
            }
        )
    );
    container.register('mergeOperation', (c) => new MergeOperation(
        {
            mergeManager: c.mergeManager,
            postRequestProcessor: c.postRequestProcessor,
            mongoCollectionManager: c.mongoCollectionManager,
            changeEventProducer: c.changeEventProducer,
            databaseBulkLoader: c.databaseBulkLoader,
            databaseBulkInserter: c.databaseBulkInserter,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            bundleManager: c.bundleManager,
            resourceLocatorFactory: c.resourceLocatorFactory,
            resourceValidator: c.resourceValidator
        }
    ));
    container.register('everythingOperation', (c) => new EverythingOperation({
        graphOperation: c.graphOperation,
        fhirLoggingManager: c.fhirLoggingManager,
        scopesValidator: c.scopesValidator
    }));

    container.register('removeOperation', (c) => new RemoveOperation(
        {
            databaseQueryFactory: c.databaseQueryFactory,
            auditLogger: c.auditLogger,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            configManager: c.configManager,
            r4SearchQueryCreator: c.r4SearchQueryCreator
        }
    ));
    container.register('searchByVersionIdOperation', (c) => new SearchByVersionIdOperation(
        {
            databaseHistoryFactory: c.databaseHistoryFactory,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            enrichmentManager: c.enrichmentManager,
            configManager: c.configManager,
            searchManager: c.searchManager
        }
    ));
    container.register('historyOperation', (c) => new HistoryOperation(
        {
            databaseHistoryFactory: c.databaseHistoryFactory,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            bundleManager: c.bundleManager,
            resourceLocatorFactory: c.resourceLocatorFactory,
            configManager: c.configManager,
            searchManager: c.searchManager,
            resourceManager: c.resourceManager
        }
    ));
    container.register('historyByIdOperation', (c) => new HistoryByIdOperation(
        {
            databaseHistoryFactory: c.databaseHistoryFactory,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            bundleManager: c.bundleManager,
            resourceLocatorFactory: c.resourceLocatorFactory,
            configManager: c.configManager,
            searchManager: c.searchManager,
            resourceManager: c.resourceManager
        }
    ));
    container.register('patchOperation', (c) => new PatchOperation(
        {
            databaseQueryFactory: c.databaseQueryFactory,
            changeEventProducer: c.changeEventProducer,
            postRequestProcessor: c.postRequestProcessor,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            databaseBulkInserter: c.databaseBulkInserter
        }
    ));
    container.register('validateOperation', (c) => new ValidateOperation(
        {
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            resourceValidator: c.resourceValidator
        }
    ));
    container.register('graphOperation', (c) => new GraphOperation(
        {
            graphHelper: c.graphHelper,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            resourceValidator: c.resourceValidator,
            resourceLocatorFactory: c.resourceLocatorFactory
        }
    ));
    container.register('expandOperation', (c) => new ExpandOperation(
        {
            valueSetManager: c.valueSetManager,
            databaseQueryFactory: c.databaseQueryFactory,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            enrichmentManager: c.enrichmentManager
        }
    ));

    // now register the routing for fhir
    container.register('fhirOperationsManager', (c) => new FhirOperationsManager(
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
    container.register('fhirResponseWriter', () => new FhirResponseWriter());
    container.register('genericController', (c) => new GenericController(
            {
                postRequestProcessor: c.postRequestProcessor,
                fhirOperationsManager: c.fhirOperationsManager,
                fhirResponseWriter: c.fhirResponseWriter,
                configManager: c.configManager,
                requestSpecificCache: c.requestSpecificCache
            }
        )
    );
    container.register('controllerUtils', (c) => new ControllerUtils(
            {
                genericController: c.genericController
            }
        )
    );
    container.register('customOperationsController', (c) => new CustomOperationsController(
            {
                postRequestProcessor: c.postRequestProcessor,
                fhirOperationsManager: c.fhirOperationsManager,
                fhirResponseWriter: c.fhirResponseWriter,
                requestSpecificCache: c.requestSpecificCache
            }
        )
    );
    container.register('fhirRouter', (c) => new FhirRouter(
            {
                controllerUtils: c.controllerUtils,
                customOperationsController: c.customOperationsController
            }
        )
    );

    container.register('accessIndexManager', (c) => new AccessIndexManager({
        configManager: c.configManager,
        indexProvider: c.indexProvider
    }));

    container.register('fhirTypesManager', () => new FhirTypesManager());

    container.register('r4SearchQueryCreator', (c) => new R4SearchQueryCreator(
        {
            configManager: c.configManager,
            accessIndexManager: c.accessIndexManager,
            fhirTypesManager: c.fhirTypesManager
        }));

    container.register('adminPersonPatientLinkManager', (c) => new AdminPersonPatientLinkManager({
        databaseQueryFactory: c.databaseQueryFactory,
        databaseUpdateFactory: c.databaseUpdateFactory
    }));

    container.register('bwellPersonFinder', (c) => new BwellPersonFinder({
        databaseQueryFactory: c.databaseQueryFactory
    }));

    container.register('adminPersonPatientDataManager', (c) => new AdminPersonPatientDataManager(
        {
            fhirOperationsManager: c.fhirOperationsManager,
            everythingOperation: c.everythingOperation,
            databaseQueryFactory: c.databaseQueryFactory,
            databaseUpdateFactory: c.databaseUpdateFactory
        }));

    return container;
};
module.exports = {
    createContainer
};
