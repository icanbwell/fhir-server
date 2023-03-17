const { MongoClient } = require('mongodb');

class ConsentAuthorization {
    constructor(clientConfig) {
        this.clientConfig = clientConfig;

        this.mongoClient = null;

        this.SYSTEM_ROLE_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType';
        this.SOURCE_SIGNING_AUTHORITY = 'https://www.icanbwell.com/sourceAssigningAuthority';
        this.ROLE_CONSENTER = 'CST';
        this.PROVISION_TYPE = 'permit';
        this.CONSENT_STATUS = 'active';
        this.CONSENT_QUESTIONNAIRE_NAME = 'personalizedHealthOffersAndAds';
    }

    async authorize(group) {
        await this.getMongoClient();
        let fhirConsents = await this.getFhirConsent(group);
        let patientIds = await this.getConsentedPatientIds(fhirConsents);

        let linkedPatientIds = await this.getAllLinkedPatientIds(patientIds);

        this.mongoClient.close();
        return linkedPatientIds;
    }

    async getMongoClient() {
        this.mongoClient = new MongoClient(this.clientConfig.connection, this.clientConfig.options);
        try {
            await this.mongoClient.connect();
        } catch (e) {
            console.error(`Failed to connect to ${this.clientConfig.connection}`, { 'error': e });
            throw e;
        }
    }

    async getFhirConsent(group) {
        const agg = [
            {
                '$match': {
                    'questionnaire': {
                        '$exists': true,
                        '$regex': new RegExp('Questionnaire')
                    }
                }
            }, {
                '$project': {
                    'id': 1,
                    'qid': {
                        '$substr': [
                            {
                                '$substr': [
                                    '$questionnaire', {
                                        '$indexOfCP': [
                                            '$questionnaire', 'Questionnaire'
                                        ]
                                    }, -1
                                ]
                            }, 14, -1
                        ]
                    }
                }
            }, {
                '$lookup': {
                    'from': 'Questionnaire_4_0_0',
                    'let': {
                        'questionnaire_id': '$qid'
                    },
                    'pipeline': [
                        {
                            '$match': {
                                '$expr': {
                                    '$and': [
                                        {
                                            '$eq': [
                                                '$id', '$$questionnaire_id'
                                            ]
                                        }, {
                                            '$eq': [
                                                '$name', this.CONSENT_QUESTIONNAIRE_NAME
                                            ]
                                        }
                                    ]
                                }
                            }
                        }
                    ],
                    'as': 'qr'
                }
            }, {
                '$match': {
                    'qr': {
                        '$ne': []
                    }
                }
            }, {
                '$lookup': {
                    'from': 'Consent_4_0_0',
                    'let': {
                        'qr_id': {
                            '$concat': [
                                'QuestionnaireResponse/', '$id'
                            ]
                        }
                    },
                    'pipeline': [
                        {
                            '$match': {
                                '$expr': {
                                    '$and': [
                                        {
                                            '$eq': [
                                                '$sourceReference.reference', '$$qr_id'
                                            ]
                                        }, {
                                            '$eq': [
                                                '$status', this.CONSENT_STATUS
                                            ]
                                        }, {
                                            '$eq': [
                                                '$provision.type', this.PROVISION_TYPE
                                            ]
                                        }
                                    ]
                                }
                            }
                        }
                    ],
                    'as': 'consent'
                }
            }, {
                '$match': {
                    'consent': {
                        '$ne': [],
                        '$elemMatch': {
                            'meta.security.code': group,
                            'meta.security.system': this.SOURCE_SIGNING_AUTHORITY
                        }
                    }
                }
            }
        ];

        let dbName = this.clientConfig.db_name;
        let fhirConsents = [];
        let result = await this.mongoClient.db(dbName).collection('QuestionnaireResponse_4_0_0').aggregate(agg);
        await result.forEach((r) => {
            let consent = r.consent;
            consent.forEach(c => {
                fhirConsents.push(c);
            });
        });

        return fhirConsents;
    }

    async getConsentedPatientIds(fhirConsents) {
        let patientIds = [];
        await fhirConsents.forEach((consent) => {
            let consentProvision = consent.provision.actor.find(a =>
                a.role.coding.find(c =>
                    c.code === this.ROLE_CONSENTER && c.system === this.SYSTEM_ROLE_CODE));
            let patientId = consentProvision.reference.reference;
            patientIds.push(patientId);
        });

        let uniquePatientIds = [...new Set(patientIds)];
        return uniquePatientIds;
    }

    async getAllLinkedPatientIds(patientIds) {
        const agg = [
            {
                '$match': {
                    'link': {
                        '$elemMatch': {
                            'target.reference': {
                                '$in': patientIds
                            }
                        }
                    }
                }
            }, {
                '$project': {
                    'id': 1,
                    'link': 1,
                    'refId': {
                        '$concat': [
                            'Person/', '$id'
                        ]
                    }
                }
            }, {
                '$lookup': {
                    'from': 'Person_4_0_0',
                    'localField': 'refId',
                    'foreignField': 'link.target.reference',
                    'as': 'leafPerson'
                }
            }, {
                '$project': {
                    'id': 1,
                    'link': 1,
                    'links': {
                        '$first': '$leafPerson'
                    }
                }
            }, {
                '$project': {
                    'id': 1,
                    'links': 1,
                    'link': '$links.link'
                }
            }, {
                '$project': {
                    'id': 1,
                    'link': 1,
                    'linkPerson': {
                        '$filter': {
                            'input': '$link',
                            'as': 'l',
                            'cond': {
                                '$and': [
                                    {
                                        '$eq': [
                                            '$$l.assurance', 'level4'
                                        ]
                                    }, {
                                        '$regexMatch': {
                                            'input': '$$l.target.reference',
                                            'regex': new RegExp('Person')
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            }, {
                '$project': {
                    'id': 1,
                    'link': 1,
                    'linkPersonTarget': {
                        '$map': {
                            'input': '$linkPerson',
                            'as': 'lp',
                            'in': {
                                'id': {
                                    '$cond': [
                                        {
                                            '$regexMatch': {
                                                'input': '$$lp.target.reference',
                                                'regex': new RegExp('|')
                                            }
                                        }, {
                                            '$substr': [
                                                {
                                                    '$substr': [
                                                        '$$lp.target.reference', 0, {
                                                            '$indexOfCP': [
                                                                '$$lp.target.reference', '|'
                                                            ]
                                                        }
                                                    ]
                                                }, 7, -1
                                            ]
                                        }, {
                                            '$substr': [
                                                '$$lp.target.reference', 7, -1
                                            ]
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            }, {
                '$lookup': {
                    'from': 'Person_4_0_0',
                    'localField': 'linkPersonTarget.id',
                    'foreignField': 'id',
                    'as': 'leafPerson'
                }
            }, {
                '$project': {
                    'id': 1,
                    'leafPersonId': {
                        '$filter': {
                            'input': '$link',
                            'as': 'l',
                            'cond': {
                                '$and': [
                                    {
                                        '$eq': [
                                            '$$l.assurance', 'level4'
                                        ]
                                    }, {
                                        '$regexMatch': {
                                            'input': '$$l.target.reference',
                                            'regex': new RegExp('Patient')
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            }
        ];

        let dbName = this.clientConfig.db_name;
        let result = await this.mongoClient.db(dbName).collection('Person_4_0_0').aggregate(agg);
        await result.forEach((p) => {
            let link = p.leafPersonId;
            link.forEach(l => {
                patientIds.push(l.target.reference.replace('Patient/', ''));
            });
        });

        patientIds.forEach(function(part, index) {
            // eslint-disable-next-line security/detect-object-injection
            this[index] = this[index].replace('Patient/', '');
        }, patientIds);

        let linkPatientIds = [...new Set(patientIds)];

        return linkPatientIds;
    }
}

module.exports = {
    ConsentAuthorization
};
