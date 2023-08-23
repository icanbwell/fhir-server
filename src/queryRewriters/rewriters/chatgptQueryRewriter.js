const {QueryRewriter} = require('./queryRewriter');
const {assertTypeEquals} = require('../../utils/assertType');
const {ChatGPTManager} = require('../../chatgpt/managers/chatgptManager');
const {R4ArgsParser} = require('../../operations/query/r4ArgsParser');
const {ConfigManager} = require('../../utils/configManager');
const {BaseVectorStoreManager} = require('../../chatgpt/vectorStores/baseVectorStoreManager');
const {VectorStoreFilter} = require('../../chatgpt/vectorStores/vectorStoreFilter');

/**
 * @classdesc if _question is present in parameter then this rewrites the query using ChatGPT
 */
class ChatGPTQueryRewriter extends QueryRewriter {
    /**
     * constructor
     * @param {ChatGPTManager} chatgptManager
     * @param {R4ArgsParser} r4ArgsParser
     * @param {ConfigManager} configManager
     * @param {BaseVectorStoreManager} vectorStoreManager
     */
    constructor(
        {
            chatgptManager,
            r4ArgsParser,
            configManager,
            vectorStoreManager
        }
    ) {
        super();

        /**
         * @type {ChatGPTManager}
         */
        this.chatgptManager = chatgptManager;
        assertTypeEquals(chatgptManager, ChatGPTManager);

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

        /**
         * @type {BaseVectorStoreManager}
         */
        this.vectorStoreManager = vectorStoreManager;
        assertTypeEquals(vectorStoreManager, BaseVectorStoreManager);
    }

    /**
     * rewrites the args
     * @param {string} base_version
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @return {Promise<ParsedArgs>}
     */
    async rewriteArgsAsync({base_version, parsedArgs, resourceType}) {
        const {_question, _debug} = parsedArgs;
        if (_question && this.configManager.enableChatGptRewriter) {
            /**
             * @type {ChatGPTQuestionCategory}
             */
            const questionCategory = await this.chatgptManager.classifyQuestionAsync(
                {
                    question: _question,
                    verbose: _debug
                }
            );
            switch (questionCategory) {
                case 'fhirQuery':
                    return await this.getParsedArgsForFhirQueryAsync(
                        {
                            _question: _question,
                            _debug: _debug,
                            resourceType: resourceType,
                            base_version: base_version
                        }
                    );
                case 'fullTextSearch':
                    return await this.getParsedArgsForFullTextSearchAsync(
                        {
                            _question: _question,
                            _debug: _debug,
                            resourceType: resourceType,
                        }
                    );
                default:
                    return super.rewriteArgsAsync({base_version, parsedArgs, resourceType});
            }
        } else {
            return super.rewriteArgsAsync({base_version, parsedArgs, resourceType});
        }
    }

    /**
     * Gets new parsed args from question
     * @param {string} _question
     * @param {boolean|undefined} _debug
     * @param {string} resourceType
     * @param {string} base_version
     * @return {Promise<ParsedArgs>}
     */
    async getParsedArgsForFhirQueryAsync({_question, _debug, resourceType, base_version}) {
        const result = await this.chatgptManager.getFhirQueryAsync(
            {
                question: _question,
                baseUrl: `https://fhir.icanbwell.com/${base_version}`,
                verbose: _debug
            }
        );
        // parse url into query string parameters
        const url = new URL(result);
        /**
         * ≈
         * @type {string[]}
         */
        const args = Array.from(url.searchParams.values());
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = this.r4ArgsParser.parseArgs({resourceType, args});
        // see if any query rewriters want to rewrite the args
        return parsedArgs;
    }

    /**
     * Gets new parsed args from question
     * @param {string} _question
     * @param {boolean|undefined} _debug
     * @param {string} resourceType
     * @return {Promise<ParsedArgs>}
     */
    async getParsedArgsForFullTextSearchAsync({_question, _debug, resourceType}) {
        /**
         * @type {ChatGPTDocument[]}
         */
        const documents = await this.vectorStoreManager.searchAsync(
            {
                filter: new VectorStoreFilter({
                    resourceType: resourceType
                }),
                text: _question,
                limit: 10
            }
        );
        // get the ids out
        const uuids = documents.map(doc => doc.metadata.uuid);
        const args = `id=${uuids.join(',')}`;
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = this.r4ArgsParser.parseArgs({resourceType, args});
        // see if any query rewriters want to rewrite the args
        return parsedArgs;

    }
}

module.exports = {
    ChatGPTQueryRewriter
};
