const {commonBeforeEach, commonAfterEach, getTestContainer, createTestRequest} = require('../../common');
const {
    MongoJsonPatchHelper,
} = require('../../../utils/mongoJsonPatchHelper');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
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
        test('mongoJsonPatchHelper works for adding a new link', async () => {
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

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            const resourceType = 'Person';
            const base_version = '4_0_0';
            /**
             * @type {import('mongodb').Collection<import('mongodb').Document>}
             */
            const collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne(doc1.toJSONInternal());

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

            /**
             * @type {{}}
             */
            const updateOperation = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({
                patches
            });

            expect(updateOperation).toStrictEqual({
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

            const operations = [
                {
                    updateOne: {
                        filter: {
                            id: '1',
                        },
                        update: updateOperation
                    }
                }
            ];
            const result = await collection.bulkWrite(operations);
            expect(result.modifiedCount).toStrictEqual(1);

            const docFromDatabase = await collection.findOne({}, {projection: {_id: 0}});
            expect(docFromDatabase).toStrictEqual({
                '_sourceAssigningAuthority': 'myAccess',
                '_sourceId': '1',
                '_uuid': '87ec3599-51e3-510c-9bf4-537608fbaf7e',
                'id': '1',
                'identifier': [
                    {
                        'id': 'sourceId',
                        'system': 'https://www.icanbwell.com/sourceId',
                        'value': '1'
                    },
                    {
                        'id': 'uuid',
                        'system': 'https://www.icanbwell.com/uuid',
                        'value': '87ec3599-51e3-510c-9bf4-537608fbaf7e'
                    }
                ],
                'link': [
                    {
                        'target': {
                            '_sourceAssigningAuthority': 'myAccess',
                            '_sourceId': 'Patient/2',
                            '_uuid': 'Patient/413ed4ad-0c9c-584f-a9b5-a3cb42aa036e',
                            'extension': [
                                {
                                    'id': 'sourceId',
                                    'url': 'https://www.icanbwell.com/sourceId',
                                    'valueString': 'Patient/2'
                                },
                                {
                                    'id': 'uuid',
                                    'url': 'https://www.icanbwell.com/uuid',
                                    'valueString': 'Patient/413ed4ad-0c9c-584f-a9b5-a3cb42aa036e'
                                },
                                {
                                    'id': 'sourceAssigningAuthority',
                                    'url': 'https://www.icanbwell.com/sourceAssigningAuthority',
                                    'valueString': 'myAccess'
                                }
                            ],
                            'reference': 'Patient/2'
                        }
                    },
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
                'meta': {
                    'security': [
                        {
                            'code': 'myAccess',
                            'system': 'https://www.icanbwell.com/owner'
                        },
                        {
                            'code': 'myAccess',
                            'system': 'https://www.icanbwell.com/sourceAssigningAuthority'
                        }
                    ],
                    'versionId': '1'
                },
                'resourceType': 'Person'
            });
        });
        test('mongoJsonPatchHelper works for adding a updating a link', async () => {
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
                        'id': '1',
                        'target': new Reference({
                            'id': '1',
                            'reference': 'Patient/2'
                        })
                    })
                ]
            });
            doc1 = await preSaveManager.preSaveAsync(doc1);

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            const resourceType = 'Person';
            const base_version = '4_0_0';
            /**
             * @type {import('mongodb').Collection<import('mongodb').Document>}
             */
            const collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne(doc1.toJSONInternal());

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
                        'id': '1',
                        'target': new Reference({
                            'id': '1',
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
                    'op': 'replace',
                    'path': '/link/0/target/reference',
                    'value': 'Patient/3'
                },
                {
                    'op': 'replace',
                    'path': '/link/0/target/extension/1/valueString',
                    'value': 'Patient/21cd2633-d630-55f4-9cd9-dc1282bd199e'
                },
                {
                    'op': 'replace',
                    'path': '/link/0/target/extension/0/valueString',
                    'value': 'Patient/3'
                }
            ]);

            /**
             * @type {{}}
             */
            const updateOperation = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({
                patches
            });

            expect(updateOperation).toStrictEqual({
                '$set': {
                    'link.0.target.extension.0.valueString': 'Patient/3',
                    'link.0.target.extension.1.valueString': 'Patient/21cd2633-d630-55f4-9cd9-dc1282bd199e',
                    'link.0.target.reference': 'Patient/3'
                }
            });

            const operations = [
                {
                    updateOne: {
                        filter: {
                            id: '1',
                        },
                        update: updateOperation
                    }
                }
            ];
            const result = await collection.bulkWrite(operations);
            expect(result.modifiedCount).toStrictEqual(1);

            const docFromDatabase = await collection.findOne({}, {projection: {_id: 0}});
            expect(docFromDatabase).toStrictEqual({
                '_sourceAssigningAuthority': 'myAccess',
                '_sourceId': '1',
                '_uuid': '87ec3599-51e3-510c-9bf4-537608fbaf7e',
                'id': '1',
                'identifier': [
                    {
                        'id': 'sourceId',
                        'system': 'https://www.icanbwell.com/sourceId',
                        'value': '1'
                    },
                    {
                        'id': 'uuid',
                        'system': 'https://www.icanbwell.com/uuid',
                        'value': '87ec3599-51e3-510c-9bf4-537608fbaf7e'
                    }
                ],
                'link': [
                    {
                        'id': '1',
                        'target': {
                            '_sourceAssigningAuthority': 'myAccess',
                            '_sourceId': 'Patient/2',
                            '_uuid': 'Patient/413ed4ad-0c9c-584f-a9b5-a3cb42aa036e',
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
                            'id': '1',
                            'reference': 'Patient/3'
                        }
                    }
                ],
                'meta': {
                    'security': [
                        {
                            'code': 'myAccess',
                            'system': 'https://www.icanbwell.com/owner'
                        },
                        {
                            'code': 'myAccess',
                            'system': 'https://www.icanbwell.com/sourceAssigningAuthority'
                        }
                    ],
                    'versionId': '1'
                },
                'resourceType': 'Person'
            });
        });
    });
});
