const { commonBeforeEach, commonAfterEach } = require('../../common');
const { describe, beforeEach, afterEach, expect, test } = require('@jest/globals');
const { KafkaClient } = require('../../../utils/kafkaClient');
const { KafkaJSProtocolError, KafkaJSNonRetriableError } = require('kafkajs');

describe('kafkaClient Tests', () => {
  beforeEach(async () => {
    await commonBeforeEach();
  });

  afterEach(async () => {
    await commonAfterEach();
  });

  describe('mock sendMessagesAsync with retry logic', () => {
    const sendMessagesAsyncHelperSpy = jest.spyOn(KafkaClient.prototype, 'sendMessagesAsyncHelper');
    const initSpy = jest.spyOn(KafkaClient.prototype, 'init');

    afterEach(() => {
      sendMessagesAsyncHelperSpy.mockReset();
      initSpy.mockReset();
    });

    test('should retry 2 times by creating new instance of kafkaClient', async () => {
      sendMessagesAsyncHelperSpy
        .mockRejectedValueOnce(new KafkaJSNonRetriableError('Error', {
          cause: new KafkaJSProtocolError({
            type: 'LISTENER_NOT_FOUND',
            code: 72,
            retriable: true,
            message:
              'There is no listener on the leader broker that matches the listener on which metadata request was processed',
          })
        }))
        .mockRejectedValueOnce(new KafkaJSNonRetriableError('Error', {
          cause: new KafkaJSProtocolError({
            type: 'LISTENER_NOT_FOUND',
            code: 72,
            retriable: true,
            message:
              'There is no listener on the leader broker that matches the listener on which metadata request was processed',
          })
        }))
        .mockResolvedValueOnce();

      try {
        const kafkaClient = new KafkaClient({ clientId: 'clientId', brokers: ['broker1', 'broker12'], ssl: true, sasl: false });
        await kafkaClient.sendMessagesAsync('topic', [{
          key: '1',
          value: 'Test Message'
        }]);
      } catch (error) {
        console.log(error);
      }

      expect(initSpy).toBeCalledTimes(3);
      expect(sendMessagesAsyncHelperSpy).toHaveBeenCalledTimes(3);
    });

    test('should retry max times and in the end throw the actual error ', async () => {
      sendMessagesAsyncHelperSpy
        .mockRejectedValueOnce(new KafkaJSNonRetriableError('Error', {
          cause: new KafkaJSProtocolError({
            type: 'LISTENER_NOT_FOUND',
            code: 72,
            retriable: true,
            message:
              'There is no listener on the leader broker that matches the listener on which metadata request was processed',
          })
        }))
        .mockRejectedValueOnce(new KafkaJSNonRetriableError('Error', {
          cause: new KafkaJSProtocolError({
            type: 'LISTENER_NOT_FOUND',
            code: 72,
            retriable: true,
            message:
              'There is no listener on the leader broker that matches the listener on which metadata request was processed',
          })
        }))
        .mockRejectedValueOnce(new KafkaJSNonRetriableError('Error', {
          cause: new KafkaJSProtocolError({
            type: 'LISTENER_NOT_FOUND',
            code: 72,
            retriable: true,
            message:
              'There is no listener on the leader broker that matches the listener on which metadata request was processed',
          })
        }));

      try {
        const kafkaClient = new KafkaClient({ clientId: 'clientId', brokers: ['broker1', 'broker12'], ssl: true, sasl: false });
        await kafkaClient.sendMessagesAsync('topic', [{
          key: '1',
          value: 'Test Message'
        }]);
      } catch (error) {
        expect(error instanceof KafkaJSNonRetriableError).toBe(true);
        expect(error.cause instanceof KafkaJSProtocolError).toBe(true);
        expect(error.cause.type).toBe(72);
      }

      expect(initSpy).toBeCalledTimes(4);
      expect(sendMessagesAsyncHelperSpy).toHaveBeenCalledTimes(3);
    });
  });
});
