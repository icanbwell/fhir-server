const {commonBeforeEach, commonAfterEach} = require('../../common');
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');
const {omitProperty} = require('../../../utils/omitProperties');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('omitProperties Tests', () => {
        test('omitProperties works', async () => {
            const obj = {
                'resourceType': 'Person',
                'id': '73b3605e1b0d48f4bec55d38f47a4bc9',
                'meta': {
                    'versionId': '1',
                    'profile': [
                        'http://hl7.org/fhir/us/core/StructureDefinition/us-core-person'
                    ],
                    'security': [
                        {
                            'system': 'https://www.icanbwell.com/access',
                            'code': 'bwell'
                        },
                        {
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'bwell'
                        }
                    ],
                    'lastUpdated': '2022-08-28T22:12:12.000Z'
                },
                'identifier': [
                    {
                        'type': {
                            'coding': [
                                {
                                    'system': 'https://www.icanbwell.com',
                                    'code': 'FHIR_id',
                                    'display': 'bWell FHIR id'
                                }
                            ]
                        },
                        'system': 'https://www.icanbwell.com',
                        'value': 'bwell-73b3605e1b0d48f4bec55d38f47a4bc9'
                    }
                ],
                'name': [
                    {
                        'use': 'official',
                        'family': 'tsopufwrul',
                        'given': [
                            'Sweetie'
                        ]
                    }
                ],
                'telecom': [
                    {
                        'system': 'phone',
                        'value': '+15125550156',
                        'use': 'home'
                    },
                    {
                        'system': 'email',
                        'value': 'bwell+21340idbuc@mailinator.com',
                        'use': 'home'
                    }
                ],
                'gender': 'male',
                'birthDate': '1991-09-10',
                'address': [
                    {
                        'line': [
                            '801 W 5th St'
                        ],
                        'city': 'Austin',
                        'state': 'TX',
                        'postalCode': '78703'
                    }
                ],
                'link': [
                    {
                        'target': {
                            'reference': 'Person/5bb815275e8648edbb9d954c38479241',
                            'type': 'Person'
                        },
                        'assurance': 'level4'
                    },
                    {
                        'target': {
                            'reference': 'Patient/5ef5f545d5d0454192c5ca7b389e1a30',
                            'type': 'Patient'
                        },
                        'assurance': 'level4'
                    }
                ],
                '_access': {
                    'bwell': 1
                },
                '_id': '630be83db0fb3dc74a4f4650'
            };
            const objClean = omitProperty(obj, '_id');
            expect(objClean._id).toBeUndefined();
        });
    });
});
