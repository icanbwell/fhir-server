const {commonBeforeEach, commonAfterEach} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {buildR4SearchQuery} = require('../../../../operations/query/r4');

describe('AuditEvent Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent r4 Tests', () => {
        test('r4 works without accessIndex', async () => {
            const args = {
                '_security': 'https://www.icanbwell.com/access%7Cmedstar',
                'date': ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = buildR4SearchQuery({
                resourceType: 'AuditEvent', args, useAccessIndex: false
            });
            expect(result.query.$and['0'].recorded.$lt).toStrictEqual(new Date('2021-09-22T00:00:00.000Z'));
            expect(result.query.$and['2']['meta.security.code']).toBe('https://www.icanbwell.com/access%7Cmedstar');
        });
        test('r4 works with accessIndex', async () => {
            const args = {
                '_security': 'https://www.icanbwell.com/access%7Cmedstar',
                'date': ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = buildR4SearchQuery({
                resourceType: 'AuditEvent', args, useAccessIndex: true
            });
            expect(result.query.$and['0'].recorded.$lt).toStrictEqual(new Date('2021-09-22T00:00:00.000Z'));
            expect(result.query.$and['2']['_access.medstar']).toBe(1);
        });
        test('r4 works with Task and subject', async () => {
            const args = {
                'subject': 'Patient/1234'
            };
            const result = buildR4SearchQuery({
                resourceType: 'Task', args, useAccessIndex: false
            });
            expect(result.query.$and['0']['for.reference']).toStrictEqual('Patient/1234');
        });
    });
});
