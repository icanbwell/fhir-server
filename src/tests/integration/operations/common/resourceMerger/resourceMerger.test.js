const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, getTestRequestInfo } = require('../../../common');

const { TestMongoDatabaseManager } = require('../../../testMongoDatabaseManager');
const { ConfigManager } = require('../../../../../utils/configManager');
const { PreSaveManager } = require('../../../../../preSaveHandlers/preSave');

const person1Resource = require('./fixtures/Person/person1.json');
const personMergeResource = require('./fixtures/Person/person2.json');
// const expectedPersonResource = require('./fixtures/expected/expected_person.json');

const { ResourceMerger } = require('../../../../../operations/common/resourceMerger');
const deepcopy = require('deepcopy');
const deepmerge = require('deepmerge');
const { mergeObject } = require('../../../../../utils/mergeHelper');
const { UuidColumnHandler } = require('../../../../../preSaveHandlers/handlers/uuidColumnHandler');
const { PatientFilterManager } = require('../../../../../fhir/patientFilterManager');
const { GroupMemberMerger } = require('../../../../../operations/common/groupMemberMerger');
const { generateUUIDv5 } = require('../../../../../utils/uid.util');

describe('ResourceMerger Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ResourceMerger Tests', () => {
        const base_version = '4_0_0';
        test('ResourceMerger returns null with identical resources', async () => {
            const configManager = new ConfigManager();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager({ configManager });
            await mongoDatabaseManager.dropDatabasesAsync();
            const resourceMerger = new ResourceMerger({
                preSaveManager: new PreSaveManager({
                    preSaveHandlers: [
                        new UuidColumnHandler({
                            configManager
                        })
                    ]
                }),
                patientFilterManager: new PatientFilterManager(),
                groupMemberMerger: new GroupMemberMerger({ configManager: new ConfigManager() })
            });
            const currentResource = deepcopy(person1Resource);
            const resourceToMerge = deepcopy(personMergeResource);

            // first try merge of the raw json
            let mergedObject = deepmerge(person1Resource, personMergeResource);
            expect(mergedObject.gender).toStrictEqual('male');

            // then try merge of the resources
            mergedObject = deepmerge(currentResource, resourceToMerge);
            expect(mergedObject.gender).toStrictEqual('male');

            // now try merge with our options
            mergedObject = mergeObject(currentResource, resourceToMerge);
            expect(mergedObject.gender).toStrictEqual('male');

            const requestInfo = getTestRequestInfo({ requestId: '1234' });

            /**
             * @type {{updatedResource: (Resource|null), patches: (MergePatchEntry[]|null)}}
             */
            const result = await resourceMerger.fastMergeResourceAsync({
                base_version,
                requestInfo,
                currentResource,
                resourceToMerge
            });
            expect(result.updatedResource).toStrictEqual(null);
        });
    });

    describe('Group $merge keeps one entry per member', () => {
        const base_version = '4_0_0';
        const SAA = 'test-owner';
        const PERIOD = { start: '2026-01-01' };

        function member(reference, extra = {}) {
            return { entity: { reference }, ...extra };
        }

        function group(members, extra = {}) {
            const groupResource = {
                resourceType: 'Group',
                id: 'group-1',
                _uuid: generateUUIDv5(`group-1|${SAA}`),
                _sourceId: 'group-1',
                _sourceAssigningAuthority: SAA,
                meta: {
                    versionId: '1',
                    lastUpdated: '2026-01-01T00:00:00.000Z',
                    source: 'https://www.icanbwell.com/test',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: SAA },
                        { system: 'https://www.icanbwell.com/access', code: SAA },
                        { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: SAA }
                    ]
                },
                type: 'person',
                actual: true,
                ...extra
            };
            if (members) {
                groupResource.member = members;
            }
            return groupResource;
        }

        test.each([
            ['a re-sent member with fewer fields', [member('Patient/a', { period: PERIOD })], [member('Patient/a')], null],
            ['a re-sent member with a new period', [member('Patient/a')], [member('Patient/a', { period: PERIOD })], [member('Patient/a', { period: PERIOD })]],
            [
                'the id|sourceAssigningAuthority form of a stored member',
                [member('Patient/a')],
                [member(`Patient/a|${SAA}`, { period: PERIOD })],
                [member(`Patient/a|${SAA}`, { period: PERIOD })]
            ],
            [
                'the same new member twice in the body',
                [member('Patient/b')],
                [member('Patient/a'), member('Patient/a', { period: PERIOD })],
                [member('Patient/b'), member('Patient/a', { period: PERIOD })]
            ],
            [
                'stored duplicates and a body without member',
                [member('Patient/a'), member('Patient/a', { period: PERIOD })],
                undefined,
                [member('Patient/a', { period: PERIOD })]
            ]
        ])('%s', async (_label, storedMembers, incomingMembers, expectedMembers) => {
            const resourceMerger = new ResourceMerger({
                preSaveManager: new PreSaveManager({ preSaveHandlers: [] }),
                groupMemberMerger: new GroupMemberMerger({ configManager: new ConfigManager() })
            });

            const { updatedResource } = await resourceMerger.fastMergeResourceAsync({
                base_version,
                requestInfo: getTestRequestInfo({ requestId: '1234' }),
                currentResource: group(storedMembers),
                resourceToMerge: group(incomingMembers, { meta: undefined })
            });

            expect(updatedResource ? updatedResource.member : null).toEqual(expectedMembers);
        });
    });
});
