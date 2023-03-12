const {commonBeforeEach, commonAfterEach} = require('../../common');
const {MongoQuerySimplifier} = require('../../../utils/mongoQuerySimplifier');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {logInfo} = require('../../../operations/common/logging');

describe('mongoQuerySimplifier Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient mongoQuerySimplifier Tests', () => {
        test('mongoQuerySimplifier works for single query 1', () => {
            const query = {
                '$and': [
                    {
                        '$or': [
                            {
                                '$and': [
                                    {
                                        'meta.security.code': 'https://www.icanbwell.com/access%7Cmedstar'
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        '$or': [
                            {
                                '$and': [
                                    {
                                        'birthDate': {
                                            '$lt': '2021-09-22T00:00:00+00:00'
                                        }
                                    },
                                    {
                                        'birthDate': {
                                            '$gte': '2021-09-19T00:00:00+00:00'
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({filter: query});
            logInfo('', {result});
            expect(result).toStrictEqual({
                '$and': [
                    {
                        'meta.security.code': 'https://www.icanbwell.com/access%7Cmedstar'
                    },
                    {
                        'birthDate': {
                            '$lt': '2021-09-22T00:00:00+00:00'
                        }
                    },
                    {
                        'birthDate': {
                            '$gte': '2021-09-19T00:00:00+00:00'
                        }
                    }
                ]
            });
        });
        test('mongoQuerySimplifier works for single query', () => {
            const query = {
                '$and': [
                    {
                        'meta.security.code': 'https://www.icanbwell.com/access%7Cmedstar'
                    },
                    {
                        '$and': [
                            {
                                'birthDate': {
                                    '$lt': '2021-09-22T00:00:00+00:00'
                                }
                            },
                            {
                                'birthDate': {
                                    '$gte': '2021-09-19T00:00:00+00:00'
                                }
                            }
                        ]
                    }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({filter: query});
            logInfo('', {result});
            expect(result).toStrictEqual({
                '$and': [
                    {
                        'meta.security.code': 'https://www.icanbwell.com/access%7Cmedstar'
                    },
                    {
                        'birthDate': {
                            '$lt': '2021-09-22T00:00:00+00:00'
                        }
                    },
                    {
                        'birthDate': {
                            '$gte': '2021-09-19T00:00:00+00:00'
                        }
                    }
                ]
            });
        });
        test('mongoQuerySimplifier converts $or to $in', () => {
            const query = {
                '$or': [
                    {'foo': '1'},
                    {'foo': '2'},
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({filter: query});
            logInfo('', {result});
            expect(result).toStrictEqual({
                'foo': {
                    '$in': ['1', '2']
                }
            });
        });
    });
    describe('Patient mongoQuerySimplifier findColumn Tests', () => {
        test('mongoQuerySimplifier works for findColumn query 1', () => {
            const query = {
                '$and': [
                    {
                        '$or': [
                            {
                                '$and': [
                                    {
                                        'meta.security.code': 'https://www.icanbwell.com/access%7Cmedstar'
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        '$or': [
                            {
                                '$and': [
                                    {
                                        'birthDate': {
                                            '$lt': '2021-09-22T00:00:00+00:00'
                                        }
                                    },
                                    {
                                        'birthDate': {
                                            '$gte': '2021-09-19T00:00:00+00:00'
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const columns = MongoQuerySimplifier.findColumnsInFilter({filter: query});
            logInfo('', {columns});
            expect(columns).toStrictEqual(new Set(['meta.security.code', 'birthDate']));
        });
    });
});
