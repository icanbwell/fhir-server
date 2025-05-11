// test file
const parentPersonResource = require('./fixtures/Person/parentPerson.json');
const parentPerson1Resource = require('./fixtures/Person/parentPerson1.json');
const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const patient3Resource = require('./fixtures/Patient/patient3.json');

const accountResource = require('./fixtures/Account/account.json');
const unlinkedAccountResource = require('./fixtures/Account/unlinked_account.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

const subscription1Resource = require('./fixtures/Subscription/subscription1.json');
const subscription2Resource = require('./fixtures/Subscription/subscription2.json');

const subscriptionStatus1Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus1.json');
const subscriptionStatus2Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus2.json');

const subscriptionTopic1Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic1.json');
const subscriptionTopic2Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic2.json');


// expected
const expectedPersonTopLevelResources = require('./fixtures/expected/expected_Person_personTopLevel.json');
const expectedPersonTopLevelContainedResources = require('./fixtures/expected/expected_Person_personTopLevel_contained.json');
const expectedPerson1Resources = require('./fixtures/expected/expected_Person_person1.json');
const expectedPersonResourcesType = require('./fixtures/expected/expected_Person_type.json');
const expectedPerson1ContainedResources = require('./fixtures/expected/expected_Person_person1_contained.json');

const expectedPatientResources = require('./fixtures/expected/expected_Patient.json');
const expectedPatientResourcesType = require('./fixtures/expected/expected_Patient_type.json');
const expectedPatientContainedResources = require('./fixtures/expected/expected_Patient_contained.json');
var JSZip = require("jszip");
var XLSX = require("xlsx");

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersExcel,
    getHeadersZip
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect, jest} = require('@jest/globals');
const fs = require("node:fs");
const {fhirContentTypes} = require("../../../utils/contentTypes");

describe('Person and Patient $summary Tests with Excel content', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person and Patient $summary Tests', () => {
        test('Patient $summary works with Accepts header', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(accountResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(unlinkedAccountResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
                .send(subscription1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
                .send(subscription2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
                .send(subscriptionStatus1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
                .send(subscriptionStatus2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
                .send(subscriptionTopic1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
                .send(subscriptionTopic2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // First get patient everything
            resp = await request
                .get('/4_0_0/Patient/patient1/$summary?_debug=true')
                .set(getHeadersExcel())
                .responseType('blob'); // Important for binary data

            // Basic response checks
            expect(resp.status).toBe(200);

            // Content-Type checks
            expect(resp.headers['content-type']).toBe(fhirContentTypes.excel);
            expect(resp.headers['content-disposition']).toMatch(/attachment; filename=.+\.xlsx/);

            // Generate unique filename
            // get folder containing this test
            const tempFolder = __dirname + '/temp';
            // if subfolder temp from current folder exists then delete it
            if (fs.existsSync(tempFolder)) {
                fs.rmSync(tempFolder, {recursive: true, force: true});
            }
            // if subfolder temp from current folder does not exist then create it
            if (!fs.existsSync(tempFolder)) {
                fs.mkdirSync(tempFolder);
            }
            const filename = `export_${new Date().toISOString().replace(/:/g, '-')}.xlsx`;
            const filepath = tempFolder + '/' + filename;

            // Write file
            fs.writeFileSync(filepath, resp.body);

            // Optional: Verify file was written
            expect(fs.existsSync(filepath)).toBe(true);

            // Optional: Check file size
            const stats = fs.statSync(filepath);
            expect(stats.size).toBeGreaterThan(0);

            const workbook = XLSX.read(resp.body);

            // Detailed file inspection
            /**
             * @type {str}
             */
            for (const sheetName of workbook.SheetNames) {
                const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {header: 1});

                expect(sheetData.length).toBeGreaterThan(0);
            }

            // Check for specific resource type CSVs
            const expectedResourceTypes = ['Patient', 'Observation']; // Adjust as needed
            expectedResourceTypes.forEach(resourceType => {
                /**
                 * @type {string[]}
                 */
                const sheetNames = workbook.SheetNames;
                const matchingFile = sheetNames.find(filename =>
                    filename.toLowerCase().includes(resourceType.toLowerCase())
                );
                expect(matchingFile).toBeTruthy();
            });
        });
        test('Patient $summary works with _format', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(accountResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(unlinkedAccountResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
                .send(subscription1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
                .send(subscription2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
                .send(subscriptionStatus1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
                .send(subscriptionStatus2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
                .send(subscriptionTopic1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
                .send(subscriptionTopic2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // First get patient everything
            resp = await request
                .get('/4_0_0/Patient/patient1/$summary?_format=application/vnd.ms-excel')
                .set(getHeaders())
                .responseType('blob'); // Important for binary data

            // Basic response checks
            expect(resp.status).toBe(200);

            // Content-Type checks
            expect(resp.headers['content-type']).toBe(fhirContentTypes.excel);
            expect(resp.headers['content-disposition']).toMatch(/attachment; filename=.+\.xlsx/);

            // Generate unique filename
            // get folder containing this test
            const tempFolder = __dirname + '/temp';
            // if subfolder temp from current folder exists then delete it
            if (fs.existsSync(tempFolder)) {
                fs.rmSync(tempFolder, {recursive: true, force: true});
            }
            // if subfolder temp from current folder does not exist then create it
            if (!fs.existsSync(tempFolder)) {
                fs.mkdirSync(tempFolder);
            }
            const filenameMatch = resp.headers['content-disposition'].split('filename=')[1];
            const filename = filenameMatch.split(';')[0].trim().replace(/"/g, '');
            const filepath = tempFolder + '/' + filename;

            // Write file
            fs.writeFileSync(filepath, resp.body);

            // Optional: Verify file was written
            expect(fs.existsSync(filepath)).toBe(true);

            // Optional: Check file size
            const stats = fs.statSync(filepath);
            expect(stats.size).toBeGreaterThan(0);

            const workbook = XLSX.read(resp.body);

            // Detailed file inspection
            /**
             * @type {str}
             */
            for (const sheetName of workbook.SheetNames) {
                const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {header: 1});

                expect(sheetData.length).toBeGreaterThan(0);
            }

            // Check for specific resource type CSVs
            const expectedResourceTypes = ['Patient', 'Observation']; // Adjust as needed
            expectedResourceTypes.forEach(resourceType => {
                /**
                 * @type {string[]}
                 */
                const sheetNames = workbook.SheetNames;
                const matchingFile = sheetNames.find(filename =>
                    filename.toLowerCase().includes(resourceType.toLowerCase())
                );
                expect(matchingFile).toBeTruthy();
            });
        });
        test('Person $summary works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(accountResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(unlinkedAccountResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
                .send(subscription1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
                .send(subscription2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
                .send(subscriptionStatus1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
                .send(subscriptionStatus2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
                .send(subscriptionTopic1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
                .send(subscriptionTopic2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // First get patient everything
            resp = await request
                .get('/4_0_0/Person/person1/$summary')
                .set(getHeadersExcel())
                .responseType('blob'); // Important for binary data

            // Basic response checks
            expect(resp.status).toBe(200);

            // Content-Type checks
            expect(resp.headers['content-type']).toBe(fhirContentTypes.excel);
            expect(resp.headers['content-disposition']).toMatch(/attachment; filename=.+\.xlsx/);

            const filenameMatch = resp.headers['content-disposition'].split('filename=')[1];
            const filename = filenameMatch.split(';')[0].trim().replace(/"/g, '');

            // Generate unique filename
            // get folder containing this test
            const tempFolder = __dirname + '/temp';
            // if subfolder temp from current folder exists then delete it
            if (fs.existsSync(tempFolder)) {
                fs.rmSync(tempFolder, {recursive: true, force: true});
            }
            // if subfolder temp from current folder does not exist then create it
            if (!fs.existsSync(tempFolder)) {
                fs.mkdirSync(tempFolder);
            }
            const filepath = tempFolder + '/' + filename;

            // Write file
            fs.writeFileSync(filepath, resp.body);

            // Optional: Verify file was written
            expect(fs.existsSync(filepath)).toBe(true);

            // Optional: Check file size
            const stats = fs.statSync(filepath);
            expect(stats.size).toBeGreaterThan(0);

            const workbook = XLSX.read(resp.body);

            // Detailed file inspection
            /**
             * @type {str}
             */
            for (const sheetName of workbook.SheetNames) {
                const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {header: 1});

                expect(sheetData.length).toBeGreaterThan(0);
            }

            // Check for specific resource type CSVs
            const expectedResourceTypes = ['Patient', 'Observation']; // Adjust as needed
            expectedResourceTypes.forEach(resourceType => {
                /**
                 * @type {string[]}
                 */
                const sheetNames = workbook.SheetNames;
                const matchingFile = sheetNames.find(filename =>
                    filename.toLowerCase().includes(resourceType.toLowerCase())
                );
                expect(matchingFile).toBeTruthy();
            });
        });
    });
});
