// test file
const personResource = require('./fixtures/person.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expectedPerson.json');
const expectedResult = require('./fixtures/expected/expectedResult.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getHeadersWithCustomToken} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Remove person to person link test', () => {
        test('person to person link is removed', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the person resource to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge?validate=true')
                .send(personResource)
                .set(getHeadersWithCustomToken('user/*.read user/*.write admin/*.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Remove person to person link using admin panel
            resp = await request
                .get('/admin/removePersonToPersonLink?bwellPersonId=Person/aba5bcf41cf64435839cf0568c121843&externalPersonId=Person/a58e50292d79469691d3048e787434cc')
                .set(getHeadersWithCustomToken('user/*.read user/*.write admin/*.*'));

            // Expect removed meesage to be returned
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResult);

            resp = await request.get('/4_0_0/Person/_search?id=aba5bcf41cf64435839cf0568c121843').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            // The link is removed from the person resource.
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
    });
});
