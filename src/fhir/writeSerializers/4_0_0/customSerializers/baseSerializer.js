const { BaseFhirResourceSerializer } = require('../../../baseFhirResourceSerializer');
const { FhirResourceWriteSerializer } = require('../../../fhirResourceWriteSerializer');
const { FhirResourceWriteNormalizeSerializer } = require('../../../fhirResourceWriteNormalizeSerializer');
const {FhirResourceReadSerializer} = require('../../../fhirResourceReadSerializer');

/**
 * BaseSerializer class to be used as a base for all serializers
 */
class BaseSerializer {
    // This map should be overridden by child classes to define properties with their corresponding serializers
    fhirPropertyToSerializerMap = {};

    // Combined map of FHIR properties and internal properties which are only saved in database but not part of FHIR spec.
    allPropertyToSerializerMap = {};

    isEmptyFunction = (val) => {
        return val === null || val === undefined || (Array.isArray(val) && val.length === 0);
    };

    /**
     * Static property to hold configManager for all serializer instances
     * @type {import('../../../../utils/configManager').ConfigManager}
     */
    static configManager = null;

    /**
     * Sets the configManager for all serializers
     * @param {import('../../../../utils/configManager').ConfigManager} configManager
     */
    static setConfigManager(configManager) {
        BaseSerializer.configManager = configManager;
    }

    /**
     * Base serialize method that serializes an object based on the provided propertyToSerializerMap
     * @param {BaseFhirResourceSerializer} serializerClass
     * @param {Object} propertyToSerializerMap
     * @param {*} obj
     * @param {*} context
     * @param {Function} isEmpty
     */
    baseSerialize(serializerClass, propertyToSerializerMap, obj, context, isEmpty = this.isEmptyFunction) {
        Object.entries(obj).forEach(([propertyName, value]) => {
            // Remove property if not defined in the serializer map
            if (!(propertyName in propertyToSerializerMap)) {
                delete obj[propertyName];
                return;
            }

            // Remove property if value is empty
            if (isEmpty(value)) {
                delete obj[propertyName];
                return;
            }

            const serializeDataFunc = propertyToSerializerMap[propertyName];
            if (!serializeDataFunc) {
                return;
            }

            const serializeData = serializeDataFunc();
            const serializedValue = serializerClass[serializeData.serializeFunction]({
                obj: value,
                SerializerClass: serializeData.serializerClass,
                context
            });

            if (isEmpty(serializedValue)) {
                delete obj[propertyName];
            } else {
                obj[propertyName] = serializedValue;
            }
        });

        return obj;
    }

    /**
     * Method to serialize object to be written to database
     *  - it removes any fields which are not as per FHIR Specs
     *  - keeps the internal properties which are not part of FHIR spec but are required for database
     *  - runs any pre-processing functions defined in the serializer map to transform the data before saving to database
     * @param {any} obj
     * @returns {any} Cleaned object
     */
    writeSerialize(obj, context = {}) {
        // mergeTodo - update to remove empty dict
        if (!obj || typeof obj !== 'object') return {};

        return this.baseSerialize(FhirResourceWriteSerializer, this.allPropertyToSerializerMap, obj, context);
    }

    /**
     * This method is used to remove any fields which are not as per FHIR Specs and write serialize without any enrichments
     * @param {Object} obj
     * @param {Object} [context]
     * @returns {Object} Normalized object
     */
    writeNormalize(obj, context = {}) {
        if (!obj || typeof obj !== 'object') return {};

        return this.baseSerialize(FhirResourceWriteNormalizeSerializer, this.fhirPropertyToSerializerMap, obj, context);
    }

    /**
     * Method to serialize object to be returned in response
     *  - it removes any fields which are not as per FHIR Specs
     *  - runs enrichment functions to add any additional fields which are required in the response but not stored in database
     * @param {any} obj
     * @returns {any} Cleaned object
     */
    readSerialize(obj, context = {}) {
        if (!obj || typeof obj !== 'object') return obj;

        // return empty objects too for read response as we want to return empty objects if they are
        // present in the resource and not remove them as done in write serialize.
        const isEmptyFunction = (val) => {
            return false;
        };

        return this.baseSerialize(FhirResourceReadSerializer, this.fhirPropertyToSerializerMap, obj, context, isEmptyFunction);
    }
}

module.exports = BaseSerializer;
