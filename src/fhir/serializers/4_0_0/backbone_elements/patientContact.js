// This file is auto-generated by generate_classes so do not edit manually

/** @type {import('../complex_types/extension.js')} */
let ExtensionSerializer;
/** @type {import('../complex_types/codeableConcept.js')} */
let CodeableConceptSerializer;
/** @type {import('../complex_types/humanName.js')} */
let HumanNameSerializer;
/** @type {import('../complex_types/contactPoint.js')} */
let ContactPointSerializer;
/** @type {import('../complex_types/address.js')} */
let AddressSerializer;
/** @type {import('../complex_types/reference.js')} */
let ReferenceSerializer;
/** @type {import('../complex_types/period.js')} */
let PeriodSerializer;

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
    if (serializerName === 'HumanName' && !HumanNameSerializer) {
        HumanNameSerializer = require('../complex_types/humanName.js');
        return HumanNameSerializer;
    }
    if (serializerName === 'ContactPoint' && !ContactPointSerializer) {
        ContactPointSerializer = require('../complex_types/contactPoint.js');
        return ContactPointSerializer;
    }
    if (serializerName === 'Address' && !AddressSerializer) {
        AddressSerializer = require('../complex_types/address.js');
        return AddressSerializer;
    }
    if (serializerName === 'Reference' && !ReferenceSerializer) {
        ReferenceSerializer = require('../complex_types/reference.js');
        return ReferenceSerializer;
    }
    if (serializerName === 'Period' && !PeriodSerializer) {
        PeriodSerializer = require('../complex_types/period.js');
        return PeriodSerializer;
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

class PatientContactSerializer {
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
        relationship: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serializeArray(value, CodeableConceptSerializer);
        },
        name: (value) => {
            initializeSerializers('HumanName');
            return FhirResourceSerializer.serialize(value, HumanNameSerializer);
        },
        telecom: (value) => {
            initializeSerializers('ContactPoint');
            return FhirResourceSerializer.serializeArray(value, ContactPointSerializer);
        },
        address: (value) => {
            initializeSerializers('Address');
            return FhirResourceSerializer.serialize(value, AddressSerializer);
        },
        gender: null,
        organization: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serialize(value, ReferenceSerializer);
        },
        period: (value) => {
            initializeSerializers('Period');
            return FhirResourceSerializer.serialize(value, PeriodSerializer);
        }
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
            return rawJson.map(item => PatientContactSerializer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        Object.keys(rawJson).forEach(propertyName => {
            const value = rawJson[propertyName];

            if (value === null || value === undefined) {
                delete rawJson[propertyName];
                return;
            }

            if (propertyName in PatientContactSerializer.propertyToSerializerMap) {
                if (PatientContactSerializer.propertyToSerializerMap[propertyName]) {
                    const serializedValue = PatientContactSerializer.propertyToSerializerMap[propertyName](value);
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

module.exports = PatientContactSerializer;
