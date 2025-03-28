// This file is auto-generated by generate_classes so do not edit manually

/** @type {import('../complex_types/meta.js')} */
let MetaSerializer;
/** @type {import('../complex_types/narrative.js')} */
let NarrativeSerializer;
/** @type {import('../simple_types/resourceContainer.js')} */
let ResourceContainerSerializer;
/** @type {import('../complex_types/extension.js')} */
let ExtensionSerializer;
/** @type {import('../complex_types/coding.js')} */
let CodingSerializer;
/** @type {import('../complex_types/period.js')} */
let PeriodSerializer;
/** @type {import('../complex_types/codeableConcept.js')} */
let CodeableConceptSerializer;
/** @type {import('../backbone_elements/auditEventAgent.js')} */
let AuditEventAgentSerializer;
/** @type {import('../backbone_elements/auditEventSource.js')} */
let AuditEventSourceSerializer;
/** @type {import('../backbone_elements/auditEventEntity.js')} */
let AuditEventEntitySerializer;

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
    if (serializerName === 'Coding' && !CodingSerializer) {
        CodingSerializer = require('../complex_types/coding.js');
        return CodingSerializer;
    }
    if (serializerName === 'Period' && !PeriodSerializer) {
        PeriodSerializer = require('../complex_types/period.js');
        return PeriodSerializer;
    }
    if (serializerName === 'CodeableConcept' && !CodeableConceptSerializer) {
        CodeableConceptSerializer = require('../complex_types/codeableConcept.js');
        return CodeableConceptSerializer;
    }
    if (serializerName === 'AuditEventAgent' && !AuditEventAgentSerializer) {
        AuditEventAgentSerializer = require('../backbone_elements/auditEventAgent.js');
        return AuditEventAgentSerializer;
    }
    if (serializerName === 'AuditEventSource' && !AuditEventSourceSerializer) {
        AuditEventSourceSerializer = require('../backbone_elements/auditEventSource.js');
        return AuditEventSourceSerializer;
    }
    if (serializerName === 'AuditEventEntity' && !AuditEventEntitySerializer) {
        AuditEventEntitySerializer = require('../backbone_elements/auditEventEntity.js');
        return AuditEventEntitySerializer;
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

class AuditEventSerializer {
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
        type: (value) => {
            initializeSerializers('Coding');
            return FhirResourceSerializer.serialize(value, CodingSerializer);
        },
        subtype: (value) => {
            initializeSerializers('Coding');
            return FhirResourceSerializer.serializeArray(value, CodingSerializer);
        },
        action: null,
        period: (value) => {
            initializeSerializers('Period');
            return FhirResourceSerializer.serialize(value, PeriodSerializer);
        },
        recorded: null,
        outcome: null,
        outcomeDesc: null,
        purposeOfEvent: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serializeArray(value, CodeableConceptSerializer);
        },
        agent: (value) => {
            initializeSerializers('AuditEventAgent');
            return FhirResourceSerializer.serializeArray(value, AuditEventAgentSerializer);
        },
        source: (value) => {
            initializeSerializers('AuditEventSource');
            return FhirResourceSerializer.serialize(value, AuditEventSourceSerializer);
        },
        entity: (value) => {
            initializeSerializers('AuditEventEntity');
            return FhirResourceSerializer.serializeArray(value, AuditEventEntitySerializer);
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
            return rawJson.map(item => AuditEventSerializer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        Object.keys(rawJson).forEach(propertyName => {
            const value = rawJson[propertyName];

            if (value === null || value === undefined) {
                delete rawJson[propertyName];
                return;
            }

            if (propertyName in AuditEventSerializer.propertyToSerializerMap) {
                if (AuditEventSerializer.propertyToSerializerMap[propertyName]) {
                    const serializedValue = AuditEventSerializer.propertyToSerializerMap[propertyName](value);
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

module.exports = AuditEventSerializer;
