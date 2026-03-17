const { BaseFhirResourceSerializer } = require('../../../baseFhirResourceSerializer');
const { FhirResourceWriteSerializer } = require('../../../fhirResourceWriteSerializer');
const { FhirResourceNormalizeSerializer } = require('../../../fhirResourceNormalizeSerializer');
// const {FhirResourceReadSerializer} = require('../../../fhirResourceReadSerializer');

/**
 * BaseSerializer class to be used as a base for all serializers
 */
class BaseSerializer {
    // This map should be overridden by child classes to define properties with their corresponding serializers
    fhirPropertyToSerializerMap = {};

    // Combined map of FHIR properties and internal properties which are only saved in database but not part of FHIR spec.
    allPropertyToSerializerMap = {};

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
     */
    baseSerialize(serializerClass, propertyToSerializerMap, obj, context) {
        Object.entries(obj).forEach(([propertyName, value]) => {
            if (value === null || value === undefined) {
                delete obj[propertyName];
                return;
            }

            if (propertyName in propertyToSerializerMap) {
                const serializeDataFunc = propertyToSerializerMap[propertyName];
                if (serializeDataFunc) {
                    const serializeData = serializeDataFunc();
                    const serializedValue = serializerClass[serializeData.serializeFunction]({
                        obj: value,
                        SerializerClass: serializeData.serializerClass,
                        context
                    });
                    if (serializedValue === null || serializedValue === undefined) {
                        delete obj[propertyName];
                    } else if (Array.isArray(serializedValue) && serializedValue.length === 0) {
                        delete obj[propertyName];
                    } else {
                        obj[propertyName] = serializedValue;
                    }
                }
            } else {
                // remove property if not defined in the serializer map
                delete obj[propertyName];
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
        if (!obj || typeof obj !== 'object') return {};

        return this.baseSerialize(FhirResourceWriteSerializer, this.allPropertyToSerializerMap, obj, context);
    }

    /**
     * This method is used to remove any fields which are not as per FHIR Specs without verifying resource structure
     * @param {Object} obj
     * @param {Object} [context]
     * @returns {Object} Normalized object
     */
    normalize(obj, context = {}) {
        if (!obj || typeof obj !== 'object') return obj;

        return this.baseSerialize(FhirResourceNormalizeSerializer, this.fhirPropertyToSerializerMap, obj, context);
    }

    /**
     * Method to serialize object to be returned in response
     *  - it removes any fields which are not as per FHIR Specs
     *  - runs enrichment functions to add any additional fields which are required in the response but not stored in database
     * @param {any} obj
     * @returns {any} Cleaned object
     */
    readSerialize(obj, context = {}) {
        // to be implemented to migrate existing serializer
        throw new Error('Not Implemented');
    }
}

module.exports = BaseSerializer;
