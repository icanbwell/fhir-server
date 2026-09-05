const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');

/**
 * Name of the MongoDB Atlas Search index person-matching-service maintains on
 * Patient_4_0_0 / Person_4_0_0 / Practitioner_4_0_0. Not owned by this repo.
 * See docs/adr/0003-atlas-search-for-patient-person-practitioner-lookup.md
 */
const ATLAS_SEARCH_INDEX_NAME = 'hybrid-full-text-search';

const ATLAS_SEARCH_ELIGIBLE_RESOURCE_TYPES = ['Patient', 'Person', 'Practitioner'];

/** FHIR search parameter code -> Atlas Search field path, for fuzzy/prefix name matching */
const ATLAS_NAME_FIELDS = {
    family: 'name.family',
    given: 'name.given'
};

/** FHIR search parameter code -> Atlas Search field path, for exact token matching */
const ATLAS_TOKEN_FIELDS = {
    identifier: 'identifier.value',
    gender: 'gender'
};

/** FHIR search parameter codes handled as telecom lookups */
const ATLAS_TELECOM_PARAMS = ['telecom', 'email', 'phone'];

const ATLAS_DATE_FIELDS = {
    birthdate: 'birthDate'
};

/**
 * System/pagination search parameter codes that don't contribute to the Mongo filter and may
 * freely coexist with the Atlas Search path.
 */
const ATLAS_SEARCH_IGNORABLE_PARAMS = [
    '_sort', '_count', '_getpagesoffset', '_elements', '_total',
    '_cursorBatchSize', '_bundle', '_format', '_includeHidden',
    '_isGraphQLRequest', '_explain', '_debug', '_streamResponse'
];

/** Full-precision, no-comparator-prefix ISO date -- the only birthdate shape v1 supports */
const EXACT_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

class AtlasSearchQueryBuilder {
    /**
     * @param {ConfigManager} configManager
     */
    constructor ({ configManager }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Returns the list of parsedArgItems that are representable in the Atlas Search index for
     * this resourceType, or null if the request should fall back to the standard query path --
     * either because the feature is disabled, or because some supplied search parameter (or
     * modifier) has no equivalent in the index. Never drops a filter condition silently: any
     * parameter not explicitly recognized disqualifies the whole request.
     * @param {string} resourceType
     * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
     * @returns {import('../query/parsedArgsItem').ParsedArgsItem[]|null}
     */
    getEligibleParsedArgItemsOrNull ({ resourceType, parsedArgs }) {
        if (!ATLAS_SEARCH_ELIGIBLE_RESOURCE_TYPES.includes(resourceType)) {
            return null;
        }
        if (!this.configManager.isAtlasSearchEnabled(resourceType)) {
            return null;
        }

        const eligibleItems = [];
        for (const parsedArg of parsedArgs.parsedArgItems) {
            const code = parsedArg.queryParameter;

            if (ATLAS_SEARCH_IGNORABLE_PARAMS.includes(code)) {
                continue;
            }

            const isNameField = Object.hasOwn(ATLAS_NAME_FIELDS, code);
            const isTokenField = Object.hasOwn(ATLAS_TOKEN_FIELDS, code);
            const isTelecomParam = ATLAS_TELECOM_PARAMS.includes(code);
            const isDateField = Object.hasOwn(ATLAS_DATE_FIELDS, code);

            if (!isNameField && !isTokenField && !isTelecomParam && !isDateField) {
                // Any other parameter (_id, bare name, phonetic, address*, etc.) has no
                // representation in the Atlas index -- fall back rather than drop it.
                return null;
            }

            if (parsedArg.modifiers && parsedArg.modifiers.length > 0) {
                // v1 does not translate modifiers (:exact, :contains, :missing, :not, ...)
                return null;
            }

            const values = parsedArg.queryParameterValue && parsedArg.queryParameterValue.values;
            if (!values || values.length === 0) {
                continue;
            }

            if ((isTokenField || isTelecomParam) && values.some(v => v.includes('|'))) {
                // v1 only supports plain-value token search (no system|value form) for
                // identifier, gender, telecom, email, and phone -- the index maps these as
                // bare-value fields, so a system-qualified value would silently mismatch.
                // identifier.value is mapped for all three resource types (Patient, Person,
                // and Practitioner); Practitioner additionally maps identifier.system
                // (for NPI-boost) and meta.security (for owner scoping).
                return null;
            }

            if (isDateField && !values.every(v => EXACT_DATE_REGEX.test(v))) {
                // v1 only supports a full-precision exact date -- no comparator prefixes
                // (ge/le/...) and no partial precision (YYYY, YYYY-MM), since the index maps
                // birthDate as an exact token, not a range-queryable date.
                return null;
            }

            eligibleItems.push(parsedArg);
        }

        return eligibleItems.length > 0 ? eligibleItems : null;
    }
}

module.exports = {
    AtlasSearchQueryBuilder,
    ATLAS_SEARCH_INDEX_NAME
};
