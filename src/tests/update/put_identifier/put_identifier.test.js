// test file
const person1Resource = require('./fixture/person1.json');
const person2Resource = require('./fixture/person2.json');
const updatedPerson1Resource = require('./fixture/updated_person1.json');

// expected
const expectedPerson1Resources = require('./fixture/expected/expected_person1.json');
const expectedPerson2Resources = require('./fixture/expected/expected_person2.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { IdentifierSystem } = require('../../../utils/identifierSystem');

describe('Put identifier Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Update identifier updates all the identifier values except the sourceId and uuid', async () => {
        const request = await createTestRequest();
        // Create the resource
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person1Resource)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction

        expect(resp).toHaveMergeResponse({ created: true });

        // Now update the resource
        resp =  await request
            .put('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
            .send(updatedPerson1Resource)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction

        // Now read the resource and verify
        resp = await request
            .get('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPerson1Resources);
    });

    test('Update identifier with only sourceId as identifier', async () => {
        const request = await createTestRequest();
        // Create the resource
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person2Resource)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction

        expect(resp).toHaveMergeResponse({ created: true });

        // Now update the resource with only sourceId as identifier
        const updatedPersonNoIdentifierResource = { ...updatedPerson1Resource };
        updatedPersonNoIdentifierResource.identifier = updatedPersonNoIdentifierResource.identifier.filter(i => i.system === IdentifierSystem.sourceId);

        resp =  await request
            .put('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
            .send(updatedPersonNoIdentifierResource)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction

        // Now read the resource and verify
        resp = await request
            .get('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPerson2Resources);
    });

    test('Update identifier with no identifiers', async () => {
        const request = await createTestRequest();
        // Create the resource
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person2Resource)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction

        expect(resp).toHaveMergeResponse({ created: true });

        // Now update the resource with no identifiers
        const updatedPersonNoIdentifierResource = { ...updatedPerson1Resource };
        delete updatedPersonNoIdentifierResource.identifier;

        resp =  await request
            .put('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
            .send(updatedPersonNoIdentifierResource)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction

        // Now read the resource and verify
        resp = await request
            .get('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPerson2Resources);
    });

    test('Update identifier with only uuid as identifier', async () => {
        const request = await createTestRequest();
        // Create the resource
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person2Resource)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction

        expect(resp).toHaveMergeResponse({ created: true });

        // Now update the resource with only uuid as identifier
        const updatedPersonNoIdentifierResource = { ...updatedPerson1Resource };
        updatedPersonNoIdentifierResource.identifier = updatedPersonNoIdentifierResource.identifier.filter(i => i.system === IdentifierSystem.uuid);

        resp =  await request
            .put('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
            .send(updatedPersonNoIdentifierResource)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction

        // Now read the resource and verify
        resp = await request
            .get('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPerson2Resources);
    });
});
