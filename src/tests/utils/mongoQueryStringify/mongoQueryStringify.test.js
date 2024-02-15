const {commonBeforeEach, commonAfterEach} = require('../../common');
const {
    mongoQueryStringify,
    mongoQueryAndOptionsStringify
} = require('../../../utils/mongoQueryStringify');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const {SecurityTagSystem} = require('../../../utils/securityTagSystem');
const {logInfo} = require('../../../operations/common/logging');
const {QueryItem} = require('../../../operations/graph/queryItem');

describe('mongoQueryStringify Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient mongoQueryStringify Tests', () => {
        test('mongoQueryStringify works for single query', () => {
            const query = {
                $and: [
                    {
                        'meta.lastUpdated': {
                            $gt: new Date('2021-06-01T00:00:00.000Z')
                        }
                    },
                    {
                        'meta.lastUpdated': {
                            $lt: new Date('2021-06-02T00:00:00.000Z')
                        }
                    },
                    {
                        'meta.security': {
                            $elemMatch: {
                                system: SecurityTagSystem.access,
                                code: 'fake'
                            }
                        }
                    }
                ]
            };

            const result = mongoQueryStringify(query);
            logInfo('', {result});
            expect(result).toStrictEqual(
                '{\'$and\':[{\'meta.lastUpdated\':{\'$gt\':ISODate(\'2021-06-01T00:00:00.000Z\')}},{\'meta.lastUpdated\':{\'$lt\':ISODate(\'2021-06-02T00:00:00.000Z\')}},{\'meta.security\':{\'$elemMatch\':{\'system\':\'https://www.icanbwell.com/access\',\'code\':\'fake\'}}}]}'
            );
        });
        test('mongoQueryStringify works for multiple queries', () => {
            const query = [
                {
                    $and: [
                        {
                            'meta.lastUpdated': {
                                $gt: new Date('2021-06-01T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.lastUpdated': {
                                $lt: new Date('2021-06-02T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.security': {
                                $elemMatch: {
                                    system: SecurityTagSystem.access,
                                    code: 'fake'
                                }
                            }
                        }
                    ]
                },
                {
                    $and: [
                        {
                            'meta.lastUpdated': {
                                $gt: new Date('2021-06-01T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.lastUpdated': {
                                $lt: new Date('2021-06-02T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.security': {
                                $elemMatch: {
                                    system: SecurityTagSystem.access,
                                    code: 'fake'
                                }
                            }
                        }
                    ]
                }
            ];

            const result = mongoQueryStringify(query);
            logInfo('', {result});
            expect(result).toStrictEqual(
                '[{\'$and\':[{\'meta.lastUpdated\':{\'$gt\':ISODate(\'2021-06-01T00:00:00.000Z\')}},{\'meta.lastUpdated\':{\'$lt\':ISODate(\'2021-06-02T00:00:00.000Z\')}},{\'meta.security\':{\'$elemMatch\':{\'system\':\'https://www.icanbwell.com/access\',\'code\':\'fake\'}}}]},{\'$and\':[{\'meta.lastUpdated\':{\'$gt\':ISODate(\'2021-06-01T00:00:00.000Z\')}},{\'meta.lastUpdated\':{\'$lt\':ISODate(\'2021-06-02T00:00:00.000Z\')}},{\'meta.security\':{\'$elemMatch\':{\'system\':\'https://www.icanbwell.com/access\',\'code\':\'fake\'}}}]}]'
            );
        });
    });
    describe('Patient mongoQueryAndOptionsStringify Tests', () => {
        test('mongoQueryAndOptionsStringify works for single query', () => {
            const query = {
                $and: [
                    {
                        'meta.lastUpdated': {
                            $gt: new Date('2021-06-01T00:00:00.000Z')
                        }
                    },
                    {
                        'meta.lastUpdated': {
                            $lt: new Date('2021-06-02T00:00:00.000Z')
                        }
                    },
                    {
                        'meta.security': {
                            $elemMatch: {
                                system: SecurityTagSystem.access,
                                code: 'fake'
                            }
                        }
                    }
                ]
            };

            const options = {
                projection: {id: 1, 'meta.lastUpdated': 1},
                sort: {id: 1},
                skip: 10,
                limit: 20
            };
            const result = mongoQueryAndOptionsStringify(
                {
                    query: new QueryItem({
                        query,
                        collectionName: 'AuditEvent_4_0_0',
                        resourceType: 'AuditEvent'
                    }),
                    options
                });
            logInfo('', {result});
            expect(result).toStrictEqual(
                'db.AuditEvent_4_0_0.find({\'$and\':[{\'meta.lastUpdated\':{\'$gt\':ISODate(\'2021-06-01T00:00:00.000Z\')}},{\'meta.lastUpdated\':{\'$lt\':ISODate(\'2021-06-02T00:00:00.000Z\')}},{\'meta.security\':{\'$elemMatch\':{\'system\':\'https://www.icanbwell.com/access\',\'code\':\'fake\'}}}]}, {\'id\':1,\'meta.lastUpdated\':1}).sort({\'id\':1}).skip(10).limit(20)'
            );
        });
        test('mongoQueryAndOptionsStringify works for multiple queries', () => {
            const queries = [
                {
                    $and: [
                        {
                            'meta.lastUpdated': {
                                $gt: new Date('2021-06-01T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.lastUpdated': {
                                $lt: new Date('2021-06-02T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.security': {
                                $elemMatch: {
                                    system: SecurityTagSystem.access,
                                    code: 'fake'
                                }
                            }
                        }
                    ]
                },
                {
                    $and: [
                        {
                            'meta.lastUpdated': {
                                $gt: new Date('2021-06-01T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.lastUpdated': {
                                $lt: new Date('2021-06-02T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.security': {
                                $elemMatch: {
                                    system: SecurityTagSystem.access,
                                    code: 'fake'
                                }
                            }
                        }
                    ]
                }
            ];

            const options = [
                {
                    projection: {id: 1, 'meta.lastUpdated': 1},
                    sort: {id: 1},
                    skip: 10,
                    limit: 20
                },
                {}
            ];
            const result = mongoQueryAndOptionsStringify(
                {
                    query: queries.map(
                        q => new QueryItem({
                            query: q,
                            collectionName: 'AuditEvent_4_0_0',
                            resourceType: 'AuditEvent'
                        })
                    ),
                    options
                });
            logInfo('', {result});
            expect(result).toStrictEqual(
                'db.AuditEvent_4_0_0.find({\'$and\':[{\'meta.lastUpdated\':{\'$gt\':ISODate(\'2021-06-01T00:00:00.000Z\')}},{\'meta.lastUpdated\':{\'$lt\':ISODate(\'2021-06-02T00:00:00.000Z\')}},{\'meta.security\':{\'$elemMatch\':{\'system\':\'https://www.icanbwell.com/access\',\'code\':\'fake\'}}}]}, {\'id\':1,\'meta.lastUpdated\':1}).sort({\'id\':1}).skip(10).limit(20)  | db.AuditEvent_4_0_0.find({\'$and\':[{\'meta.lastUpdated\':{\'$gt\':ISODate(\'2021-06-01T00:00:00.000Z\')}},{\'meta.lastUpdated\':{\'$lt\':ISODate(\'2021-06-02T00:00:00.000Z\')}},{\'meta.security\':{\'$elemMatch\':{\'system\':\'https://www.icanbwell.com/access\',\'code\':\'fake\'}}}]}, {})'
            );
        });
    });
});
