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
        test('mongoQuerySimplifier does not convert $or to $in if fields are different', () => {
            const query = {
                '$or': [
                    {'foo': '1'},
                    {'bar': '2'},
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({filter: query});
            logInfo('', {result});
            expect(result).toStrictEqual({
                '$or': [
                    {'foo': '1'},
                    {'bar': '2'},
                ]
            });
        });
        test('mongoQuerySimplifier does not convert $or to $in if fields are not primitive', () => {
            const query = {
                '$and': [
                    {
                        '$or': [
                            {
                                '$and': [
                                    {
                                        'subject._sourceAssigningAuthority': 'C'
                                    },
                                    {
                                        'subject._sourceId': 'Patient/patient1'
                                    }
                                ]
                            },
                            {
                                '$and': [
                                    {
                                        'subject._sourceAssigningAuthority': 'C'
                                    },
                                    {
                                        'subject._sourceId': 'Group/patient1'
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
                '$or': [
                    {
                        '$and': [
                            {
                                'subject._sourceAssigningAuthority': 'C'
                            },
                            {
                                'subject._sourceId': 'Patient/patient1'
                            }
                        ]
                    },
                    {
                        '$and': [
                            {
                                'subject._sourceAssigningAuthority': 'C'
                            },
                            {
                                'subject._sourceId': 'Group/patient1'
                            }
                        ]
                    }
                ]
            });
        });
        test('mongoQuerySimplifier handles empty clauses', () => {
            const query = {
                '$and': [
                    {
                        '$or': [
                            {
                                '$or': []
                            }
                        ]
                    },
                    {
                        '$or': []
                    }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({filter: query});
            logInfo('', {result});
            expect(result).toStrictEqual({});
        });
        test('mongoQuerySimplifier handles date clauses', () => {
            const query = {
                '$and': [
                    {
                        '$or': [
                            {
                                '$and': [
                                    {
                                        'meta.security.code': 'https://www.icanbwell.com/access%7Cfoobar'
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
                                        'recorded': {
                                            '$lt': new Date('2021-09-22T00:00:00.000Z')
                                        }
                                    },
                                    {
                                        'recorded': {
                                            '$gte': new Date('2021-09-19T00:00:00.000Z')
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
                        'meta.security.code': 'https://www.icanbwell.com/access%7Cfoobar'
                    },
                    {
                        'recorded': {
                            '$lt': new Date('2021-09-22T00:00:00.000Z')
                        }
                    },
                    {
                        'recorded': {
                            '$gte': new Date('2021-09-19T00:00:00.000Z')
                        }
                    }
                ]
            });
        });
    });
});
