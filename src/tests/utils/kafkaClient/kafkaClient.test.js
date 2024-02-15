const { commonBeforeEach, commonAfterEach } = require('../../common');
const { describe, beforeEach, afterEach, jest, test, expect } = require('@jest/globals');
const { KafkaClient } = require('../../../utils/kafkaClient');
const { KafkaJSProtocolError, KafkaJSNonRetriableError } = require('kafkajs');
const { ConfigManager } = require('../../../utils/configManager');

class MockKafkaClient extends KafkaClient {
    /**
     * returns config for kafka
     * @return {{sasl: {accessKeyId: (string|null), secretAccessKey: (string|null), authorizationIdentity: (string|undefined), password: (string|null), mechanism: (string|undefined), username: (string|null)}, clientId: (string|undefined), brokers: string[], ssl: boolean}}
     */
    getConfigAsync () {
        return { clientId: 'clientId', brokers: ['broker1', 'broker12'], ssl: true, sasl: false };
    }
}

describe('kafkaClient Tests', () => {
  beforeEach(async () => {
    await commonBeforeEach();
  });

  afterEach(async () => {
    await commonAfterEach();
  });

  describe('mock sendMessagesAsync with retry logic', () => {
    const sendMessagesAsyncHelperSpy = jest.spyOn(MockKafkaClient.prototype, 'sendMessagesAsyncHelper');
    const initSpy = jest.spyOn(MockKafkaClient.prototype, 'init');

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
              'There is no listener on the leader broker that matches the listener on which metadata request was processed'
          })
        }))
        .mockRejectedValueOnce(new KafkaJSNonRetriableError('Error', {
          cause: new KafkaJSProtocolError({
            type: 'LISTENER_NOT_FOUND',
            code: 72,
            retriable: true,
            message:
              'There is no listener on the leader broker that matches the listener on which metadata request was processed'
          })
        }))
        .mockResolvedValueOnce();

      try {
        const kafkaClient = new MockKafkaClient({ configManager: new ConfigManager() });
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
              'There is no listener on the leader broker that matches the listener on which metadata request was processed'
          })
        }))
        .mockRejectedValueOnce(new KafkaJSNonRetriableError('Error', {
          cause: new KafkaJSProtocolError({
            type: 'LISTENER_NOT_FOUND',
            code: 72,
            retriable: true,
            message:
              'There is no listener on the leader broker that matches the listener on which metadata request was processed'
          })
        }))
        .mockRejectedValueOnce(new KafkaJSNonRetriableError('Error', {
          cause: new KafkaJSProtocolError({
            type: 'LISTENER_NOT_FOUND',
            code: 72,
            retriable: true,
            message:
              'There is no listener on the leader broker that matches the listener on which metadata request was processed'
          })
        }));

      try {
        const kafkaClient = new MockKafkaClient({ configManager: new ConfigManager() });
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
