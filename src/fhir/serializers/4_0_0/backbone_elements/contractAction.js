// This file is auto-generated by generate_classes so do not edit manually

/** @type {import('../complex_types/extension.js')} */
let ExtensionSerializer;
/** @type {import('../complex_types/codeableConcept.js')} */
let CodeableConceptSerializer;
/** @type {import('../backbone_elements/contractSubject.js')} */
let ContractSubjectSerializer;
/** @type {import('../complex_types/reference.js')} */
let ReferenceSerializer;
/** @type {import('../complex_types/period.js')} */
let PeriodSerializer;
/** @type {import('../backbone_elements/timing.js')} */
let TimingSerializer;
/** @type {import('../complex_types/annotation.js')} */
let AnnotationSerializer;

/**
 * Lazy loads the required serializers
 * It esnures that require is called only once for each serializer to minimize the call stack for require()
 * @returns {any}
 */
function initializeSerializers(serializerName) {
    initializeResourceSerializer()
    if (serializerName === 'Extension' && !ExtensionSerializer) {
        ExtensionSerializer = require('../complex_types/extension.js');
        return ExtensionSerializer;
    }
    if (serializerName === 'CodeableConcept' && !CodeableConceptSerializer) {
        CodeableConceptSerializer = require('../complex_types/codeableConcept.js');
        return CodeableConceptSerializer;
    }
    if (serializerName === 'ContractSubject' && !ContractSubjectSerializer) {
        ContractSubjectSerializer = require('../backbone_elements/contractSubject.js');
        return ContractSubjectSerializer;
    }
    if (serializerName === 'Reference' && !ReferenceSerializer) {
        ReferenceSerializer = require('../complex_types/reference.js');
        return ReferenceSerializer;
    }
    if (serializerName === 'Period' && !PeriodSerializer) {
        PeriodSerializer = require('../complex_types/period.js');
        return PeriodSerializer;
    }
    if (serializerName === 'Timing' && !TimingSerializer) {
        TimingSerializer = require('../backbone_elements/timing.js');
        return TimingSerializer;
    }
    if (serializerName === 'Annotation' && !AnnotationSerializer) {
        AnnotationSerializer = require('../complex_types/annotation.js');
        return AnnotationSerializer;
    }
}

/** @type {import('../../../fhirResourceSerializer.js').FhirResourceSerializer} */
let FhirResourceSerializer;

function initializeResourceSerializer() {
    if (!FhirResourceSerializer) {
        FhirResourceSerializer = require('../../../fhirResourceSerializer.js').FhirResourceSerializer;
    }

    return FhirResourceSerializer;
}

class ContractActionSerializer {
    static propertyToSerializerMap = {
        id: null,
        extension: (value) => {
            initializeSerializers('Extension');
            return FhirResourceSerializer.serializeArray(value, ExtensionSerializer);
        },
        modifierExtension: (value) => {
            initializeSerializers('Extension');
            return FhirResourceSerializer.serializeArray(value, ExtensionSerializer);
        },
        doNotPerform: null,
        type: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
        },
        subject: (value) => {
            initializeSerializers('ContractSubject');
            return FhirResourceSerializer.serializeArray(value, ContractSubjectSerializer);
        },
        intent: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
        },
        linkId: null,
        status: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
        },
        context: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serialize(value, ReferenceSerializer);
        },
        contextLinkId: null,
        occurrenceDateTime: null,
        occurrencePeriod: (value) => {
            initializeSerializers('Period');
            return FhirResourceSerializer.serialize(value, PeriodSerializer);
        },
        occurrenceTiming: (value) => {
            initializeSerializers('Timing');
            return FhirResourceSerializer.serialize(value, TimingSerializer);
        },
        requester: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serializeArray(value, ReferenceSerializer);
        },
        requesterLinkId: null,
        performerType: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serializeArray(value, CodeableConceptSerializer);
        },
        performerRole: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
        },
        performer: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serialize(value, ReferenceSerializer);
        },
        performerLinkId: null,
        reasonCode: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serializeArray(value, CodeableConceptSerializer);
        },
        reasonReference: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serializeArray(value, ReferenceSerializer);
        },
        reason: null,
        reasonLinkId: null,
        note: (value) => {
            initializeSerializers('Annotation');
            return FhirResourceSerializer.serializeArray(value, AnnotationSerializer);
        },
        securityLabelNumber: null
    };

    /**
     * This methods cleans the raw json by removing additional fields which are not defined
     * according to FHIR Specs
     * @param {any} rawJson
     * @returns {any} Cleaned object
     */
    static serialize(rawJson) {
        if (!rawJson) return rawJson;

        // Handle array case
        if (Array.isArray(rawJson)) {
            return rawJson.map(item => ContractActionSerializer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        Object.keys(rawJson).forEach(propertyName => {
            const value = rawJson[propertyName];

            if (value === null || value === undefined) {
                delete rawJson[propertyName];
                return;
            }

            if (propertyName in ContractActionSerializer.propertyToSerializerMap) {
                if (ContractActionSerializer.propertyToSerializerMap[propertyName]) {
                    const serializedValue = ContractActionSerializer.propertyToSerializerMap[propertyName](value);
                    if (serializedValue === null || serializedValue === undefined) {
                        delete rawJson[propertyName];
                    } else {
                        rawJson[propertyName] = serializedValue;
                    }
                }
            } else {
                delete rawJson[propertyName];
            }
        });

        return rawJson;
    }
}

module.exports = ContractActionSerializer;
