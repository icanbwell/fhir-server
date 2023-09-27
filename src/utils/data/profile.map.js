const { VERSIONS } = require('../../middleware/fhir/utils/constants');

/**
 * Currently supports profiles from http://hl7.org/fhir/R4/profilelist.html
 */
const canonicalToOriginalUrlMap = {
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
            'http://hl7.org/fhir/StructureDefinition/vitalspanel':
                'http://hl7.org/fhir/R4/vitalspanel.profile.json',
            'http://hl7.org/fhir/StructureDefinition/resprate':
                'http://hl7.org/fhir/R4/resprate.profile.json',
            'http://hl7.org/fhir/StructureDefinition/heartrate':
                'http://hl7.org/fhir/R4/heartrate.profile.json',
            'http://hl7.org/fhir/StructureDefinition/oxygensat':
                'http://hl7.org/fhir/R4/oxygensat.profile.json',
            'http://hl7.org/fhir/StructureDefinition/bodytemp':
                'http://hl7.org/fhir/R4/bodytemp.profile.json',
            'http://hl7.org/fhir/StructureDefinition/bodyheight':
                'http://hl7.org/fhir/R4/bodyheight.profile.json',
            'http://hl7.org/fhir/StructureDefinition/headcircum':
                'http://hl7.org/fhir/R4/headcircum.profile.json',
            'http://hl7.org/fhir/StructureDefinition/bodyweight':
                'http://hl7.org/fhir/R4/bodyweight.profile.json',
            'http://hl7.org/fhir/StructureDefinition/bmi':
                'http://hl7.org/fhir/R4/bmi.profile.json',
            'http://hl7.org/fhir/StructureDefinition/bp': 'http://hl7.org/fhir/R4/bp.profile.json',
        },
        PlanDefinition: {
            'http://hl7.org/fhir/StructureDefinition/shareableplandefinition':
                'http://hl7.org/fhir/R4/shareableplandefinition.profile.json',
            'http://hl7.org/fhir/StructureDefinition/computableplandefinition':
                'https://hl7.org/fhir/cdshooksserviceplandefinition.profile.json',
            'http://hl7.org/fhir/StructureDefinition/cdshooksserviceplandefinition':
                'http://hl7.org/fhir/R4/cdshooksserviceplandefinition.profile.json',
        },
        Provenance: {
            'http://hl7.org/fhir/StructureDefinition/provenance-relevant-history':
                'http://hl7.org/fhir/R4/provenance-relevant-history.profile.json',
        },
        Questionnaire: {
            'http://hl7.org/fhir/StructureDefinition/cqf-questionnaire':
                'http://hl7.org/fhir/R4/cqf-questionnaire.profile.json',
        },
        RequestGroup: {
            'http://hl7.org/fhir/StructureDefinition/cdshooksrequestgroup':
                'http://hl7.org/fhir/R4/cdshooksrequestgroup.profile.json',
        },
        ServiceRequest: {
            'http://hl7.org/fhir/StructureDefinition/servicerequest-genetics':
                'http://hl7.org/fhir/R4/servicerequest-genetics.profile.json',
        },
        ValueSet: {
            'http://hl7.org/fhir/StructureDefinition/shareablevalueset':
                'http://hl7.org/fhir/R4/shareablevalueset.profile.json',
        },
    },
};

module.exports = { canonicalToOriginalUrlMap };
