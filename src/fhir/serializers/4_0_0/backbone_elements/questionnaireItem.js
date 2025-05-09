// This file is auto-generated by generate_classes so do not edit manually

/** @type {import('../complex_types/extension.js')} */
let ExtensionSerializer;
/** @type {import('../complex_types/coding.js')} */
let CodingSerializer;
/** @type {import('../backbone_elements/questionnaireEnableWhen.js')} */
let QuestionnaireEnableWhenSerializer;
/** @type {import('../backbone_elements/questionnaireAnswerOption.js')} */
let QuestionnaireAnswerOptionSerializer;
/** @type {import('../backbone_elements/questionnaireInitial.js')} */
let QuestionnaireInitialSerializer;

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
    if (serializerName === 'Coding' && !CodingSerializer) {
        CodingSerializer = require('../complex_types/coding.js');
        return CodingSerializer;
    }
    if (serializerName === 'QuestionnaireEnableWhen' && !QuestionnaireEnableWhenSerializer) {
        QuestionnaireEnableWhenSerializer = require('../backbone_elements/questionnaireEnableWhen.js');
        return QuestionnaireEnableWhenSerializer;
    }
    if (serializerName === 'QuestionnaireAnswerOption' && !QuestionnaireAnswerOptionSerializer) {
        QuestionnaireAnswerOptionSerializer = require('../backbone_elements/questionnaireAnswerOption.js');
        return QuestionnaireAnswerOptionSerializer;
    }
    if (serializerName === 'QuestionnaireInitial' && !QuestionnaireInitialSerializer) {
        QuestionnaireInitialSerializer = require('../backbone_elements/questionnaireInitial.js');
        return QuestionnaireInitialSerializer;
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

class QuestionnaireItemSerializer {
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
        linkId: null,
        definition: null,
        code: (value) => {
            initializeSerializers('Coding');
            return FhirResourceSerializer.serializeArray(value, CodingSerializer);
        },
        prefix: null,
        text: null,
        type: null,
        enableWhen: (value) => {
            initializeSerializers('QuestionnaireEnableWhen');
            return FhirResourceSerializer.serializeArray(value, QuestionnaireEnableWhenSerializer);
        },
        enableBehavior: null,
        required: null,
        repeats: null,
        readOnly: null,
        maxLength: null,
        answerValueSet: null,
        answerOption: (value) => {
            initializeSerializers('QuestionnaireAnswerOption');
            return FhirResourceSerializer.serializeArray(value, QuestionnaireAnswerOptionSerializer);
        },
        initial: (value) => {
            initializeSerializers('QuestionnaireInitial');
            return FhirResourceSerializer.serializeArray(value, QuestionnaireInitialSerializer);
        },
        item: (value) => {
            initializeSerializers('QuestionnaireItem');
            return FhirResourceSerializer.serializeArray(value, QuestionnaireItemSerializer);
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
            return rawJson.map(item => QuestionnaireItemSerializer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        Object.keys(rawJson).forEach(propertyName => {
            const value = rawJson[propertyName];

            if (value === null || value === undefined) {
                delete rawJson[propertyName];
                return;
            }

            if (propertyName in QuestionnaireItemSerializer.propertyToSerializerMap) {
                if (QuestionnaireItemSerializer.propertyToSerializerMap[propertyName]) {
                    const serializedValue = QuestionnaireItemSerializer.propertyToSerializerMap[propertyName](value);
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

module.exports = QuestionnaireItemSerializer;
