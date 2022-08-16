const {SimpleContainer} = require('./utils/simpleContainer');
const {KafkaClient} = require('./utils/KafkaClient');
const createContainer = function () {
    const container = new SimpleContainer();
    container.register('KafkaClient', () => new KafkaClient());
    return container;
};
module.exports = {
    createContainer
};
