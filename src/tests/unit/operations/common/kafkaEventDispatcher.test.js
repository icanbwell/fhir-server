const { describe, test, expect, jest } = require('@jest/globals');
const { KafkaEventDispatcher } = require('../../../../operations/common/kafkaEventDispatcher');

const makeMessage = (body) => ({
    key: 'test-key',
    value: JSON.stringify(body),
    headers: []
});

describe('KafkaEventDispatcher', () => {
    test('routes a message to the handler registered for its event type', async () => {
        const importHandler = { handleMessageAsync: jest.fn() };
        const dispatcher = new KafkaEventDispatcher({
            handlersByEventType: { ImportRangeRequested: importHandler }
        });

        const message = makeMessage({ type: 'ImportRangeRequested', data: {} });
        await dispatcher.handleMessageAsync(message);

        expect(importHandler.handleMessageAsync).toHaveBeenCalledTimes(1);
        expect(importHandler.handleMessageAsync).toHaveBeenCalledWith(message);
    });

    test('does not call any handler when the event type has no registration', async () => {
        const importHandler = { handleMessageAsync: jest.fn() };
        const dispatcher = new KafkaEventDispatcher({
            handlersByEventType: { ImportRangeRequested: importHandler }
        });

        await dispatcher.handleMessageAsync(makeMessage({ type: 'SomeOtherEvent', data: {} }));

        expect(importHandler.handleMessageAsync).not.toHaveBeenCalled();
    });

    test('does not throw when the message value is not valid JSON', async () => {
        const importHandler = { handleMessageAsync: jest.fn() };
        const dispatcher = new KafkaEventDispatcher({
            handlersByEventType: { ImportRangeRequested: importHandler }
        });

        await expect(
            dispatcher.handleMessageAsync({ key: 'bad', value: 'not-json', headers: [] })
        ).resolves.toBeUndefined();
        expect(importHandler.handleMessageAsync).not.toHaveBeenCalled();
    });

    test('dispatches multiple event types to their own handlers', async () => {
        const importHandler = { handleMessageAsync: jest.fn() };
        const otherHandler = { handleMessageAsync: jest.fn() };
        const dispatcher = new KafkaEventDispatcher({
            handlersByEventType: {
                ImportRangeRequested: importHandler,
                SomeOtherEvent: otherHandler
            }
        });

        await dispatcher.handleMessageAsync(makeMessage({ type: 'ImportRangeRequested', data: {} }));
        await dispatcher.handleMessageAsync(makeMessage({ type: 'SomeOtherEvent', data: {} }));

        expect(importHandler.handleMessageAsync).toHaveBeenCalledTimes(1);
        expect(otherHandler.handleMessageAsync).toHaveBeenCalledTimes(1);
    });
});
