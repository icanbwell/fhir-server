// test file
const condition1Resource = require('./fixtures/Condition/condition1.json');

// expected
// eslint-disable-next-line no-unused-vars
const expectedConditionResources = require('./fixtures/expected/expected_condition.json');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach } = require('../../../common');
const { createTestContainer } = require('../../../createTestContainer');
const Condition = require('../../../../fhir/classes/4_0_0/resources/condition');

describe('SecurityTagManager Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Condition securityTagManager Tests', () => {
        test('securityTagManager works', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {SecurityTagManager} */
            const securityTagManager = container.securityTagManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(condition);
            const patientUuid = securityTagManager.getValueOfPatientPropertyFromResource({ resource: condition });
            expect(patientUuid).toStrictEqual('24a5930e-11b4-5525-b482-669174917044');
        });
    });
});
