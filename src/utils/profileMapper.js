const { VERSIONS } = require('../middleware/fhir/utils/constants');

const canonicalToOriginalUrl = {
    [VERSIONS['4_0_0']]: {
        AuditEvent: {
            'http://hl7.org/fhir/StructureDefinition/ehrsrle-auditevent':
                'http://hl7.org/fhir/R4/ehrsrle/ehrsrle-auditevent.profile.json',
        },
        ElementDefinition: {
            'http://hl7.org/fhir/StructureDefinition/elementdefinition-de':
                'http://hl7.org/fhir/R4/elementdefinition-de.profile.json',
        },
        ActivityDefinition: {
            'http://hl7.org/fhir/StructureDefinition/shareableactivitydefinition':
                'http://hl7.org/fhir/R4/shareableactivitydefinition.profile.json',
        },
        CodeSystem: {
            'http://hl7.org/fhir/R4/shareableactivitydefinition.profile.json.html':
                'http://hl7.org/fhir/R4/shareablecodesystem.profile.json',
        },
        Composition: {
            'http://hl7.org/fhir/StructureDefinition/clinicaldocument':
                'http://hl7.org/fhir/R4/clinicaldocument.profile.json',
            'http://hl7.org/fhir/StructureDefinition/catalog':
                'http://hl7.org/fhir/R4/catalog.profile.json',
        },
        DiagnosticReport: {
            'http://hl7.org/fhir/StructureDefinition/lipidprofile':
                'http://hl7.org/fhir/R4/lipidprofile.profile.json',
            'http://hl7.org/fhir/StructureDefinition/cholesterol':
                'http://hl7.org/fhir/R4/cholesterol.profile.json',
            'http://hl7.org/fhir/R4/triglyceride':
                'http://hl7.org/fhir/R4/triglyceride.profile.json',
            'http://hl7.org/fhir/StructureDefinition/hdlcholesterol':
                'http://hl7.org/fhir/R4/hdlcholesterol.profile.json',
            'http://hl7.org/fhir/StructureDefinition/ldlcholesterol':
                'http://hl7.org/fhir/R4/ldlcholesterol.profile.json',
            'http://hl7.org/fhir/StructureDefinition/hlaresult':
                'http://hl7.org/fhir/R4/hlaresult.profile.json',
            'http://hl7.org/fhir/StructureDefinition/diagnosticreport-genetics':
                'http://hl7.org/fhir/R4/diagnosticreport-genetics.profile.json',
        },
        Evidence: {
            'http://hl7.org/fhir/StructureDefinition/synthesis':
                'http://hl7.org/fhir/R4/synthesis.profile.json',
        },
        EvidenceVariable: {
            'http://hl7.org/fhir/StructureDefinition/picoelement':
                'http://hl7.org/fhir/R4/picoelement.profile.json.html',
        },
        FamilyMemberHistory: {
            'http://hl7.org/fhir/StructureDefinition/familymemberhistory-genetic':
                'http://hl7.org/fhir/R4/familymemberhistory-genetic.profile.json.html',
        },
        Group: {
            'http://hl7.org/fhir/StructureDefinition/groupdefinition':
                'http://hl7.org/fhir/R4/groupdefinition.profile.json',
            'http://hl7.org/fhir/StructureDefinition/actualgroup':
                'http://hl7.org/fhir/R4/actualgroup.profile.json',
        },
        GuidanceResponse: {
            'http://hl7.org/fhir/StructureDefinition/cdshooksguidanceresponse':
                'http://hl7.org/fhir/R4/cdshooksguidanceresponse.profile.json',
        },
        Library: {
            'http://hl7.org/fhir/StructureDefinition/shareablelibrary':
                'http://hl7.org/fhir/R4/shareablelibrary.profile.json',
            'http://hl7.org/fhir/StructureDefinition/cqllibrary':
                'http://hl7.org/fhir/R4/cqllibrary.profile.json',
        },
        Measure: {
            'http://hl7.org/fhir/StructureDefinition/shareablemeasure':
                'http://hl7.org/fhir/R4/shareablemeasure.profile.json',
        },
        Observation: {
            'http://hl7.org/fhir/StructureDefinition/devicemetricobservation':
                'http://hl7.org/fhir/R4/devicemetricobservation.profile.json',
            'http://hl7.org/fhir/StructureDefinition/observation-genetics':
                'http://hl7.org/fhir/R4/observation-genetics.profile.json',
            'http://hl7.org/fhir/StructureDefinition/heartrate':
                'http://hl7.org/fhir/R4/heartrate.profile.json',
        },
        PlanDefinition: {},
        Provenance: {},
        Questionnaire: {},
        RequestGroup: {},
        ServiceRequest: {},
        ValueSet: {},
    },
};

/**
 * Maps the canonical-url to its json url.
 * Its helps in getting the profile.json data.
 */
class ProfileUrlMapper {
    constructor() {
        const mapper = canonicalToOriginalUrl['4_0_0'];
        for (const profile in mapper) {
            const profiles = mapper[`${profile}`];
            for (const canonicalUrl in profiles) {
                Object.defineProperty(this, canonicalUrl, {
                    enumerable: true,
                    value: profiles[`${canonicalUrl}`],
                    writable: false,
                });
            }
        }
    }

    /**
     * If found, then return the original url, else return the passed url
     * @param {string} canonicalUrl
     * @returns {string} Url
     */
    getOriginalUrl(canonicalUrl) {
        return this[`${canonicalUrl}`] ?? canonicalUrl;
    }
}

module.exports = { ProfileUrlMapper };
