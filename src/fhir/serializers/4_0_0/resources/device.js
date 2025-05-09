// This file is auto-generated by generate_classes so do not edit manually

/** @type {import('../complex_types/meta.js')} */
let MetaSerializer;
/** @type {import('../complex_types/narrative.js')} */
let NarrativeSerializer;
/** @type {import('../simple_types/resourceContainer.js')} */
let ResourceContainerSerializer;
/** @type {import('../complex_types/extension.js')} */
let ExtensionSerializer;
/** @type {import('../complex_types/identifier.js')} */
let IdentifierSerializer;
/** @type {import('../complex_types/reference.js')} */
let ReferenceSerializer;
/** @type {import('../backbone_elements/deviceUdiCarrier.js')} */
let DeviceUdiCarrierSerializer;
/** @type {import('../complex_types/codeableConcept.js')} */
let CodeableConceptSerializer;
/** @type {import('../backbone_elements/deviceDeviceName.js')} */
let DeviceDeviceNameSerializer;
/** @type {import('../backbone_elements/deviceSpecialization.js')} */
let DeviceSpecializationSerializer;
/** @type {import('../backbone_elements/deviceVersion.js')} */
let DeviceVersionSerializer;
/** @type {import('../backbone_elements/deviceProperty.js')} */
let DevicePropertySerializer;
/** @type {import('../complex_types/contactPoint.js')} */
let ContactPointSerializer;
/** @type {import('../complex_types/annotation.js')} */
let AnnotationSerializer;

/**
 * Lazy loads the required serializers
 * It esnures that require is called only once for each serializer to minimize the call stack for require()
 * @returns {any}
 */
function initializeSerializers(serializerName) {
    initializeResourceSerializer()
    if (serializerName === 'Meta' && !MetaSerializer) {
        MetaSerializer = require('../complex_types/meta.js');
        return MetaSerializer;
    }
    if (serializerName === 'Narrative' && !NarrativeSerializer) {
        NarrativeSerializer = require('../complex_types/narrative.js');
        return NarrativeSerializer;
    }
    if (serializerName === 'ResourceContainer' && !ResourceContainerSerializer) {
        ResourceContainerSerializer = require('../simple_types/resourceContainer.js');
        return ResourceContainerSerializer;
    }
    if (serializerName === 'Extension' && !ExtensionSerializer) {
        ExtensionSerializer = require('../complex_types/extension.js');
        return ExtensionSerializer;
    }
    if (serializerName === 'Identifier' && !IdentifierSerializer) {
        IdentifierSerializer = require('../complex_types/identifier.js');
        return IdentifierSerializer;
    }
    if (serializerName === 'Reference' && !ReferenceSerializer) {
        ReferenceSerializer = require('../complex_types/reference.js');
        return ReferenceSerializer;
    }
    if (serializerName === 'DeviceUdiCarrier' && !DeviceUdiCarrierSerializer) {
        DeviceUdiCarrierSerializer = require('../backbone_elements/deviceUdiCarrier.js');
        return DeviceUdiCarrierSerializer;
    }
    if (serializerName === 'CodeableConcept' && !CodeableConceptSerializer) {
        CodeableConceptSerializer = require('../complex_types/codeableConcept.js');
        return CodeableConceptSerializer;
    }
    if (serializerName === 'DeviceDeviceName' && !DeviceDeviceNameSerializer) {
        DeviceDeviceNameSerializer = require('../backbone_elements/deviceDeviceName.js');
        return DeviceDeviceNameSerializer;
    }
    if (serializerName === 'DeviceSpecialization' && !DeviceSpecializationSerializer) {
        DeviceSpecializationSerializer = require('../backbone_elements/deviceSpecialization.js');
        return DeviceSpecializationSerializer;
    }
    if (serializerName === 'DeviceVersion' && !DeviceVersionSerializer) {
        DeviceVersionSerializer = require('../backbone_elements/deviceVersion.js');
        return DeviceVersionSerializer;
    }
    if (serializerName === 'DeviceProperty' && !DevicePropertySerializer) {
        DevicePropertySerializer = require('../backbone_elements/deviceProperty.js');
        return DevicePropertySerializer;
    }
    if (serializerName === 'ContactPoint' && !ContactPointSerializer) {
        ContactPointSerializer = require('../complex_types/contactPoint.js');
        return ContactPointSerializer;
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

class DeviceSerializer {
    static propertyToSerializerMap = {
        id: null,
        meta: (value) => {
            initializeSerializers('Meta');
            return FhirResourceSerializer.serialize(value, MetaSerializer);
        },
        implicitRules: null,
        language: null,
        text: (value) => {
            initializeSerializers('Narrative');
            return FhirResourceSerializer.serialize(value, NarrativeSerializer);
        },
        contained: (value) => {
            initializeSerializers('ResourceContainer');
            return FhirResourceSerializer.serializeArray(value);
        },
        extension: (value) => {
            initializeSerializers('Extension');
            return FhirResourceSerializer.serializeArray(value, ExtensionSerializer);
        },
        modifierExtension: (value) => {
            initializeSerializers('Extension');
            return FhirResourceSerializer.serializeArray(value, ExtensionSerializer);
        },
        identifier: (value) => {
            initializeSerializers('Identifier');
            return FhirResourceSerializer.serializeArray(value, IdentifierSerializer);
        },
        definition: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serialize(value, ReferenceSerializer);
        },
        udiCarrier: (value) => {
            initializeSerializers('DeviceUdiCarrier');
            return FhirResourceSerializer.serializeArray(value, DeviceUdiCarrierSerializer);
        },
        status: null,
        statusReason: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serializeArray(value, CodeableConceptSerializer);
        },
        distinctIdentifier: null,
        manufacturer: null,
        manufactureDate: null,
        expirationDate: null,
        lotNumber: null,
        serialNumber: null,
        deviceName: (value) => {
            initializeSerializers('DeviceDeviceName');
            return FhirResourceSerializer.serializeArray(value, DeviceDeviceNameSerializer);
        },
        modelNumber: null,
        partNumber: null,
        type: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
        },
        specialization: (value) => {
            initializeSerializers('DeviceSpecialization');
            return FhirResourceSerializer.serializeArray(value, DeviceSpecializationSerializer);
        },
        version: (value) => {
            initializeSerializers('DeviceVersion');
            return FhirResourceSerializer.serializeArray(value, DeviceVersionSerializer);
        },
        property: (value) => {
            initializeSerializers('DeviceProperty');
            return FhirResourceSerializer.serializeArray(value, DevicePropertySerializer);
        },
        patient: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serialize(value, ReferenceSerializer);
        },
        owner: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serialize(value, ReferenceSerializer);
        },
        contact: (value) => {
            initializeSerializers('ContactPoint');
            return FhirResourceSerializer.serializeArray(value, ContactPointSerializer);
        },
        location: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serialize(value, ReferenceSerializer);
        },
        url: null,
        note: (value) => {
            initializeSerializers('Annotation');
            return FhirResourceSerializer.serializeArray(value, AnnotationSerializer);
        },
        safety: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serializeArray(value, CodeableConceptSerializer);
        },
        parent: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serialize(value, ReferenceSerializer);
        },
        resourceType: null
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
            return rawJson.map(item => DeviceSerializer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        Object.keys(rawJson).forEach(propertyName => {
            const value = rawJson[propertyName];

            if (value === null || value === undefined) {
                delete rawJson[propertyName];
                return;
            }

            if (propertyName in DeviceSerializer.propertyToSerializerMap) {
                if (DeviceSerializer.propertyToSerializerMap[propertyName]) {
                    const serializedValue = DeviceSerializer.propertyToSerializerMap[propertyName](value);
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

module.exports = DeviceSerializer;
