const {MongoClient} = require('mongodb');

class ConsentAuthorization {
    constructor(clientConfig) {
        this.clientConfig = clientConfig;

        this.mongoClient = null;

        this.SYSTEM_ROLE_CODE = 'http://terminology.hl7.org/3.1.0/CodeSystem-v3-RoleCode';
        this.SYSTEM_ACCESS = 'https://www.icanbwell.com/access';
        this.ROLE_DELEGATEE = 'DELEGATEE';
        this.ROLE_CONSENTER = 'CONSENTER';
        this.PROVISION_TYPE = 'permit';
        this.CONSENT_STATUS = 'active';
    }

    async authorize(group) {
        await this.getMongoClient();
        var fhirConsents = await this.getFhirConsent(group);
        var patientIds = await this.getConsentedPatientIds(fhirConsents);
        this.mongoClient.close();
        return patientIds;
    }

    async getMongoClient() {
        this.mongoClient = new MongoClient(this.clientConfig.connection, this.clientConfig.options);
        try {
            await this.mongoClient.connect();
        } catch (e) {
            console.error(`Failed to connect to ${this.clientConfig.connection}`, {'error': e});
            throw e;
        }
    }

    async getFhirConsent(group) {
        var dbName = this.clientConfig.db_name;

        var query = {
            'provision.actor.role.coding.code': { '$in': [group, this.ROLE_DELEGATEE]},
            'provision.actor.role.coding.system': { '$in': [
                this.SYSTEM_ACCESS,
                this.SYSTEM_ROLE_CODE
            ]},
            'provision.type': this.PROVISION_TYPE,
            'status': this.CONSENT_STATUS,
        };
        var result = await this.mongoClient.db(dbName).collection('Consent_4_0_0').find(query);

        return result;
    }

    async getConsentedPatientIds(fhirConsents) {
        var patientIds = [];
        await fhirConsents.forEach((consent) => {
            var consentProvision = consent.provision.actor.find(a =>
                a.role.coding.find(c =>
                    c.code === this.ROLE_CONSENTER && c.system === this.SYSTEM_ROLE_CODE));
            var patientId = consentProvision.reference.reference;
            patientIds.push(patientId.replace('Patient/', ''));
        });

        return patientIds;
    }
}

module.exports = {
    ConsentAuthorization
};
