const {SimpleContainer} = require('./utils/simpleContainer');
const {KafkaClient} = require('./utils/KafkaClient');
const env = require('var');
const {ChangeEventProducer} = require('./utils/changeEventProducer');
const {ResourceManager} = require('./operations/common/resourceManager');
const {DatabaseBulkInserter} = require('./dataLayer/databaseBulkInserter');
const {DatabaseBulkLoader} = require('./dataLayer/databaseBulkLoader');
const {PostRequestProcessor} = require('./utils/postRequestProcessor');

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
    container.register('resourceManager', () => new ResourceManager());
    container.register('databaseBulkInserter', c => new DatabaseBulkInserter(c.resourceManager, c.postRequestProcessor));
    container.register('databaseBulkLoader', () => new DatabaseBulkLoader());
    container.register('postRequestProcessor', () => new PostRequestProcessor());
    return container;
};
module.exports = {
    createContainer
};
