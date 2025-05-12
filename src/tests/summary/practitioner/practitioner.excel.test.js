// test file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerRoleResource = require('./fixtures/practitioner/practitionerRole.json');
const practitionerRoleDifferentSecurityTagResource = require('./fixtures/practitioner/practitionerRoleDifferentSecurityTag.json');
const organizationResource = require('./fixtures/practitioner/organization.json');
const XLSX = require("xlsx");

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersExcel
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const fs = require("node:fs");
const {fhirContentTypes} = require("../../../utils/contentTypes");

describe('Practitioner $summary Tests with Excel content', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner $summary Tests', () => {
        test('Practitioner $summary works with Accepts header', async () => {
            const request = await createTestRequest();
            // ARRANGE
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(practitionerRoleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(practitionerRoleDifferentSecurityTagResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Organization/123456/$merge')
                .send(organizationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // First get patient everything
            resp = await request
                .get('/4_0_0/Practitioner/1679033641/$summary?_debug=true')
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
            const expectedResourceTypes = ['Practitioner', 'PractitionerRole']; // Adjust as needed
            expectedResourceTypes.forEach(resourceType => {
                /**
                 * @type {string[]}
                 */
                const sheetNames = workbook.SheetNames;
                console.info(`Found sheet names: ${sheetNames}`);
                const matchingFile = sheetNames.find(filename =>
                    filename.toLowerCase().includes(resourceType.toLowerCase())
                );
                expect(matchingFile).toBeTruthy();
            });
        });
        test('Practitioner $summary works with _format', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // ARRANGE
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(practitionerRoleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(practitionerRoleDifferentSecurityTagResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Organization/123456/$merge')
                .send(organizationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // First get patient everything
            resp = await request
                .get('/4_0_0/Practitioner/1679033641/$summary?_debug=true')
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
            const expectedResourceTypes = ['Practitioner', 'PractitionerRole']; // Adjust as needed
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
