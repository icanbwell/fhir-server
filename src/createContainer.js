const {SimpleContainer} = require('./utils/simpleContainer');
const {KafkaClient} = require('./utils/KafkaClient');
const env = require('var');
const {ChangeEventProducer} = require('./utils/changeEventProducer');
const {ResourceManager} = require('./operations/common/resourceManager');
const {DatabaseBulkInserter} = require('./dataLayer/databaseBulkInserter');
const {DatabaseBulkLoader} = require('./dataLayer/databaseBulkLoader');

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
        c.kafkaClient
    ));
    container.register('resourceManager', c => new ResourceManager(c.changeEventProducer));
    container.register('databaseBulkInserter', c => new DatabaseBulkInserter(c.resourceManager));
    container.register('databaseBulkLoader', () => new DatabaseBulkLoader());
    return container;
};
module.exports = {
    createContainer
};
