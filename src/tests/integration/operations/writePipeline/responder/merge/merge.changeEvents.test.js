const topLevelPersonResource = require('./fixtures/changeEvents/topLevelPerson.json');
const person1Resource = require('./fixtures/changeEvents/person1.json');
const person2Resource = require('./fixtures/changeEvents/person2.json');
const patient1Resource = require('./fixtures/changeEvents/patient1.json');
const accountResource = require('./fixtures/changeEvents/account.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { MockKafkaClient } = require('../../../../mocks/mockKafkaClient');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];

/**
 * The environment variables this test sets, restored after each case.
 */
const ENV_NAMES = Object.freeze([
    'WRITE_PIPELINE_OPERATIONS',
    'ENABLE_EVENTS_KAFKA',
    'ENABLE_PATIENT_DATA_CHANGE_EVENTS',
    'ENABLE_PERSON_DATA_CHANGE_EVENTS'
]);

/**
 * The patient and person change events the merge sends, sorted by id.
 */
const EXPECTED_CHANGE_EVENTS = Object.freeze([
    {
        changedResourceTypes: ['Person'],
        id: '0eb80391-0f61-5ce6-b221-a5428f2f38a7',
        resourceType: 'Person'
    },
    {
        changedResourceTypes: ['Account', 'Patient'],
        id: '24a5930e-11b4-5525-b482-669174917044',
        resourceType: 'Patient'
    },
    {
        changedResourceTypes: ['Account', 'Patient', 'Person'],
        id: '7b99904f-2f85-51a3-9398-e2eed6854639',
        resourceType: 'Person'
    },
    {
        changedResourceTypes: ['Person'],
        id: '9168d18f-8ad4-5f07-8ace-dd2979455b4e',
        resourceType: 'Person'
    }
]);

/**
 * Sends `$merge` to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'merge' : '';
};

/**
 * Replaces the test container's Kafka client with the mock that records the sent change events.
 */
const registerMockKafkaClient = (container) => {
    container.register('kafkaClient', (c) => new MockKafkaClient({ configManager: c.configManager }));
    return container;
};

/**
 * Returns the data of each change event the mock received, with its changed resource types sorted,
 * sorted by id, so the comparison doesn't depend on the order the events were sent in.
 */
const changeEventsOf = (mockKafkaClient) => mockKafkaClient.cloudEventMessages
    .map((message) => {
        const data = JSON.parse(message.value);
        return { ...data, changedResourceTypes: [...data.changedResourceTypes].sort() };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

describe('$merge patient and person change events on the old and the new write path', () => {
    const originalEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));

    beforeEach(async () => {
        await commonBeforeEach();
        process.env.ENABLE_EVENTS_KAFKA = 'true';
        process.env.ENABLE_PATIENT_DATA_CHANGE_EVENTS = 'true';
        process.env.ENABLE_PERSON_DATA_CHANGE_EVENTS = 'true';
    });

    afterEach(async () => {
        for (const name of ENV_NAMES) {
            if (originalEnv[name] === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = originalEnv[name];
            }
        }
        await commonAfterEach();
    });

    test.each(PATHS)('sends the same change events on the %s path', async (path) => {
        const request = await createTestRequest(registerMockKafkaClient);
        const { postRequestProcessor, postSaveProcessor, kafkaClient } = getTestContainer();
        kafkaClient.cloudEventMessages = [];
        useWritePath(path);

        await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send([topLevelPersonResource, person1Resource, person2Resource, patient1Resource, accountResource])
            .set(getHeaders())
            .expect(200);
        await postRequestProcessor.waitTillAllRequestsDoneAsync({});
        await postSaveProcessor.flushAsync();

        expect(changeEventsOf(kafkaClient)).toStrictEqual(EXPECTED_CHANGE_EVENTS);
    });
});
