const {commonBeforeEach, commonAfterEach} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {FhirTypesManager} = require('../../../fhir/fhirTypesManager');

describe('FhirTypesManager Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('FhirTypesManager Tests', () => {
        // noinspection JSUnresolvedFunction
        test('FhirTypesManager works', async () => {
            const fhirTypesManager = new FhirTypesManager();

            expect(fhirTypesManager.getTypeForField('Task', 'status')).toStrictEqual('code');
        });
    });
});
