const {commonBeforeEach, commonAfterEach} = require('../../common');
const {mongoQueryStringify} = require('../../../utils/mongoQueryStringify');

describe('mongoQueryStringify Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient mongoQueryStringify Tests', () => {
        test('mongoQueryStringify works for single query', async () => {
            const query = {
                '$and': [
                    {
                        'meta.lastUpdated': {
                            '$gt': new Date('2021-06-01T00:00:00.000Z')
                        }
                    },
                    {
                        'meta.lastUpdated': {
                            '$lt': new Date('2021-06-02T00:00:00.000Z')
                        }
                    },
                    {
                        'meta.security': {
                            '$elemMatch': {
                                'system': 'https://www.icanbwell.com/access',
                                'code': 'fake'
                            }
                        }
                    }
                ]
            };

            const result = mongoQueryStringify(query);
            console.log(result);
            expect(result).toStrictEqual('{"$and":[{"meta.lastUpdated":{"$gt":"2021-06-01T00:00:00.000Z"}},{"meta.lastUpdated":{"$lt":"2021-06-02T00:00:00.000Z"}},{"meta.security":{"$elemMatch":{"system":"https://www.icanbwell.com/access","code":"fake"}}}]}');
        });
        test('mongoQueryStringify works for multiple queries', async () => {
            const query = [
                {
                    '$and': [
                        {
                            'meta.lastUpdated': {
                                '$gt': new Date('2021-06-01T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.lastUpdated': {
                                '$lt': new Date('2021-06-02T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.security': {
                                '$elemMatch': {
                                    'system': 'https://www.icanbwell.com/access',
                                    'code': 'fake'
                                }
                            }
                        }
                    ]
                },
                {
                    '$and': [
                        {
                            'meta.lastUpdated': {
                                '$gt': new Date('2021-06-01T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.lastUpdated': {
                                '$lt': new Date('2021-06-02T00:00:00.000Z')
                            }
                        },
                        {
                            'meta.security': {
                                '$elemMatch': {
                                    'system': 'https://www.icanbwell.com/access',
                                    'code': 'fake'
                                }
                            }
                        }
                    ]
                }
            ];

            const result = mongoQueryStringify(query);
            console.log(result);
            expect(result).toStrictEqual('[{"$and":[{"meta.lastUpdated":{"$gt":"2021-06-01T00:00:00.000Z"}},{"meta.lastUpdated":{"$lt":"2021-06-02T00:00:00.000Z"}},{"meta.security":{"$elemMatch":{"system":"https://www.icanbwell.com/access","code":"fake"}}}]},{"$and":[{"meta.lastUpdated":{"$gt":"2021-06-01T00:00:00.000Z"}},{"meta.lastUpdated":{"$lt":"2021-06-02T00:00:00.000Z"}},{"meta.security":{"$elemMatch":{"system":"https://www.icanbwell.com/access","code":"fake"}}}]}]');
        });
    });
});
