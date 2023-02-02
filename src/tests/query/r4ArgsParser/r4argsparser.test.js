// test file
// const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
// const expectedPatientResources = require('./fixtures/expected/expected_patient.json');

const {commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {assertTypeEquals} = require('../../../utils/assertType');
const {R4ArgsParser} = require('../../../operations/query/r4ArgsParser');
const {VERSIONS} = require('../../../middleware/fhir/utils/constants');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient r4ArgsParser Tests', () => {
        test('r4ArgsParser works', async () => {
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type  {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            assertTypeEquals(r4ArgsParser, R4ArgsParser);

            const parsedArgs = r4ArgsParser.parseArgs({
                resourceType: 'Patient', args: {
                    'base_version': VERSIONS['4_0_0'],
                    'id:above': '1'
                }
            });
            expect(parsedArgs.parsedArgItems.length).toStrictEqual(2);
            expect(parsedArgs.parsedArgItems[1].queryParameter).toStrictEqual('_id');
            expect(parsedArgs.parsedArgItems[1].queryParameterValue).toStrictEqual('1');
            expect(parsedArgs.parsedArgItems[1].modifiers).toStrictEqual(['above']);
            expect(parsedArgs.parsedArgItems[1].propertyObj).toBeDefined();
        });
    });
});
