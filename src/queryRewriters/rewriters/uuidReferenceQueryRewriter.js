const {QueryRewriter} = require('./queryRewriter');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {R4ArgsParser} = require('../../operations/query/r4ArgsParser');
const {UuidToIdReplacer} = require('../../utils/uuidToIdReplacer');
const {ConfigManager} = require('../../utils/configManager');
const {isUuid} = require('../../utils/uid.util');

class UuidReferenceQueryRewriter extends QueryRewriter {
    /**
     * constructor
     * @param {UuidToIdReplacer} uuidToIdReplacer
     * @param {R4ArgsParser} r4ArgsParser
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            uuidToIdReplacer,
            r4ArgsParser,
            configManager
        }
    ) {
        super();

        /**
         * @type {UuidToIdReplacer}
         */
        this.uuidToIdReplacer = uuidToIdReplacer;
        assertTypeEquals(uuidToIdReplacer, UuidToIdReplacer);

        /**
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * rewrites the args
     * @param {string} base_version
     * @param {ParsedArgsItem[]} args
     * @param {string} resourceType
     * @return {Promise<ParsedArgsItem[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, parsedArgs, resourceType}) {
        if (!this.configManager.enableGlobalIdSupport) {
            return parsedArgs;
        }
        assertIsValid(resourceType);
        assertIsValid(base_version);

        for (const /** @type {ParsedArgsItem} */ parsedArg of parsedArgs) {
            if (parsedArg.references) {
                for (const /** @type {ParsedReferenceItem} */ reference of parsedArg.references) {
                    if (isUuid(reference.id)) {
                        /**
                         * @type {{id: string, securityTagStructure: SecurityTagStructure}|null}
                         */
                        const result = await this.uuidToIdReplacer.getIdAndSourceAssigningAuthorityForUuidAsync({
                            resourceType,
                            uuid: reference.id
                        });
                        if (result) {
                            reference.id = `${result.id}|${result.securityTagStructure.sourceAssigningAuthority}`;
                        }
                    }
                }
            }
        }

        return parsedArgs;
    }
}

module.exports = {
    UuidReferenceQueryRewriter
};
