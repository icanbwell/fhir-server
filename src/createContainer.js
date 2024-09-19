// noinspection JSUnresolvedReference

const { SimpleContainer } = require('./utils/simpleContainer');
const env = require('var');
const { AccessLogger } = require('./utils/accessLogger');
const { ChangeEventProducer } = require('./utils/changeEventProducer');
const { ResourceManager } = require('./operations/common/resourceManager');
const { DatabaseBulkInserter } = require('./dataLayer/databaseBulkInserter');
const { DatabaseBulkLoader } = require('./dataLayer/databaseBulkLoader');
const { DatabaseAttachmentManager } = require('./dataLayer/databaseAttachmentManager');
const { PostRequestProcessor } = require('./utils/postRequestProcessor');
const { AuditLogger } = require('./utils/auditLogger');
const { MongoCollectionManager } = require('./utils/mongoCollectionManager');
const { IndexManager } = require('./indexes/indexManager');
const { ValueSetManager } = require('./utils/valueSet.util');
const { DatabaseQueryFactory } = require('./dataLayer/databaseQueryFactory');
const { ResourceLocatorFactory } = require('./operations/common/resourceLocatorFactory');
const { DatabaseHistoryFactory } = require('./dataLayer/databaseHistoryFactory');
const { MergeManager } = require('./operations/merge/mergeManager');
const { DatabaseUpdateFactory } = require('./dataLayer/databaseUpdateFactory');
const { SearchManager } = require('./operations/search/searchManager');
const { GraphHelper } = require('./operations/graph/graphHelpers');
const { FhirRouter } = require('./middleware/fhir/router');
const { ControllerUtils } = require('./middleware/fhir/controller.utils');
const { CustomOperationsController } = require('./middleware/fhir/4_0_0/controllers/operations.controller');
const { GenericController } = require('./middleware/fhir/4_0_0/controllers/generic.controller');
const { FhirOperationsManager } = require('./operations/fhirOperationsManager');
const { SearchBundleOperation } = require('./operations/search/searchBundle');
const { SearchStreamingOperation } = require('./operations/search/searchStreaming');
const { CreateOperation } = require('./operations/create/create');
const { UpdateOperation } = require('./operations/update/update');
const { MergeOperation } = require('./operations/merge/merge');
const { EverythingOperation } = require('./operations/everything/everything');
const { RemoveOperation } = require('./operations/remove/remove');
const { SearchByVersionIdOperation } = require('./operations/searchByVersionId/searchByVersionId');
const { HistoryByIdOperation } = require('./operations/historyById/historyById');
const { HistoryOperation } = require('./operations/history/history');
const { PatchOperation } = require('./operations/patch/patch');
const { ValidateOperation } = require('./operations/validate/validate');
const { GraphOperation } = require('./operations/graph/graph');
const { ExpandOperation } = require('./operations/expand/expand');
const { SearchByIdOperation } = require('./operations/searchById/searchById');
const { SecurityTagManager } = require('./operations/common/securityTagManager');
const { FhirLoggingManager } = require('./operations/common/fhirLoggingManager');
const { ScopesManager } = require('./operations/security/scopesManager');
const { ScopesValidator } = require('./operations/security/scopesValidator');
const { ResourcePreparer } = require('./operations/common/resourcePreparer');
const { BundleManager } = require('./operations/common/bundleManager');
const { getImageVersion } = require('./utils/getImageVersion');
const { ResourceMerger } = require('./operations/common/resourceMerger');
const { ResourceValidator } = require('./operations/common/resourceValidator');
const { PartitioningManager } = require('./partitioners/partitioningManager');
const { ConfigManager } = require('./utils/configManager');
const { AccessIndexManager } = require('./operations/common/accessIndexManager');
const { FhirResponseWriter } = require('./middleware/fhir/fhirResponseWriter');
const { IndexHinter } = require('./indexes/indexHinter');
const { IndexProvider } = require('./indexes/indexProvider');
const { MongoDatabaseManager } = require('./utils/mongoDatabaseManager');
const { R4SearchQueryCreator } = require('./operations/query/r4');
const { FhirTypesManager } = require('./fhir/fhirTypesManager');
const { PreSaveManager } = require('./preSaveHandlers/preSave');
const { EnrichmentManager } = require('./enrich/enrich');
const { QueryRewriterManager } = require('./queryRewriters/queryRewriterManager');
const { IdEnrichmentProvider } = require('./enrich/providers/idEnrichmentProvider');
const { PatientProxyQueryRewriter } = require('./queryRewriters/rewriters/patientProxyQueryRewriter');
const { DateColumnHandler } = require('./preSaveHandlers/handlers/dateColumnHandler');
const { SourceIdColumnHandler } = require('./preSaveHandlers/handlers/sourceIdColumnHandler');
const { UuidColumnHandler } = require('./preSaveHandlers/handlers/uuidColumnHandler');
const { AccessColumnHandler } = require('./preSaveHandlers/handlers/accessColumnHandler');
const { SourceAssigningAuthorityColumnHandler } = require('./preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { PersonToPatientIdsExpander } = require('./utils/personToPatientIdsExpander');
const { AdminPersonPatientLinkManager } = require('./admin/adminPersonPatientLinkManager');
const { BwellPersonFinder } = require('./utils/bwellPersonFinder');
const { RequestSpecificCache } = require('./utils/requestSpecificCache');
const { PatientFilterManager } = require('./fhir/patientFilterManager');
const { AdminPersonPatientDataManager } = require('./admin/adminPersonPatientDataManager');
const { ProxyPatientReferenceEnrichmentProvider } = require('./enrich/providers/proxyPatientReferenceEnrichmentProvider');
const { KafkaClient } = require('./utils/kafkaClient');
const { DummyKafkaClient } = require('./utils/dummyKafkaClient');
const { PersonMatchManager } = require('./admin/personMatchManager');
const { MongoFilterGenerator } = require('./utils/mongoFilterGenerator');
const { R4ArgsParser } = require('./operations/query/r4ArgsParser');
const { UuidToIdReplacer } = require('./utils/uuidToIdReplacer');
const { K8sClient } = require('./utils/k8sClient');
const { GlobalIdEnrichmentProvider } = require('./enrich/providers/globalIdEnrichmentProvider');
const { ReferenceGlobalIdHandler } = require('./preSaveHandlers/handlers/referenceGlobalIdHandler');
const { OwnerColumnHandler } = require('./preSaveHandlers/handlers/ownerColumnHandler');
const { HashReferencesEnrichmentProvider } = require('./enrich/providers/hashedReferencesEnrichmentProvider');
const { FhirResourceWriterFactory } = require('./operations/streaming/resourceWriters/fhirResourceWriterFactory');
const { ProaConsentManager } = require('./operations/search/proaConsentManager');
const { DataSharingManager } = require('./operations/search/dataSharingManager');
const { SearchQueryBuilder } = require('./operations/search/searchQueryBuilder');
const { MergeValidator } = require('./operations/merge/mergeValidator');
const { ParametersResourceValidator } = require('./operations/merge/validators/parameterResourceValidator');
const { BundleResourceValidator } = require('./operations/merge/validators/bundleResourceValidator');
const { MergeResourceValidator } = require('./operations/merge/validators/mergeResourceValidator');
const { RemoteFhirValidator } = require('./utils/remoteFhirValidator');
const { PostSaveProcessor } = require('./dataLayer/postSaveProcessor');
const { ProfileUrlMapper } = require('./utils/profileMapper');
const { ReferenceQueryRewriter } = require('./queryRewriters/rewriters/referenceQueryRewriter');
const { PatientScopeManager } = require('./operations/security/patientScopeManager');
const { WriteAllowedByScopesValidator } = require('./operations/merge/validators/writeAllowedByScopesValidator');
const { PatientQueryCreator } = require('./operations/common/patientQueryCreator');
const { SearchParametersManager } = require('./searchParameters/searchParametersManager');
const { DatabaseExportManager } = require('./dataLayer/databaseExportManager');
const { ExportOperation } = require('./operations/export/export');
const { ExportManager } = require('./operations/export/exportManager');
const { ExportByIdOperation } = require('./operations/export/exportById');
const { AdminExportManager } = require('./admin/adminExportManager');
const { ExportEventProducer } = require('./utils/exportEventProducer');
const { READ } = require('./constants').OPERATIONS;
/**
 * Creates a container and sets up all the services
 * @return {SimpleContainer}
 */
const createContainer = function () {
    // Note: the order of registration does NOT matter since everything is lazy evaluated
    const container = new SimpleContainer();

    container.register('configManager', () => new ConfigManager());

    container.register('kafkaClient', (c) => c.configManager.kafkaEnableEvents
        ? new KafkaClient({ configManager: c.configManager })
        : new DummyKafkaClient({ configManager: c.configManager })
    );

    container.register('scopesManager', (c) => new ScopesManager({
        configManager: c.configManager,
        patientFilterManager: c.patientFilterManager
    }));

    container.register('requestSpecificCache', () => new RequestSpecificCache());

    container.register('patientFilterManager', () => new PatientFilterManager());

    container.register('enrichmentManager', (c) => new EnrichmentManager({
        enrichmentProviders: [
            new IdEnrichmentProvider(),
            new ProxyPatientReferenceEnrichmentProvider({
                configManager: c.configManager
            }),
            new GlobalIdEnrichmentProvider({
                databaseQueryFactory: c.databaseQueryFactory
            }),
            new HashReferencesEnrichmentProvider()
        ]
    }));
    container.register('resourcePreparer', (c) => new ResourcePreparer(
        {
            scopesManager: c.scopesManager,
            accessIndexManager: c.accessIndexManager,
            enrichmentManager: c.enrichmentManager,
            resourceManager: c.resourceManager
        }
    ));
    container.register('preSaveManager', (c) => new PreSaveManager({
        preSaveHandlers: [
            new DateColumnHandler(),
            new SourceIdColumnHandler(),
            new AccessColumnHandler(),
            new OwnerColumnHandler(),
            new SourceAssigningAuthorityColumnHandler(),
            // UuidColumnHandler MUST come after SourceAssigningAuthorityColumnHandler since
            // it uses sourceAssigningAuthority value
            new UuidColumnHandler({
                configManager: c.configManager
            }),
            // ReferenceGlobalIdHandler should come after SourceAssigningAuthorityColumnHandler and UuidColumnHandler
            new ReferenceGlobalIdHandler({
                configManager: c.configManager
            })
        ]
    }));
    container.register('resourceMerger', (c) => new ResourceMerger({
        preSaveManager: c.preSaveManager
    }));
    container.register('scopesValidator', (c) => new ScopesValidator({
        scopesManager: c.scopesManager,
        fhirLoggingManager: c.fhirLoggingManager,
        configManager: c.configManager,
        patientScopeManager: c.patientScopeManager,
        preSaveManager: c.preSaveManager
    }));
    container.register('profileUrlMapper', (_c) => new ProfileUrlMapper());

    container.register('remoteFhirValidator', (c) => new RemoteFhirValidator(
        {
            configManager: c.configManager,
            profileUrlMapper: c.profileUrlMapper
        }
    ));
    container.register('resourceValidator', (c) => new ResourceValidator(
        {
            configManager: c.configManager,
            remoteFhirValidator: c.remoteFhirValidator,
            databaseQueryFactory: c.databaseQueryFactory,
            databaseUpdateFactory: c.databaseUpdateFactory,
            scopesManager: c.scopesManager,
            patientFilterManager: c.patientFilterManager
        }
    ));
    container.register('fhirLoggingManager', (c) => new FhirLoggingManager({
        scopesManager: c.scopesManager,
        imageVersion: getImageVersion()
    }));
    container.register('changeEventProducer', (c) => new ChangeEventProducer(
        {
            kafkaClient: c.kafkaClient,
            resourceManager: c.resourceManager,
            fhirResourceChangeTopic: env.KAFKA_RESOURCE_CHANGE_TOPIC || 'business.events',
            configManager: c.configManager
        }
    ));
    container.register('exportEventProducer', (c) => new ExportEventProducer(
        {
            kafkaClient: c.kafkaClient,
            fhirExportEventTopic: env.KAFKA_EXPORT_EVENT_TOPIC || 'fhir.bulk_export.events',
            configManager: c.configManager
        }
    ));
    container.register('searchQueryBuilder', (c) => new SearchQueryBuilder({
        r4SearchQueryCreator: c.r4SearchQueryCreator
    }));
    container.register('proaConsentManager', (c) => new ProaConsentManager({
        databaseQueryFactory: c.databaseQueryFactory,
        configManager: c.configManager,
        patientFilterManager: c.patientFilterManager,
        searchQueryBuilder: c.searchQueryBuilder,
        bwellPersonFinder: c.bwellPersonFinder
    }));
    container.register('dataSharingManager', (c) => new DataSharingManager({
        databaseQueryFactory: c.databaseQueryFactory,
        configManager: c.configManager,
        patientFilterManager: c.patientFilterManager,
        searchQueryBuilder: c.searchQueryBuilder,
        bwellPersonFinder: c.bwellPersonFinder,
        proaConsentManager: c.proaConsentManager,
        requestSpecificCache: c.requestSpecificCache
    }));
    container.register('partitioningManager', (c) => new PartitioningManager(
        {
            configManager: c.configManager,
            mongoDatabaseManager: c.mongoDatabaseManager
        }));
    container.register('indexProvider', (c) => new IndexProvider({
        configManager: c.configManager
    }));
    container.register('mongoDatabaseManager', (c) => new MongoDatabaseManager({
        configManager: c.configManager
    }));
    container.register('indexManager', (c) => new IndexManager(
        {
            indexProvider: c.indexProvider,
            mongoDatabaseManager: c.mongoDatabaseManager
        })
    );
    container.register('mongoCollectionManager', (c) => new MongoCollectionManager(
        {
            indexManager: c.indexManager,
            configManager: c.configManager,
            mongoDatabaseManager: c.mongoDatabaseManager
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
            resourceLocatorFactory: c.resourceLocatorFactory,
            mongoFilterGenerator: c.mongoFilterGenerator,
            databaseAttachmentManager: c.databaseAttachmentManager
        }));
    container.register('databaseHistoryFactory', (c) => new DatabaseHistoryFactory(
        {
            resourceLocatorFactory: c.resourceLocatorFactory
        }));
    container.register('databaseUpdateFactory', (c) => new DatabaseUpdateFactory(
        {
            resourceLocatorFactory: c.resourceLocatorFactory,
            resourceMerger: c.resourceMerger,
            preSaveManager: c.preSaveManager,
            databaseQueryFactory: c.databaseQueryFactory,
            configManager: c.configManager
        }));

    container.register('resourceManager', (c) => new ResourceManager(
        {
            searchParametersManager: c.searchParametersManager
        }));
    container.register('indexHinter', (c) => new IndexHinter({
        indexProvider: c.indexProvider
    }));
    container.register('personToPatientIdsExpander', (c) => new PersonToPatientIdsExpander({
        databaseQueryFactory: c.databaseQueryFactory
    }));

    container.register('queryRewriterManager', (c) => new QueryRewriterManager({
        queryRewriters: [
            new ReferenceQueryRewriter()
        ],
        operationSpecificQueryRewriters: {
            [READ]: [
                new PatientProxyQueryRewriter({
                    personToPatientIdsExpander: c.personToPatientIdsExpander,
                    configManager: c.configManager
                })
            ]
        }
    }));

    container.register('patientScopeManager', (c) => new PatientScopeManager(
        {
            databaseQueryFactory: c.databaseQueryFactory,
            personToPatientIdsExpander: c.personToPatientIdsExpander,
            scopesManager: c.scopesManager,
            patientFilterManager: c.patientFilterManager
        }
    ));

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
                scopesManager: c.scopesManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                fhirResourceWriterFactory: c.fhirResourceWriterFactory,
                proaConsentManager: c.proaConsentManager,
                dataSharingManager: c.dataSharingManager,
                searchQueryBuilder: c.searchQueryBuilder,
                patientScopeManager: c.patientScopeManager,
                patientQueryCreator: c.patientQueryCreator
            }
        )
    );

    container.register('securityTagManager', (c) => new SecurityTagManager(
        {
            scopesManager: c.scopesManager,
            accessIndexManager: c.accessIndexManager,
            patientFilterManager: c.patientFilterManager,
            r4SearchQueryCreator: c.r4SearchQueryCreator
        }));

    container.register('mergeManager', (c) => new MergeManager(
            {
                databaseQueryFactory: c.databaseQueryFactory,
                auditLogger: c.auditLogger,
                databaseBulkInserter: c.databaseBulkInserter,
                databaseBulkLoader: c.databaseBulkLoader,
                scopesManager: c.scopesManager,
                scopesValidator: c.scopesValidator,
                resourceMerger: c.resourceMerger,
                resourceValidator: c.resourceValidator,
                preSaveManager: c.preSaveManager,
                configManager: c.configManager,
                mongoFilterGenerator: c.mongoFilterGenerator,
                databaseAttachmentManager: c.databaseAttachmentManager,
                postRequestProcessor: c.postRequestProcessor
            }
        )
    );

    container.register('mergeValidator', (c) => new MergeValidator(
        {
            validators: [
                new BundleResourceValidator({
                    resourceValidator: c.resourceValidator
                }),
                new ParametersResourceValidator(),
                new MergeResourceValidator({
                    mergeManager: c.mergeManager,
                    databaseBulkLoader: c.databaseBulkLoader,
                    preSaveManager: c.preSaveManager,
                    configManager: c.configManager,
                    resourceValidator: c.resourceValidator
                }),
                new WriteAllowedByScopesValidator({
                    scopesValidator: c.scopesValidator,
                    databaseBulkLoader: c.databaseBulkLoader
                })
            ]
        }
    ));

    container.register('databaseBulkInserter', (c) => new DatabaseBulkInserter(
            {
                resourceManager: c.resourceManager,
                postRequestProcessor: c.postRequestProcessor,
                mongoCollectionManager: c.mongoCollectionManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                postSaveProcessor: c.postSaveProcessor,
                preSaveManager: c.preSaveManager,
                requestSpecificCache: c.requestSpecificCache,
                databaseUpdateFactory: c.databaseUpdateFactory,
                resourceMerger: c.resourceMerger,
                configManager: c.configManager,
                mongoFilterGenerator: c.mongoFilterGenerator,
                databaseAttachmentManager: c.databaseAttachmentManager
            }
        )
    );
    container.register('databaseBulkLoader', (c) => new DatabaseBulkLoader(
        {
            databaseQueryFactory: c.databaseQueryFactory,
            requestSpecificCache: c.requestSpecificCache,
            configManager: c.configManager
        }));
    container.register('postRequestProcessor', (c) => new PostRequestProcessor(
        {
            requestSpecificCache: c.requestSpecificCache
        }));
    container.register('auditLogger', (c) => new AuditLogger(
            {
                postRequestProcessor: c.postRequestProcessor,
                databaseBulkInserter: c.databaseBulkInserter,
                configManager: c.configManager,
                preSaveManager: c.preSaveManager
            }
        )
    );
    container.register('accessLogger', (c) => new AccessLogger(
            {
                databaseUpdateFactory: c.databaseUpdateFactory,
                scopesManager: c.scopesManager,
                fhirOperationsManager: c.fhirOperationsManager,
                imageVersion: getImageVersion()
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
                enrichmentManager: c.enrichmentManager,
                r4ArgsParser: c.r4ArgsParser,
                databaseAttachmentManager: c.databaseAttachmentManager,
                searchParametersManager: c.searchParametersManager,
                searchBundleOperation: c.searchBundleOperation
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
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator,
                bundleManager: c.bundleManager,
                configManager: c.configManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                postRequestProcessor: c.postRequestProcessor
            }
        )
    );
    container.register('searchStreamingOperation', (c) => new SearchStreamingOperation(
            {
                searchManager: c.searchManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                auditLogger: c.auditLogger,
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator,
                bundleManager: c.bundleManager,
                configManager: c.configManager,
                postRequestProcessor: c.postRequestProcessor
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
            configManager: c.configManager,
            databaseAttachmentManager: c.databaseAttachmentManager,
            postRequestProcessor: c.postRequestProcessor
        }
    ));
    container.register('createOperation', (c) => new CreateOperation(
            {
                postRequestProcessor: c.postRequestProcessor,
                auditLogger: c.auditLogger,
                postSaveProcessor: c.postSaveProcessor,
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator,
                resourceValidator: c.resourceValidator,
                databaseBulkInserter: c.databaseBulkInserter,
                configManager: c.configManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                bwellPersonFinder: c.bwellPersonFinder
            }
        )
    );
    container.register('updateOperation', (c) => new UpdateOperation(
            {
                postRequestProcessor: c.postRequestProcessor,
                auditLogger: c.auditLogger,
                postSaveProcessor: c.postSaveProcessor,
                databaseQueryFactory: c.databaseQueryFactory,
                fhirLoggingManager: c.fhirLoggingManager,
                scopesValidator: c.scopesValidator,
                resourceValidator: c.resourceValidator,
                bundleManager: c.bundleManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                databaseBulkInserter: c.databaseBulkInserter,
                resourceMerger: c.resourceMerger,
                configManager: c.configManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                bwellPersonFinder: c.bwellPersonFinder,
                searchManager: c.searchManager
            }
        )
    );
    container.register('mergeOperation', (c) => new MergeOperation(
        {
            mergeManager: c.mergeManager,
            postRequestProcessor: c.postRequestProcessor,
            databaseBulkLoader: c.databaseBulkLoader,
            databaseBulkInserter: c.databaseBulkInserter,
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            bundleManager: c.bundleManager,
            configManager: c.configManager,
            bwellPersonFinder: c.bwellPersonFinder,
            mergeValidator: c.mergeValidator
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
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            configManager: c.configManager,
            queryRewriterManager: c.queryRewriterManager,
            postRequestProcessor: c.postRequestProcessor,
            searchManager: c.searchManager
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
            searchManager: c.searchManager,
            databaseAttachmentManager: c.databaseAttachmentManager
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
            resourceManager: c.resourceManager,
            databaseAttachmentManager: c.databaseAttachmentManager
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
            resourceManager: c.resourceManager,
            databaseAttachmentManager: c.databaseAttachmentManager
        }
    ));
    container.register('patchOperation', (c) => new PatchOperation(
        {
            databaseQueryFactory: c.databaseQueryFactory,
            postSaveProcessor: c.postSaveProcessor,
            postRequestProcessor: c.postRequestProcessor,
            fhirLoggingManager: c.fhirLoggingManager,
            scopesValidator: c.scopesValidator,
            databaseBulkInserter: c.databaseBulkInserter,
            databaseAttachmentManager: c.databaseAttachmentManager,
            configManager: c.configManager,
            bwellPersonFinder: c.bwellPersonFinder,
            searchManager: c.searchManager,
            resourceMerger: c.resourceMerger,
            resourceValidator: c.resourceValidator
        }
    ));
    container.register('validateOperation', (c) => new ValidateOperation(
        {
            scopesManager: c.scopesManager,
            fhirLoggingManager: c.fhirLoggingManager,
            resourceValidator: c.resourceValidator,
            configManager: c.configManager,
            databaseQueryFactory: c.databaseQueryFactory,
            searchManager: c.searchManager
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
            enrichmentManager: c.enrichmentManager,
            databaseAttachmentManager: c.databaseAttachmentManager
        }
    ));

    container.register('databaseAttachmentManager', (c) => new DatabaseAttachmentManager(
        {
            mongoDatabaseManager: c.mongoDatabaseManager,
            configManager: c.configManager
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
                expandOperation: c.expandOperation,
                exportOperation: c.exportOperation,
                exportByIdOperation: c.exportByIdOperation,
                r4ArgsParser: c.r4ArgsParser,
                queryRewriterManager: c.queryRewriterManager
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

    container.register('k8sClient', (c) => new K8sClient({
        configManager: c.configManager
    }));

    container.register('accessIndexManager', (c) => new AccessIndexManager({
        configManager: c.configManager,
        indexProvider: c.indexProvider
    }));

    container.register('fhirTypesManager', () => new FhirTypesManager());

    container.register('r4SearchQueryCreator', (c) => new R4SearchQueryCreator(
        {
            configManager: c.configManager,
            accessIndexManager: c.accessIndexManager,
            r4ArgsParser: c.r4ArgsParser
        }));

    container.register('adminPersonPatientLinkManager', (c) => new AdminPersonPatientLinkManager({
        databaseQueryFactory: c.databaseQueryFactory,
        databaseUpdateFactory: c.databaseUpdateFactory,
        fhirOperationsManager: c.fhirOperationsManager,
        postSaveProcessor: c.postSaveProcessor,
        patientFilterManager: c.patientFilterManager
    }));

    container.register('bwellPersonFinder', (c) => new BwellPersonFinder({
        databaseQueryFactory: c.databaseQueryFactory
    }));

    container.register('adminPersonPatientDataManager', (c) => new AdminPersonPatientDataManager(
        {
            fhirOperationsManager: c.fhirOperationsManager,
            everythingOperation: c.everythingOperation,
            databaseQueryFactory: c.databaseQueryFactory,
            databaseUpdateFactory: c.databaseUpdateFactory,
            r4ArgsParser: c.r4ArgsParser,
            postSaveProcessor: c.postSaveProcessor
        }));

    container.register('personMatchManager', (c) => new PersonMatchManager(
        {
            databaseQueryFactory: c.databaseQueryFactory,
            configManager: c.configManager
        }
    ));

    container.register('mongoFilterGenerator', (c) => new MongoFilterGenerator(
        {
            configManager: c.configManager
        }
    ));

    container.register('r4ArgsParser', (c) => new R4ArgsParser({
        fhirTypesManager: c.fhirTypesManager,
        configManager: c.configManager,
        searchParametersManager: c.searchParametersManager
    }));

    container.register('uuidToIdReplacer', (c) => new UuidToIdReplacer({
        databaseQueryFactory: c.databaseQueryFactory
    }));

    container.register('fhirResourceWriterFactory', (c) => new FhirResourceWriterFactory(
        {
            configManager: c.configManager
        }
    ));

    container.register('postSaveProcessor', (c) => new PostSaveProcessor({
        handlers: [
            c.changeEventProducer
        ],
        configManager: c.configManager
    }));

    container.register('patientQueryCreator', (c) => new PatientQueryCreator({
        patientFilterManager: c.patientFilterManager,
        r4SearchQueryCreator: c.r4SearchQueryCreator,
        r4ArgsParser: c.r4ArgsParser
    }));

    container.register('searchParametersManager', () => new SearchParametersManager());

    container.register('databaseExportManager', (c) => new DatabaseExportManager({
        databaseQueryFactory: c.databaseQueryFactory,
        databaseUpdateFactory: c.databaseUpdateFactory
    }));

    container.register('exportOperation', (c) => new ExportOperation({
        scopesManager: c.scopesManager,
        fhirLoggingManager: c.fhirLoggingManager,
        preSaveManager: c.preSaveManager,
        resourceValidator: c.resourceValidator,
        exportManager: c.exportManager,
        postRequestProcessor: c.postRequestProcessor,
        auditLogger: c.auditLogger,
        databaseExportManager: c.databaseExportManager,
        exportEventProducer: c.exportEventProducer
    }));

    container.register('exportManager', (c) => new ExportManager({
        securityTagManager: c.securityTagManager,
        preSaveManager: c.preSaveManager,
        configManager: c.configManager,
        k8sClient: c.k8sClient
    }));

    container.register('exportByIdOperation', (c) => new ExportByIdOperation({
        scopesManager: c.scopesManager,
        fhirLoggingManager: c.fhirLoggingManager,
        databaseExportManager: c.databaseExportManager
    }));

    container.register('adminExportManager', (c) => new AdminExportManager({
        postRequestProcessor: c.postRequestProcessor,
        requestSpecificCache: c.requestSpecificCache,
        fhirOperationsManager: c.fhirOperationsManager,
        databaseExportManager: c.databaseExportManager,
        resourceMerger: c.resourceMerger,
        configManager: c.configManager,
        k8sClient: c.k8sClient,
        exportManager: c.exportManager,
        scopesValidator: c.scopesValidator,
        exportEventProducer: c.exportEventProducer
    }));

    return container;
};
module.exports = {
    createContainer
};
