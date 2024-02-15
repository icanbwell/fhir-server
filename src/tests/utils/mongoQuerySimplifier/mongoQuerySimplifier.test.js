const { commonBeforeEach, commonAfterEach } = require('../../common');
const { MongoQuerySimplifier } = require('../../../utils/mongoQuerySimplifier');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { logInfo } = require('../../../operations/common/logging');

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
                $and: [
                    {
                        $or: [
                            {
                                $and: [
                                    {
                                        'meta.security.code': 'https://www.icanbwell.com/access%7Cclient'
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        $or: [
                            {
                                $and: [
                                    {
                                        birthDate: {
                                            $lt: '2021-09-22T00:00:00+00:00'
                                        }
                                    },
                                    {
                                        birthDate: {
                                            $gte: '2021-09-19T00:00:00+00:00'
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({ filter: query });
            logInfo('', { result });
            expect(result).toStrictEqual({
                $and: [
                    {
                        'meta.security.code': 'https://www.icanbwell.com/access%7Cclient'
                    },
                    {
                        birthDate: {
                            $lt: '2021-09-22T00:00:00+00:00'
                        }
                    },
                    {
                        birthDate: {
                            $gte: '2021-09-19T00:00:00+00:00'
                        }
                    }
                ]
            });
        });
        test('mongoQuerySimplifier works for single query', () => {
            const query = {
                $and: [
                    {
                        'meta.security.code': 'https://www.icanbwell.com/access%7Cclient'
                    },
                    {
                        $and: [
                            {
                                birthDate: {
                                    $lt: '2021-09-22T00:00:00+00:00'
                                }
                            },
                            {
                                birthDate: {
                                    $gte: '2021-09-19T00:00:00+00:00'
                                }
                            }
                        ]
                    }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({ filter: query });
            logInfo('', { result });
            expect(result).toStrictEqual({
                $and: [
                    {
                        'meta.security.code': 'https://www.icanbwell.com/access%7Cclient'
                    },
                    {
                        birthDate: {
                            $lt: '2021-09-22T00:00:00+00:00'
                        }
                    },
                    {
                        birthDate: {
                            $gte: '2021-09-19T00:00:00+00:00'
                        }
                    }
                ]
            });
        });
        test('mongoQuerySimplifier converts $or to $in', () => {
            const query = {
                $or: [
                    { foo: '1' },
                    { foo: '2' }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({ filter: query });
            logInfo('', { result });
            expect(result).toStrictEqual({
                foo: {
                    $in: ['1', '2']
                }
            });
        });
        test('mongoQuerySimplifier does not convert $or to $in if fields are different', () => {
            const query = {
                $or: [
                    { foo: '1' },
                    { bar: '2' }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({ filter: query });
            logInfo('', { result });
            expect(result).toStrictEqual({
                $or: [
                    { foo: '1' },
                    { bar: '2' }
                ]
            });
        });
        test('mongoQuerySimplifier does not convert $or to $in if fields are not primitive', () => {
            const query = {
                $and: [
                    {
                        $or: [
                            {
                                $and: [
                                    {
                                        'subject._sourceAssigningAuthority': 'C'
                                    },
                                    {
                                        'subject._sourceId': 'Patient/patient1'
                                    }
                                ]
                            },
                            {
                                $and: [
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

            const result = MongoQuerySimplifier.simplifyFilter({ filter: query });
            logInfo('', { result });
            expect(result).toStrictEqual({
                $or: [
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'C'
                            },
                            {
                                'subject._sourceId': 'Patient/patient1'
                            }
                        ]
                    },
                    {
                        $and: [
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
                $and: [
                    {
                        $or: [
                            {
                                $or: []
                            }
                        ]
                    },
                    {
                        $or: []
                    }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({ filter: query });
            logInfo('', { result });
            expect(result).toStrictEqual({});
        });
        test('mongoQuerySimplifier handles date clauses', () => {
            const query = {
                $and: [
                    {
                        $or: [
                            {
                                $and: [
                                    {
                                        'meta.security.code': 'https://www.icanbwell.com/access%7Cfoobar'
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        $or: [
                            {
                                $and: [
                                    {
                                        recorded: {
                                            $lt: new Date('2021-09-22T00:00:00.000Z')
                                        }
                                    },
                                    {
                                        recorded: {
                                            $gte: new Date('2021-09-19T00:00:00.000Z')
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({ filter: query });
            logInfo('', { result });
            expect(result).toStrictEqual({
                $and: [
                    {
                        'meta.security.code': 'https://www.icanbwell.com/access%7Cfoobar'
                    },
                    {
                        recorded: {
                            $lt: new Date('2021-09-22T00:00:00.000Z')
                        }
                    },
                    {
                        recorded: {
                            $gte: new Date('2021-09-19T00:00:00.000Z')
                        }
                    }
                ]
            });
        });
        test('mongoQuerySimplifier handles regex clauses', () => {
            const query = {
                $and: [
                    {
                        $or: [
                            {
                                $and: [
                                    {
                                        $or: [
                                            {
                                                'code.text': {
                                                    $regex: /prednisoLONE/,
                                                    $options: 'i'
                                                }
                                            },
                                            {
                                                'code.coding.display': {
                                                    $regex: /prednisoLONE/,
                                                    $options: 'i'
                                                }
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({ filter: query });
            logInfo('', { result });
            expect(result).toStrictEqual({
                $or: [
                    {
                        'code.text': {
                            $regex: /prednisoLONE/,
                            $options: 'i'
                        }
                    },
                    {
                        'code.coding.display': {
                            $regex: /prednisoLONE/,
                            $options: 'i'
                        }
                    }
                ]
            });
        });
        test('mongoQuerySimplifier removes duplicate $in items', () => {
            const query = {
                $or: [
                    {
                        'relatedArtifact.resource._sourceId': {
                            $in: [
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN'
                            ]
                        }
                    },
                    {
                        'library._sourceId': {
                            $in: [
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN'
                            ]
                        }
                    }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({ filter: query });
            logInfo('', { result });
            expect(result).toStrictEqual({
                $or: [
                    {
                        'relatedArtifact.resource._sourceId': 'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN'
                    },
                    {
                        'library._sourceId': 'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN'
                    }
                ]
            });
        });
        test('mongoQuerySimplifier handles nested $or and $and simple', () => {
            const query = {
                $and: [
                    {
                        'effectivePeriod.start': {
                            $lte: '2019-10-16T22:12:29+00:00'
                        }
                    },
                    {
                        $or: [
                            {
                                'effectivePeriod.end': {
                                    $gte: '2019-10-16T22:12:29+00:00'
                                }
                            },
                            {
                                'effectivePeriod.end': null
                            }
                        ]
                    }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({ filter: query });
            logInfo('', { result });
            expect(result).toStrictEqual({
                $and: [
                    {
                        'effectivePeriod.start': {
                            $lte: '2019-10-16T22:12:29+00:00'
                        }
                    },
                    {
                        $or: [
                            {
                                'effectivePeriod.end': {
                                    $gte: '2019-10-16T22:12:29+00:00'
                                }
                            },
                            {
                                'effectivePeriod.end': null
                            }
                        ]
                    }
                ]
            });
        });
        test('mongoQuerySimplifier handles nested $or and $and', () => {
            const query = {
                $and: [
                    {
                        $or: [
                            {
                                $and: [
                                    {
                                        effectiveDateTime: {
                                            $regex: /\^\(\?:2019-10-16T22:12\)\|\(\?:2019-10-16T22:12:29\.000Z\)\|\(\?:2019\$\)\|\(\?:2019-10\$\)\|\(\?:2019-10-16\$\)\|\(\?:2019-10-16T22:12Z\?\$\)/,
                                            $options: 'i'
                                        }
                                    }
                                ]
                            },
                            {
                                $and: [
                                    {
                                        'effectivePeriod.start': {
                                            $lte: '2019-10-16T22:12:29+00:00'
                                        }
                                    },
                                    {
                                        $or: [
                                            {
                                                'effectivePeriod.end': {
                                                    $gte: '2019-10-16T22:12:29+00:00'
                                                }
                                            },
                                            {
                                                'effectivePeriod.end': null
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                $and: [
                                    {
                                        effectiveTiming: {
                                            $regex: /\^\(\?:2019-10-16T22:12\)\|\(\?:2019-10-16T22:12:29\.000Z\)\|\(\?:2019\$\)\|\(\?:2019-10\$\)\|\(\?:2019-10-16\$\)\|\(\?:2019-10-16T22:12Z\?\$\)/,
                                            $options: 'i'
                                        }
                                    }
                                ]
                            },
                            {
                                $and: [
                                    {
                                        effectiveInstant: {
                                            $regex: /\^\(\?:2019-10-16T22:12\)\|\(\?:2019-10-16T22:12:29\.000Z\)\|\(\?:2019\$\)\|\(\?:2019-10\$\)\|\(\?:2019-10-16\$\)\|\(\?:2019-10-16T22:12Z\?\$\)/,
                                            $options: 'i'
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const result = MongoQuerySimplifier.simplifyFilter({ filter: query });
            logInfo('', { result });
            expect(result).toStrictEqual({
                $or: [
                    {
                        effectiveDateTime: {
                            $options: 'i',
                            $regex: /\^\(\?:2019-10-16T22:12\)\|\(\?:2019-10-16T22:12:29\.000Z\)\|\(\?:2019\$\)\|\(\?:2019-10\$\)\|\(\?:2019-10-16\$\)\|\(\?:2019-10-16T22:12Z\?\$\)/
                        }
                    },
                    {
                        $and: [
                            {
                                'effectivePeriod.start': {
                                    $lte: '2019-10-16T22:12:29+00:00'
                                }
                            },
                            {
                                $or: [
                                    {
                                        'effectivePeriod.end': {
                                            $gte: '2019-10-16T22:12:29+00:00'
                                        }
                                    },
                                    {
                                        'effectivePeriod.end': null
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        effectiveTiming: {
                            $options: 'i',
                            $regex: /\^\(\?:2019-10-16T22:12\)\|\(\?:2019-10-16T22:12:29\.000Z\)\|\(\?:2019\$\)\|\(\?:2019-10\$\)\|\(\?:2019-10-16\$\)\|\(\?:2019-10-16T22:12Z\?\$\)/
                        }
                    },
                    {
                        effectiveInstant: {
                            $options: 'i',
                            $regex: /\^\(\?:2019-10-16T22:12\)\|\(\?:2019-10-16T22:12:29\.000Z\)\|\(\?:2019\$\)\|\(\?:2019-10\$\)\|\(\?:2019-10-16\$\)\|\(\?:2019-10-16T22:12Z\?\$\)/
                        }
                    }
                ]
            });
        });
    });
});
