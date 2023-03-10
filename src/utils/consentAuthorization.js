const {MongoClient} = require('mongodb');

class ConsentAuthorization {
    constructor(clientConfig) {
        this.clientConfig = clientConfig;
        this.SYSTEM_ROLE_CODE = 'http://terminology.hl7.org/3.1.0/CodeSystem-v3-RoleCode';
        this.SYSTEM_ACCESS = 'https://www.icanbwell.com/access';
        this.ROLE_DELEGATEE = 'DELEGATEE';
        this.ROLE_CONSENTER = 'CONSENTER';
    }

    async authorize(group) {
        console.log('get FHIR consent');
        var client = await this.getMongoClient();
        var result = await this.getFhirConsent(client, group);
        console.log('process FHIR consent');
        await this.getConsentedPatientIds(result);
        client.close();
        return 'hello there';
    }

    async getMongoClient() {
        const client = new MongoClient(this.clientConfig.connection, this.clientConfig.options);
        try {
            await client.connect();
        } catch (e) {
            console.log(`Failed to connect to ${this.clientConfig.connection}`, {'error': e});
            throw e;
        }
        return client;
    }

    async getFhirConsent(client, group) {
        var dbName = this.clientConfig.db_name;

        var query = {
            'provision.actor.role.coding.code': { '$in': [group, this.ROLE_DELEGATEE]},
            'provision.actor.role.coding.system': { '$in': [
                this.SYSTEM_ACCESS,
                this.SYSTEM_ROLE_CODE
            ]},
            'provision.type': 'permit',
            'status': 'active',
        };
        var result = await client.db(dbName).collection('Consent_4_0_0').find(query);

        return result;
    }

    async getConsentedPatientIds(fhirConsents) {
        var patientIds = [];
        await fhirConsents.forEach((consent) => {
            var consentProvision = consent.provision.actor.find(a =>
                a.role.coding.find(c =>
                    c.code === this.ROLE_CONSENTER && c.system === this.SYSTEM_ROLE_CODE));
            console.log(consentProvision);
            var test = consentProvision.reference.reference;
            console.log('provision reference');
            console.log(test);
        });

        return patientIds;
    }
}

module.exports = {
    ConsentAuthorization
};
