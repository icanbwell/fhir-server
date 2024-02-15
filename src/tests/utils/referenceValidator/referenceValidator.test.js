const {commonBeforeEach, commonAfterEach} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

const personInvalid = require('./fixtures/personInvalid.json');
const personValid = require('./fixtures/personValid.json');
const {validateReferences} = require('../../../utils/referenceValidator');
const Person = require('../../../fhir/classes/4_0_0/resources/person');

describe('Reference Validator Util Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('referenceValidator Tests', () => {
        test('Validation fails for invalid reference', async () => {
            const personResourceObj = new Person(personInvalid);
            const errors = validateReferences(personResourceObj, '');
            expect(errors).toStrictEqual([
                'link.0.target.reference: Person/Person/a58e50292d79469691d3048e787434cc is an invalid reference',
                'link.1.target.reference: Patient/Patient/26a2b5508f6840a1b4c5f67d38360060 is an invalid reference',
            ]);
        });
        test('Validation works for empty resource', async () => {
            const errors = validateReferences({}, '');
            expect(errors).toStrictEqual([]);
        });
        test('Validation works for valid references', async () => {
            const personResourceObj = new Person(personValid);
            const errors = validateReferences(personResourceObj, '');
            expect(errors).toStrictEqual([]);
        });
    });
});
