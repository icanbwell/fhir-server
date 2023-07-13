const deepcopy = require('deepcopy');
// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersNdJson,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const env = require('var');
let oldEnvLogLevel;

describe('CSV Performance tests', () => {
    const numberOfResources = 10;

    beforeEach(async () => {
        await commonBeforeEach();
        oldEnvLogLevel = env.LOGLEVEL;
        env.LOGLEVEL = 'INFO'; // turn off detailed trace since that is slow
        env.LOG_STREAM_STEPS = true;
        const initialId = practitionerResource.id;
        const bundle = {
            resourceType: 'Bundle',
            entry: [],
        };
        for (let i = 0; i < numberOfResources; i++) {
            practitionerResource.id = initialId + '-' + i;
            bundle.entry.push({
                resource: deepcopy(practitionerResource),
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
        env.LOGLEVEL = oldEnvLogLevel;
    });

    afterEach(async () => {
        await commonAfterEach();
        env.LOGLEVEL = oldEnvLogLevel;
    });

    describe('Practitioner CSV Search By 10,0000 Tests', () => {
        test(
            'search by 2,000 id in csv works',
            async () => {
                const request = await createTestRequest();
                // now check that we get the right record back
                let resp = await request
                    .get('/4_0_0/Practitioner/?_count=10')
                    .set(getHeaders())
                    .expect(200);
                expect(resp.body.length).toBe(10);

                function binaryParser(res, callback) {
                    res.text = '';
                    res.setEncoding('utf8');
                    let chunkNumber = 0;
                    res.on('data', (chunk) => {
                        res.text += chunk;
                        chunkNumber++;
                        console.log(`Received chunk ${chunkNumber} of length ${chunk.length}`);
                    });
                    res.on('end', callback);
                }

                // now check that we get the right record back
                resp = await request
                    .get(`/4_0_0/Practitioner/?_streamResponse=1&_count=${numberOfResources}&_format=text/csv`)
                    .set(getHeadersNdJson())
                    // .responseType('text')
                    // .buffer(false)
                    .on('response', (res) => {
                        // Handle response headers
                        console.log('Response headers:', res.headers);
                    })
                    .parse(binaryParser)
                // .on('data', (chunk) => {
                //     // Handle data chunks as they come
                //     // console.log('Received chunk:', chunk.toString());
                //     console.log('Received chunk');
                // })
                // .on('progress', (chunk) => {
                //     // Handle data chunks as they come
                //     // console.log('Received chunk:', chunk.toString());
                //     console.log('Received chunk prgress');
                // })
                // .on('end', () => {
                //     // Handle end of response
                //     console.log('Response complete');
                // })
                ;
                const lines = resp.text.split('\n');
                expect(lines.length).toBe(numberOfResources + 1);
            },
            240 * 1000
        );
    });
});
