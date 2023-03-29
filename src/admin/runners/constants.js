/**
 * @name exports
 * @summary Some constants used throughout the app
 */
module.exports = {
    PRACTITIONER_SOURCE_OWNER_MAP: {
        'http://medstarhealth.org/insurance': 'medstar',
        'https://www.vaeagle.com/rx_claims': 'lnf',
        'https://altruahealthshare.org': 'altrua',
        'http://medstarhealth.org/provider_headshots': 'medstar',
        'https://flatfile.salesforce.com/unitypoint/providers': 'unitypoint',
        'http://medstarhealth.org/provider': 'medstar',
        'https://api.kyruus.com/pm/v8/unitypoint/providers': 'unitypoint',
        'https://www.boonchapman.com/rx_claims': 'lnf',
        'https://www.merrittproperties.com/carefirst/medical_claims': 'merritt',
        'https://www.healthpartners.com/rx_claims': 'thedacare',
        'https://www.burrislogistics.com/highmark/medical_claims': 'burris',
        'https://www.vaeagle.com/medical_claims': 'virginiaeagle',
        'https://honestmedicalgroup.com': 'honest',
        'https://www.healthpartners.com/providers': 'thedacare',
        'https://www.cms.gov/cclf/unitypoint_claims': 'unitypoint',
        'https://www.burrislogistics.com/medco/rx_claims': 'burris',
        'https://www.penfed.org/anthem/medical_claims': 'penfed',
        'https://directory.thedacare.org/hgwf-api/v1': 'thedacare',
        'https://directory.thedacare.org/hgwf-api/v1/records/hg_provider': 'thedacare',
        'https://www.merrittproperties.com/carefirst/rx_claims': 'merritt',
        'https://npiregistry.cms.hhs.gov': 'nppes',
        'https://www.boonchapman.com/medical_claims': 'lnf',
    },
    NPPES: 'nppes',
    NPI_SYSTEM: 'http://hl7.org/fhir/sid/us-npi'
};
