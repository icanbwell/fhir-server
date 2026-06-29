const Ajv = require('ajv');
const draft06MetaSchema = require('ajv/lib/refs/json-schema-draft-06.json');
const generatedSchema = require('../fhir/fhir-generated.schema.json');

/**
 * @classdesc Validates FHIR resources against the generated FHIR JSON schema.
 */
class FhirSchemaValidator {
    /**
     * @param {Object} schema - the generated FHIR JSON schema (with `definitions`)
     * @param {Object} [ajvSettings] - AJV options
     */
    constructor (schema, ajvSettings) {
        /**
         * @type {Object}
         */
        this.schema = schema;
        /**
         * @type {import('ajv').Ajv}
         */
        this.ajv = new Ajv(ajvSettings || { allErrors: true, logger: false });
        // The FHIR schema is draft-06; the meta-schema must be registered explicitly.
        this.ajv.addMetaSchema(draft06MetaSchema);
        /**
         * Stable key the full schema is registered under so per-type validators can
         * `$ref` into it.
         * @type {string}
         */
        this.schemaKey = 'fhirGeneratedSchema';
        // Register the complete schema once. AJV compiles each referenced `definition`
        // lazily and caches it on this instance, so shared data types (CodeableConcept,
        // Reference, etc.) are compiled a single time and reused by every per-type
        // validator -- instead of re-embedding the entire `definitions` block in each
        // compile, which recompiled those shared types once per resourceType.
        this.ajv.addSchema(this.schema, this.schemaKey);
        /**
         * resourceType -> compiled validate function (or null if the type is unknown)
         * @type {Map<string, (Function|null)>}
         */
        this.validatorsByResourceType = new Map();
    }

    /**
     * Returns the compiled validator for a resourceType, compiling and caching it on
     * first use. Returns null if the schema has no definition for the type.
     * @param {string} resourceType
     * @returns {Function|null}
     */
    getValidatorForResourceType (resourceType) {
        if (this.validatorsByResourceType.has(resourceType)) {
            return this.validatorsByResourceType.get(resourceType);
        }
        let validator = null;
        if (resourceType && this.schema.definitions[resourceType]) {
            validator = this.ajv.compile({
                $schema: this.schema.$schema,
                oneOf: [{ $ref: `${this.schemaKey}#/definitions/${resourceType}` }]
            });
        }
        this.validatorsByResourceType.set(resourceType, validator);
        return validator;
    }

    /**
     * Validates a resource and returns an array of errors (empty if valid).
     * @param {Object} resource
     * @returns {Array} AJV-style error objects (or [] when valid)
     */
    validate (resource) {
        const resourceType = resource && resource.resourceType;
        const validator = this.getValidatorForResourceType(resourceType);
        if (!validator) {
            return [{
                keyword: 'resourceType',
                dataPath: '',
                params: {},
                message: `Invalid resourceType '${resourceType}'`
            }];
        }
        // AJV stores errors on the function; read synchronously right after the call.
        return validator(resource) ? [] : validator.errors;
    }

    /**
     * Returns every resourceType the schema knows about, derived from the umbrella
     * `oneOf` (one `{ $ref: '#/definitions/<ResourceType>' }` branch per type).
     * @returns {string[]}
     */
    getAllResourceTypes () {
        return (this.schema.oneOf || [])
            .map((branch) => branch.$ref && branch.$ref.replace('#/definitions/', ''))
            .filter(Boolean);
    }

    /**
     * Pre-compiles validators for every resourceType in the schema so the first request
     * does not pay the per-type compile cost. Safe to call at startup, off the request path.
     * @returns {number} count of types compiled
     */
    preWarm () {
        let warmed = 0;
        for (const resourceType of this.getAllResourceTypes()) {
            if (this.getValidatorForResourceType(resourceType)) {
                warmed++;
            }
        }
        return warmed;
    }
}

/**
 * Default AJV settings: collect all errors (not just the first one) so callers can
 * surface a complete picture of what is invalid.
 */
const defaultAjvSettings = {
    allErrors: true,
    logger: {
        log: function log () {
            // ok to not specify
        },
        warn: function warn () {
            // ok to not specify
        },
        error: console.error.bind(console)
    }
};

/**
 * Shared singleton initialized with the generated FHIR schema. Per-type validators are
 * compiled at startup to keep request latency low
 * @type {FhirSchemaValidator}
 */
const fhirSchemaValidator = new FhirSchemaValidator(generatedSchema, defaultAjvSettings);

module.exports = { FhirSchemaValidator, fhirSchemaValidator };
