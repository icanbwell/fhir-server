const { logError } = require('./logging');

/**
 * Routes a raw Kafka message to whichever registered handler owns its CloudEvent
 * "type", so a single consumer entrypoint can grow new event types by registering
 * another handler instead of standing up a whole new topic+entrypoint+runner.
 * Each handler is expected to do its own envelope parsing/validation for the event
 * types it owns; this class only inspects the envelope's "type" field to route.
 */
class KafkaEventDispatcher {
    /**
     * @typedef {Object} ConstructorParams
     * @property {Object<string, {handleMessageAsync: function({key: string, value: string, headers: Array}): Promise<void>}>} handlersByEventType
     *
     * @param {ConstructorParams}
     */
    constructor({ handlersByEventType }) {
        this.handlersByEventType = handlersByEventType;
    }

    /**
     * @param {{ key: string, value: string, headers: Array<{key: string, value: string}> }} message
     * @returns {Promise<void>}
     */
    async handleMessageAsync(message) {
        let eventType;
        try {
            eventType = JSON.parse(message.value).type;
        } catch (e) {
            logError('Failed to parse Kafka message envelope', { error: e.message, key: message.key });
            return;
        }

        const handler = this.handlersByEventType[eventType];
        if (!handler) {
            logError('No handler registered for Kafka event type', { eventType, key: message.key });
            return;
        }

        await handler.handleMessageAsync(message);
    }
}

module.exports = { KafkaEventDispatcher };
