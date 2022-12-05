const bwellPerson_directLink = require('./fixtures/bwellPerson_directLink.json');
const bwellPerson_indirectLink = require('./fixtures/bwellPerson_indirectLink.json');
const linkedPerson1 = require('./fixtures/linkedPerson1.json');
const linkedPerson2 = require('./fixtures/linkedPerson2.json');
const linkedPerson1_cycle = require('./fixtures/linkedPerson1_cycle.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, expect, test, beforeEach, afterEach} = require('@jest/globals');
const {createContainer} = require('../../../createContainer');

describe('bwellPersonFinder Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('search works with no linked Person', async () => {

        const bwellPersonFinder = createContainer().bwellPersonFinder;
        const result = await bwellPersonFinder.getBwellPersonIdAsync({ base_version: '4_0_0', patientId: 'Patient/1234' });

        expect(!result);
    });

    test('search works with no linked bwell Person', async () => {

        const request = await createTestRequest();
        await request
            .post('/4_0_0/Person/otherOne/$merge?validate=true')
            .send(linkedPerson1)
            .set(getHeaders());

        const bwellPersonFinder = createContainer().bwellPersonFinder;
        const result = await bwellPersonFinder.getBwellPersonIdAsync({ base_version: '4_0_0', patientId: 'Patient/1234' });

        expect(!result);
    });

    test('search works with directly linked bwell Person', async () => {

        const request = await createTestRequest();
        await request
            .post('/4_0_0/Person/81236/$merge?validate=true')
            .send(bwellPerson_directLink)
            .set(getHeaders());

        const bwellPersonFinder = createContainer().bwellPersonFinder;
        const result = await bwellPersonFinder.getBwellPersonIdAsync({ base_version: '4_0_0', patientId: 'Patient/1234' });

        expect(result === '81235');
    });

    test('search works with indirectly linked bwell Person', async () => {

        const request = await createTestRequest();
        await request
            .post('/4_0_0/Person/81236/$merge?validate=true')
            .send(bwellPerson_indirectLink)
            .set(getHeaders());

        await request
            .post('/4_0_0/Person/5678/$merge?validate=true')
            .send(linkedPerson2)
            .set(getHeaders());

        await request
            .post('/4_0_0/Person/otherOne/$merge?validate=true')
            .send(linkedPerson1)
            .set(getHeaders());

        const bwellPersonFinder = createContainer().bwellPersonFinder;
        const result = await bwellPersonFinder.getBwellPersonIdAsync({ base_version: '4_0_0', patientId: 'Patient/1234' });

        expect(result === '81235');
    });

    test('search works with cycle and no linked bwell Person', async () => {

        const request = await createTestRequest();
        await request
            .post('/4_0_0/Person/5678/$merge?validate=true')
            .send(linkedPerson2)
            .set(getHeaders());

        await request
            .post('/4_0_0/Person/otherOne/$merge?validate=true')
            .send(linkedPerson1_cycle)
            .set(getHeaders());

        const bwellPersonFinder = createContainer().bwellPersonFinder;
        const result = await bwellPersonFinder.getBwellPersonIdAsync({ base_version: '4_0_0', patientId: 'Patient/1234' });

        expect(!result);
    });

    test('search works with cycle and linked bwell Person', async () => {

        const request = await createTestRequest();
        await request
            .post('/4_0_0/Person/81236/$merge?validate=true')
            .send(bwellPerson_indirectLink)
            .set(getHeaders());

        await request
            .post('/4_0_0/Person/5678/$merge?validate=true')
            .send(linkedPerson2)
            .set(getHeaders());

        await request
            .post('/4_0_0/Person/otherOne/$merge?validate=true')
            .send(linkedPerson1_cycle)
            .set(getHeaders());

        const bwellPersonFinder = createContainer().bwellPersonFinder;
        const result = await bwellPersonFinder.getBwellPersonIdAsync({ base_version: '4_0_0', patientId: 'Patient/1234' });

        expect(result === '81235');
    });
});
