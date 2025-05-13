// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerResource2 = require('./fixtures/practitioner/practitioner2.json');
const practitionerResource3 = require('./fixtures/practitioner/practitioner3.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const fs = require('fs');
const {fhirContentTypes} = require('../../../utils/contentTypes');
const {ConfigManager} = require('../../../utils/configManager');
const XLSX = require("xlsx");

class MockConfigManagerDefaultSortId extends ConfigManager {
    get streamResponse() {
        return true;
    }
}

describe('search by multiple ids Excel', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Search By Multiple Ids Excel Tests', () => {
        test('search by multiple id works with _format Excel from browser', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerDefaultSortId());
                return c;
            });
            /**
             * @type {Response}
             */
            let resp = await request
                .get(`/4_0_0/Practitioner?_format=${fhirContentTypes.excel}`)
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
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerResource3)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get(`/4_0_0/Practitioner?_format=${fhirContentTypes.excel2}`)
                .set(getHeaders())
                .responseType('blob'); // Important for binary data;
            expect(resp.headers['content-type']).toBe(fhirContentTypes.excel2);
            expect(resp.headers['content-disposition']).toBeDefined();

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
            // Write the response body to a file
            fs.writeFileSync(filepath, resp.body);

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
            const expectedResourceTypes = ['Practitioner']; // Adjust as needed
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
