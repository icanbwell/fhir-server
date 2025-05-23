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
/** @type {import('../complex_types/codeableConcept.js')} */
let CodeableConceptSerializer;
/** @type {import('../complex_types/reference.js')} */
let ReferenceSerializer;
/** @type {import('../complex_types/annotation.js')} */
let AnnotationSerializer;
/** @type {import('../backbone_elements/listEntry.js')} */
let ListEntrySerializer;

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
    if (serializerName === 'CodeableConcept' && !CodeableConceptSerializer) {
        CodeableConceptSerializer = require('../complex_types/codeableConcept.js');
        return CodeableConceptSerializer;
    }
    if (serializerName === 'Reference' && !ReferenceSerializer) {
        ReferenceSerializer = require('../complex_types/reference.js');
        return ReferenceSerializer;
    }
    if (serializerName === 'Annotation' && !AnnotationSerializer) {
        AnnotationSerializer = require('../complex_types/annotation.js');
        return AnnotationSerializer;
    }
    if (serializerName === 'ListEntry' && !ListEntrySerializer) {
        ListEntrySerializer = require('../backbone_elements/listEntry.js');
        return ListEntrySerializer;
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

class ListSerializer {
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
        status: null,
        mode: null,
        title: null,
        code: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
        },
        subject: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serialize(value, ReferenceSerializer);
        },
        encounter: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serialize(value, ReferenceSerializer);
        },
        date: null,
        source: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serialize(value, ReferenceSerializer);
        },
        orderedBy: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
        },
        note: (value) => {
            initializeSerializers('Annotation');
            return FhirResourceSerializer.serializeArray(value, AnnotationSerializer);
        },
        entry: (value) => {
            initializeSerializers('ListEntry');
            return FhirResourceSerializer.serializeArray(value, ListEntrySerializer);
        },
        emptyReason: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
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
            return rawJson.map(item => ListSerializer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        Object.keys(rawJson).forEach(propertyName => {
            const value = rawJson[propertyName];

            if (value === null || value === undefined) {
                delete rawJson[propertyName];
                return;
            }

            if (propertyName in ListSerializer.propertyToSerializerMap) {
                if (ListSerializer.propertyToSerializerMap[propertyName]) {
                    const serializedValue = ListSerializer.propertyToSerializerMap[propertyName](value);
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

module.exports = ListSerializer;
