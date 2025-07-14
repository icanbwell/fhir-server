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

                // Use a promise to properly handle the streaming response
                return new Promise((resolve, reject) => {
                    let lineCount = 0;
                    let headerLine = '';

                    request
                        .get(`/4_0_0/Practitioner/?_streamResponse=1&_count=${numberOfResources}&_format=text/csv`)
                        .buffer(false) // Don't buffer in memory
                        .set(getHeaders())
                        .on('response', (res) => {
                            // Handle response headers
                            console.log('Response headers:', res.headers);
                        })
                        .on('error', (err) => {
                            console.error('Response error:', err);
                            reject(err);
                        })
                        .parse((res, callback) => {
                            res.setEncoding('utf8');
                            let buffer = '';

                            res.on('data', (chunk) => {
                                buffer += chunk;

                                // Process lines as they come
                                const lines = buffer.split('\n');

                                // Keep the last partial line in buffer
                                buffer = lines.pop();

                                // Process complete lines
                                for (const line of lines) {
                                    if (lineCount === 0) {
                                        headerLine = line;
                                    }
                                    lineCount++;
                                }
                            });

                            res.on('end', () => {
                                // Process the last line if buffer has content
                                if (buffer.length > 0) {
                                    lineCount++;
                                }

                                callback(null, { lineCount, headerLine });
                            });
                        })
                        .end((err, res) => {
                            if (err) {
                                reject(err);
                                return;
                            }

                            // Expect that we have the header line plus all resource lines
                            expect(res.body.lineCount).toBe(numberOfResources + 1);
                            expect(res.body.headerLine).toBeTruthy();

                            // Force garbage collection if available
                            if (global.gc) {
                                global.gc();
                            }

                            resolve();
                        });
                });
            },
            30000 // Increase timeout for this large test
        );
    });
});
