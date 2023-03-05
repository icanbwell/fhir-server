const {commonBeforeEach, commonAfterEach, getTestContainer, createTestRequest} = require('../../common');
const {
    MongoJsonPatchHelper,
} = require('../../../utils/mongoJsonPatchHelper');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const Person = require('../../../fhir/classes/4_0_0/resources/person');
const Reference = require('../../../fhir/classes/4_0_0/complex_types/reference');
const Meta = require('../../../fhir/classes/4_0_0/complex_types/meta');
const Coding = require('../../../fhir/classes/4_0_0/complex_types/coding');
const PersonLink = require('../../../fhir/classes/4_0_0/backbone_elements/personLink');
const {assertTypeEquals} = require('../../../utils/assertType');
const {ResourceMerger} = require('../../../operations/common/resourceMerger');
const {SecurityTagSystem} = require('../../../utils/securityTagSystem');
const {PreSaveManager} = require('../../../preSaveHandlers/preSave');

describe('mongoJsonPatchHelper Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient mongoJsonPatchHelper Tests', () => {
        test('mongoJsonPatchHelper works for single query', async () => {
            await createTestRequest();
            const container = getTestContainer();

            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);

            let doc1 = new Person({
                'resourceType': 'Person',
                'id': '1',
                'meta': new Meta(
                    {
                        'versionId': '1',
                        'security': [
                            new Coding({
                                'system': SecurityTagSystem.owner,
                                'code': 'myAccess'
                            })
                        ]
                    }
                ),
                'link': [
                    new PersonLink({
                        'target': new Reference({
                            'reference': 'Patient/2'
                        })
                    })
                ]
            });
            doc1 = await preSaveManager.preSaveAsync(doc1);
            const doc2 = new Person({
                'resourceType': 'Person',
                'id': '1',
                'meta': new Meta(
                    {
                        'versionId': '1',
                        'security': [
                            new Coding({
                                'system': SecurityTagSystem.owner,
                                'code': 'myAccess'
                            })
                        ]
                    }
                ),
                'link': [
                    new PersonLink({
                        'target': new Reference({
                            'reference': 'Patient/3'
                        })
                    })
                ]
            });

            /**
             * @type {ResourceMerger}
             */
            const resourceMerger = container.resourceMerger;
            assertTypeEquals(resourceMerger, ResourceMerger);

            const {patches} = await resourceMerger.mergeResourceAsync({
                currentResource: doc1,
                resourceToMerge: doc2
            });
            expect(patches).toStrictEqual([
                {
                    'op': 'add',
                    'path': '/link/1',
                    'value': {
                        'target': {
                            'extension': [
                                {
                                    'id': 'sourceId',
                                    'url': 'https://www.icanbwell.com/sourceId',
                                    'valueString': 'Patient/3'
                                },
                                {
                                    'id': 'uuid',
                                    'url': 'https://www.icanbwell.com/uuid',
                                    'valueString': 'Patient/21cd2633-d630-55f4-9cd9-dc1282bd199e'
                                },
                                {
                                    'id': 'sourceAssigningAuthority',
                                    'url': 'https://www.icanbwell.com/sourceAssigningAuthority',
                                    'valueString': 'myAccess'
                                }
                            ],
                            'reference': 'Patient/3'
                        }
                    }
                }
            ]);

            const update = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({
                patches
            });

            expect(update).toStrictEqual({
                '$push': {
                    'link': {
                        '$each': [
                            {
                                'target': {
                                    'extension': [
                                        {
                                            'id': 'sourceId',
                                            'url': 'https://www.icanbwell.com/sourceId',
                                            'valueString': 'Patient/3'
                                        },
                                        {
                                            'id': 'uuid',
                                            'url': 'https://www.icanbwell.com/uuid',
                                            'valueString': 'Patient/21cd2633-d630-55f4-9cd9-dc1282bd199e'
                                        },
                                        {
                                            'id': 'sourceAssigningAuthority',
                                            'url': 'https://www.icanbwell.com/sourceAssigningAuthority',
                                            'valueString': 'myAccess'
                                        }
                                    ],
                                    'reference': 'Patient/3'
                                }
                            }
                        ],
                        '$position': 1
                    }
                }
            });
        });
    });
});
