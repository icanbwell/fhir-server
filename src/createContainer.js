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
    container.register('valueSetManager', c => new ValueSetManager(c.collectionManager));
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

    return container;
};
module.exports = {
    createContainer
};
