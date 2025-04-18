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
/** @type {import('../backbone_elements/biologicallyDerivedProductCollection.js')} */
let BiologicallyDerivedProductCollectionSerializer;
/** @type {import('../backbone_elements/biologicallyDerivedProductProcessing.js')} */
let BiologicallyDerivedProductProcessingSerializer;
/** @type {import('../backbone_elements/biologicallyDerivedProductManipulation.js')} */
let BiologicallyDerivedProductManipulationSerializer;
/** @type {import('../backbone_elements/biologicallyDerivedProductStorage.js')} */
let BiologicallyDerivedProductStorageSerializer;

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
    if (serializerName === 'BiologicallyDerivedProductCollection' && !BiologicallyDerivedProductCollectionSerializer) {
        BiologicallyDerivedProductCollectionSerializer = require('../backbone_elements/biologicallyDerivedProductCollection.js');
        return BiologicallyDerivedProductCollectionSerializer;
    }
    if (serializerName === 'BiologicallyDerivedProductProcessing' && !BiologicallyDerivedProductProcessingSerializer) {
        BiologicallyDerivedProductProcessingSerializer = require('../backbone_elements/biologicallyDerivedProductProcessing.js');
        return BiologicallyDerivedProductProcessingSerializer;
    }
    if (serializerName === 'BiologicallyDerivedProductManipulation' && !BiologicallyDerivedProductManipulationSerializer) {
        BiologicallyDerivedProductManipulationSerializer = require('../backbone_elements/biologicallyDerivedProductManipulation.js');
        return BiologicallyDerivedProductManipulationSerializer;
    }
    if (serializerName === 'BiologicallyDerivedProductStorage' && !BiologicallyDerivedProductStorageSerializer) {
        BiologicallyDerivedProductStorageSerializer = require('../backbone_elements/biologicallyDerivedProductStorage.js');
        return BiologicallyDerivedProductStorageSerializer;
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

class BiologicallyDerivedProductSerializer {
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
        productCategory: null,
        productCode: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
        },
        status: null,
        request: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serializeArray(value, ReferenceSerializer);
        },
        quantity: null,
        parent: (value) => {
            initializeSerializers('Reference');
            return FhirResourceSerializer.serializeArray(value, ReferenceSerializer);
        },
        collection: (value) => {
            initializeSerializers('BiologicallyDerivedProductCollection');
            return FhirResourceSerializer.serialize(value, BiologicallyDerivedProductCollectionSerializer);
        },
        processing: (value) => {
            initializeSerializers('BiologicallyDerivedProductProcessing');
            return FhirResourceSerializer.serializeArray(value, BiologicallyDerivedProductProcessingSerializer);
        },
        manipulation: (value) => {
            initializeSerializers('BiologicallyDerivedProductManipulation');
            return FhirResourceSerializer.serialize(value, BiologicallyDerivedProductManipulationSerializer);
        },
        storage: (value) => {
            initializeSerializers('BiologicallyDerivedProductStorage');
            return FhirResourceSerializer.serializeArray(value, BiologicallyDerivedProductStorageSerializer);
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
            return rawJson.map(item => BiologicallyDerivedProductSerializer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        Object.keys(rawJson).forEach(propertyName => {
            const value = rawJson[propertyName];

            if (value === null || value === undefined) {
                delete rawJson[propertyName];
                return;
            }

            if (propertyName in BiologicallyDerivedProductSerializer.propertyToSerializerMap) {
                if (BiologicallyDerivedProductSerializer.propertyToSerializerMap[propertyName]) {
                    const serializedValue = BiologicallyDerivedProductSerializer.propertyToSerializerMap[propertyName](value);
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

module.exports = BiologicallyDerivedProductSerializer;
