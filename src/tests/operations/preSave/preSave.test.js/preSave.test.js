const {commonBeforeEach, commonAfterEach} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {PreSaveManager} = require('../../../../preSaveHandlers/preSave');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient preSave.test.js Tests', () => {
        test('preSave.test.js works', async () => {
            /**
             * @type {Resource}
             */
            const resource = {
                'id': '123',
                'meta': {
                    'security': [
                        {
                            'system': 'https://www.icanbwell.com/access',
                            'code': 'myAccess'
                        },
                        {
                            'system': 'https://www.icanbwell.com/sourceAssigningAuthority',
                            'code': 'myAssigningAuthority'
                        },
                    ]
                }
            };
            const result = await new PreSaveManager().preSaveAsync(resource);
            expect(result._uuid).toBeDefined();
            const uuidRegex = new RegExp('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
            expect(result._uuid).toMatch(uuidRegex);
            expect(result._sourceId).toStrictEqual('123');
            expect(result._access).toBeDefined();
            expect(result._access.myAccess).toStrictEqual(1);
            expect(result._sourceAssigningAuthority).toBeDefined();
            expect(result._sourceAssigningAuthority.myAssigningAuthority).toStrictEqual(1);
        });
    });
});
