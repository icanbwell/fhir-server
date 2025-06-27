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


  describe('mock sendCloudEventMessageAsync with retry logic', () => {
    const sendCloudEventMessagesAsyncHelperSpy = jest.spyOn(MockKafkaClient.prototype, 'sendCloudEventMessageHelperAsync');
    const initSpy = jest.spyOn(MockKafkaClient.prototype, 'init');

    afterEach(() => {
      sendCloudEventMessagesAsyncHelperSpy.mockReset();
      initSpy.mockReset();
    });

    test('should retry 2 times by creating new instance of kafkaClient', async () => {
      sendCloudEventMessagesAsyncHelperSpy
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
        const topic = 'fhir.users.events';
        const messages = [
            {
                key: 'key',
                value: Buffer.from(
                    JSON.stringify({
                        managingOrganization: '6e1c3dd8-a6a5-4d76-b5ed-6ffbac444ea4',
                        bwellFhirPersonId: '9a92aa37-f2e9-4f9e-a66b-ea3133a74d16',
                        clientFhirPersonId: '9a92aa37-f2e9-4f9e-a66b-ea3133a74d16'
                    })
                ),
                headers: {
                    ce_integrations: '["analytics"]',
                    ce_type: 'EverythingAccessed',
                    ce_source: 'https://www.icanbwell.com/fhir-server',
                    ce_datacontenttype: 'application/json;charset=utf-8',
                    ce_time: '2025-06-27T07:25:59.377Z',
                    ce_specversion: '1.0',
                    'content-type': 'application/json;charset=utf-8',
                    ce_id: 'c4b754cf-bdc0-4485-a0d4-35d80fbea68b'
                }
            }
        ];
        await kafkaClient.sendCloudEventMessageAsync({
            topic,
            messages
        });
      } catch (error) {
        console.log(error);
      }

      expect(initSpy).toBeCalledTimes(3);
      expect(sendCloudEventMessagesAsyncHelperSpy).toHaveBeenCalledTimes(3);
    });

    test('should retry max times and in the end throw the actual error ', async () => {
      sendCloudEventMessagesAsyncHelperSpy
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
        const topic = 'fhir.users.events';
        const messages = [
            {
                key: 'key',
                value: Buffer.from(
                    JSON.stringify({
                        managingOrganization: '6e1c3dd8-a6a5-4d76-b5ed-6ffbac444ea4',
                        bwellFhirPersonId: '9a92aa37-f2e9-4f9e-a66b-ea3133a74d16',
                        clientFhirPersonId: '9a92aa37-f2e9-4f9e-a66b-ea3133a74d16'
                    })
                ),
                headers: {
                    ce_integrations: '["analytics"]',
                    ce_type: 'EverythingAccessed',
                    ce_source: 'https://www.icanbwell.com/fhir-server',
                    ce_datacontenttype: 'application/json;charset=utf-8',
                    ce_time: '2025-06-27T07:25:59.377Z',
                    ce_specversion: '1.0',
                    'content-type': 'application/json;charset=utf-8',
                    ce_id: 'c4b754cf-bdc0-4485-a0d4-35d80fbea68b'
                }
            }
        ];
        await kafkaClient.sendCloudEventMessageAsync({
            topic,
            messages
        });
      } catch (error) {
        expect(error instanceof KafkaJSNonRetriableError).toBe(true);
        expect(error.cause instanceof KafkaJSProtocolError).toBe(true);
        expect(error.cause.type).toBe(72);
      }

      expect(initSpy).toBeCalledTimes(4);
      expect(sendCloudEventMessagesAsyncHelperSpy).toHaveBeenCalledTimes(3);
    });

    test.only('shoul produce cloud event specified message', async () => {
      // sendCloudEventMessagesAsyncHelperSpy.mockResolvedValueOnce();
      const kafkaProduceSpy = jest.fn();

      const kafkaClient = new MockKafkaClient({ configManager: new ConfigManager() });
      kafkaClient.producerConnected = true; // Mock the producer connection
      kafkaClient.producer = { send: kafkaProduceSpy }; // Mock the producer's send
      const topic = 'fhir.operation.usage.events';
      const messages = [
          {
              key: 'key',
              value: Buffer.from(
                  JSON.stringify({
                      managingOrganization: '6e1c3dd8-a6a5-4d76-b5ed-6ffbac444ea4',
                      bwellFhirPersonId: '9a92aa37-f2e9-4f9e-a66b-ea3133a74d16',
                      clientFhirPersonId: '9a92aa37-f2e9-4f9e-a66b-ea3133a74d16'
                  })
              ),
              headers: {
                  ce_integrations: '["analytics"]',
                  ce_type: 'EverythingAccessed',
                  ce_source: 'https://www.icanbwell.com/fhir-server',
                  ce_datacontenttype: 'application/json;charset=utf-8',
                  ce_time: '2025-06-27T07:25:59.377Z',
                  ce_specversion: '1.0',
                  'content-type': 'application/json;charset=utf-8',
                  ce_id: 'c4b754cf-bdc0-4485-a0d4-35d80fbea68b'
              }
          }
      ];
      await kafkaClient.sendCloudEventMessageAsync({
          topic,
          messages
      });

      expect(initSpy).toBeCalledTimes(1);
      expect(kafkaProduceSpy).toHaveBeenCalledTimes(1);
      expect(kafkaProduceSpy).toHaveBeenCalledWith({ topic, messages })
    });
  });
});
