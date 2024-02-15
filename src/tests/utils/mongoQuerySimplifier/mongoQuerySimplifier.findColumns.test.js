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

    describe('Patient mongoQuerySimplifier findColumn Tests', () => {
        test('mongoQuerySimplifier works for findColumn query 1', () => {
            const query = {
                '$and': [
                    {
                        '$or': [
                            {
                                '$and': [
                                    {
                                        'meta.security.code': 'https://www.icanbwell.com/access%7Cclient'
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
        test('mongoQuerySimplifier works for findColumn query nested', () => {
            const query = {
                'identifier': {
                    '$elemMatch': {
                        'system': 'http://www.client.com/profileid',
                        'value': '1000000-a-01'
                    }
                }
            };

            const columns = MongoQuerySimplifier.findColumnsInFilter({filter: query});
            logInfo('', {columns});
            expect(Array.from(columns)).toStrictEqual(['identifier.system', 'identifier.value']);
        });
    });
});
