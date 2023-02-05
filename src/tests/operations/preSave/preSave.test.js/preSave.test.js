const {commonBeforeEach, commonAfterEach} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {PreSaveManager} = require('../../../../preSaveHandlers/preSave');
const {DateColumnHandler} = require('../../../../preSaveHandlers/handlers/dateColumnHandler');
const {SourceIdColumnHandler} = require('../../../../preSaveHandlers/handlers/sourceIdColumnHandler');
const {UuidColumnHandler} = require('../../../../preSaveHandlers/handlers/uuidColumnHandler');
const {AccessColumnHandler} = require('../../../../preSaveHandlers/handlers/accessColumnHandler');
const {SourceAssigningAuthorityColumnHandler} = require('../../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const {SecurityTagSystem} = require('../../../../utils/securityTagSystem');
const Resource = require('../../../../fhir/classes/4_0_0/resources/resource');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient preSave.test.js Tests', () => {
        test('preSave.test.js works', async () => {
            // noinspection JSValidateTypes
            /**
             * @type {Resource}
             */
            const resource = new Resource({
                'id': '123',
                'meta': {
                    'security': [
                        {
                            'system': SecurityTagSystem.access,
                            'code': 'myAccess'
                        },
                        {
                            'system': SecurityTagSystem.sourceAssigningAuthority,
                            'code': 'myAssigningAuthority'
                        },
                    ]
                }
            });
            const result = await new PreSaveManager({
                preSaveHandlers: [
                    new DateColumnHandler(),
                    new SourceIdColumnHandler(),
                    new UuidColumnHandler(),
                    new AccessColumnHandler(),
                    new SourceAssigningAuthorityColumnHandler()
                ]
            }).preSaveAsync(resource);
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
