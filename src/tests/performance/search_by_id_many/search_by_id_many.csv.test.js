const deepcopy = require('deepcopy');
// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('CSV Performance tests', () => {
    const numberOfResources = 1000;

    beforeEach(async () => {
        await commonBeforeEach();
        const initialId = practitionerResource.id;
        const bundle = {
            resourceType: 'Bundle',
            entry: []
        };
        for (let i = 0; i < numberOfResources; i++) {
            practitionerResource.id = initialId + '-' + i;
            bundle.entry.push({
                resource: deepcopy(practitionerResource)
            });
        }
        const request = await createTestRequest();
        // first confirm there are no practitioners
        let resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
        expect(resp.body.length).toBe(0);

        // now add a record
        resp = await request
            .post('/4_0_0/Practitioner/0/$merge?validate=true')
            .send(bundle)
            .set(getHeaders());

        expect(resp.body.length).toBe(numberOfResources);
        for (const result of resp.body) {
            expect(result.created).toStrictEqual(true);
        }
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner CSV Search By 10,0000 Tests', () => {
        test(
            'search by 2,000 id in csv works',
            async () => {
                const request = await createTestRequest();
                // now check that we get the right record back
                const resp = await request
                    .get('/4_0_0/Practitioner/?_count=10')
                    .set(getHeaders())
                    .expect(200);
                expect(resp.body.length).toBe(10);

                /**
                 * Parser that reads chunks as they are received from server
                 * @param {import('http').IncomingMessage} req
                 * @param callback
                 */
                function chunkParser (req, callback) {
                    req.text = '';
                    let text = '';
                    req.setEncoding('utf8');
                    let chunkNumber = 0;
                    req.on('data', (chunk) => {
                        req.text += chunk;
                        text += chunk;
                        chunkNumber++;
                        console.log(`Received chunk ${chunkNumber} of length ${chunk.length}`);
                    });
                    req.on('end', () => {
                        // Process the response data here
                        callback(null, text);
                    });
                }

                // now check that we get the right record back
                request
                    .get(`/4_0_0/Practitioner/?_streamResponse=1&_count=${numberOfResources}&_format=text/csv`)
                    .buffer(true)
                    .set(getHeaders())
                    // .buffer(false)
                    .on('response', (res) => {
                        // Handle response headers
                        console.log('Response headers:', res.headers);
                    })
                    .on('error', (res) => {
                        console.log('Response error:', res);
                    })
                    .on('end', (resp1) => {
                        // Handle end of response
                        console.log('Response complete');
                        const lines = resp1.req.res.text.split('\n');
                        expect(lines.length).toBe(numberOfResources + 1);
                    })
                    .parse(chunkParser)
                ;
            },
            240 * 1000
        );
    });
});
