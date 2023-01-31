const {QueryRewriter} = require('./queryRewriter');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {R4ArgsParser} = require('../../operations/query/r4ArgsParser');
const {UuidToIdReplacer} = require('../../utils/uuidToIdReplacer');
const {ConfigManager} = require('../../utils/configManager');
const {isUuid} = require('../../utils/uid.util');
const {ParsedReferenceItem} = require('../../operations/query/parsedArgsItem');

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
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @return {Promise<ParsedArgs>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, parsedArgs, resourceType}) {
        if (!this.configManager.enableGlobalIdSupport) {
            return parsedArgs;
        }
        assertIsValid(resourceType);
        assertIsValid(base_version);

        for (const /** @type {ParsedArgsItem} */ parsedArg of parsedArgs.parsedArgItems) {
            if (parsedArg.references) {
                for (const /** @type {ParsedReferenceItem} */ reference of parsedArg.references) {
                    if (isUuid(reference.id)) {
                        /**
                         * @type {{id: string, securityTagStructure: SecurityTagStructure}|null}
                         */
                        const result = await this.uuidToIdReplacer.getIdAndSourceAssigningAuthorityForUuidAsync({
                            resourceType: reference.resourceType,
                            uuid: reference.id
                        });
                        if (result) {
                            // add an entry to lookup by id + sourceAssigningAuthority
                            parsedArg.references.push(
                                new ParsedReferenceItem({
                                    resourceType: reference.resourceType,
                                    id: `${result.id}|${result.securityTagStructure.sourceAssigningAuthority}`
                                })
                            );
                            // also add an entry without the sourceAssigningAuthority for backward compatibility
                            parsedArg.references.push(
                                new ParsedReferenceItem({
                                    resourceType: reference.resourceType,
                                    id: result.id
                                })
                            );
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
