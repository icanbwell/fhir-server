// test file
// const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
// const expectedPatientResources = require('./fixtures/expected/expected_patient.json');
const expectedEmptyParameters = require('./fixtures/expected/expected_empty_parameters.json');

const {commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
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
            expect(parsedArgs.parsedArgItems[1].queryParameterValue.value).toStrictEqual('1');
            expect(parsedArgs.parsedArgItems[1].modifiers).toStrictEqual(['above']);
            expect(parsedArgs.parsedArgItems[1].propertyObj).toBeDefined();
        });
        test('r4ArgsParser works for missing', async () => {
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
                resourceType: 'Organization', args: {
                    'base_version': VERSIONS['4_0_0'],
                    'category:missing': 'true'
                }
            });
            expect(parsedArgs.parsedArgItems.length).toStrictEqual(2);
            expect(parsedArgs.parsedArgItems[1].queryParameter).toStrictEqual('category');
            expect(parsedArgs.parsedArgItems[1].queryParameterValue.value).toStrictEqual('true');
            expect(parsedArgs.parsedArgItems[1].modifiers).toStrictEqual(['missing']);
        });
        test('r4ArgsParser works for gt', async () => {
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
                resourceType: 'Patient',
                args: {
                    'base_version': VERSIONS['4_0_0'],
                    'id': 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3',
                    'id:above': 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3'
                }
            });
            expect(parsedArgs.parsedArgItems.length).toStrictEqual(3);
            expect(parsedArgs.parsedArgItems[1].queryParameter).toStrictEqual('_id');
            expect(parsedArgs.parsedArgItems[1].queryParameterValue.value).toStrictEqual('john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3');
            expect(parsedArgs.parsedArgItems[1].modifiers).toStrictEqual([]);
            expect(parsedArgs.parsedArgItems[2].queryParameter).toStrictEqual('_id');
            expect(parsedArgs.parsedArgItems[2].queryParameterValue.value).toStrictEqual('john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3');
            expect(parsedArgs.parsedArgItems[2].modifiers).toStrictEqual(['above']);
        });
        test('r4ArgsParser works for multiple parameters as array', async () => {
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
                resourceType: 'Patient',
                args: {
                    'base_version': VERSIONS['4_0_0'],
                    'code': ['health-activity', 'foo']
                }
            });
            expect(parsedArgs.parsedArgItems.length).toStrictEqual(2);
            expect(parsedArgs.parsedArgItems[1].queryParameter).toStrictEqual('code');
            expect(parsedArgs.parsedArgItems[1].queryParameterValue.operator).toStrictEqual('$and');
            expect(parsedArgs.parsedArgItems[1].queryParameterValue.values).toStrictEqual(['health-activity', 'foo']);
            expect(parsedArgs.parsedArgItems[1].modifiers).toStrictEqual([]);
        });
        test('r4ArgsParser works for multiple parameters as comma separated list', async () => {
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
                resourceType: 'Patient',
                args: {
                    'base_version': VERSIONS['4_0_0'],
                    'code': 'health-activity,foo'
                }
            });
            expect(parsedArgs.parsedArgItems.length).toStrictEqual(2);
            expect(parsedArgs.parsedArgItems[1].queryParameter).toStrictEqual('code');
            expect(parsedArgs.parsedArgItems[1].queryParameterValue.operator).toStrictEqual('$or');
            expect(parsedArgs.parsedArgItems[1].queryParameterValue.values).toStrictEqual(['health-activity', 'foo']);
            expect(parsedArgs.parsedArgItems[1].modifiers).toStrictEqual([]);
        });
        test('r4ArgsParser works for empty parameters', async () => {
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
                resourceType: 'Patient',
                args: {
                    'base_version': VERSIONS['4_0_0'],
                    'address:contains': '',
                    'address-city:contains': '',
                    'address-country:contains': '',
                    'address-postalcode:contains': '',
                    'address-state:contains': '',
                    'name:contains': '',
                    'phonetic:contains': '',
                    '_lastUpdated': ['', ''],
                    'given': 'DONOTUSE',
                    'family': 'HIEMASTERONE',
                    'email': '',
                    '_security': '',
                    'id': '',
                    'identifier': ['', ''],
                    '_source:contains': '',
                    '_getpagesoffset': '',
                    '_sort': '',
                    '_count': '100'

                }
            });
            expect(parsedArgs.toJSON()).toStrictEqual(expectedEmptyParameters);
        });
    });
});
