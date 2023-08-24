const {QueryRewriter} = require('./queryRewriter');
const {assertTypeEquals} = require('../../utils/assertType');
const {ChatGPTManager} = require('../../chatgpt/managers/chatgptManager');
const {R4ArgsParser} = require('../../operations/query/r4ArgsParser');
const {ConfigManager} = require('../../utils/configManager');
const {VectorStoreFilter} = require('../../chatgpt/vectorStores/vectorStoreFilter');
const {VectorStoreFactory} = require('../../chatgpt/vectorStores/vectorStoreFactory');

/**
 * @classdesc if _question is present in parameter then this rewrites the query using ChatGPT
 */
class ChatGPTQueryRewriter extends QueryRewriter {
    /**
     * constructor
     * @param {ChatGPTManager} chatgptManager
     * @param {R4ArgsParser} r4ArgsParser
     * @param {ConfigManager} configManager
     * @param {VectorStoreFactory} vectorStoreFactory
     */
    constructor(
        {
            chatgptManager,
            r4ArgsParser,
            configManager,
            vectorStoreFactory
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
         * @type {VectorStoreFactory}
         */
        this.vectorStoreFactory = vectorStoreFactory;
        assertTypeEquals(vectorStoreFactory, VectorStoreFactory);
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
                            base_version: base_version,
                            parsedArgsOriginal: parsedArgs
                        }
                    );
                case 'fullTextSearch':
                    return await this.getParsedArgsForFullTextSearchAsync(
                        {
                            _question: _question,
                            _debug: _debug,
                            resourceType: resourceType,
                            parsedArgsOriginal: parsedArgs
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
     * @param {ParsedArgs} parsedArgsOriginal
     * @param {boolean|undefined} _debug
     * @param {string} resourceType
     * @param {string} base_version
     * @return {Promise<ParsedArgs>}
     */
    async getParsedArgsForFhirQueryAsync({_question, parsedArgsOriginal, _debug, resourceType, base_version}) {
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
         * @type {Object}
         */
        const args = parsedArgsOriginal.getRawArgs();
        delete args._question; // we already handled the question
        for (const [key, value] of url.searchParams) {
            args[`${key}`] = value;
        }
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = this.r4ArgsParser.parseArgs({resourceType, args});
        return parsedArgs;
    }

    /**
     * Gets new parsed args from question
     * @param {string} _question
     * @param {ParsedArgs} parsedArgsOriginal
     * @param {boolean|undefined} _debug
     * @param {string} resourceType
     * @return {Promise<ParsedArgs>}
     */
    async getParsedArgsForFullTextSearchAsync({_question, parsedArgsOriginal, _debug, resourceType}) {
        /**
         * @type {BaseVectorStoreManager|undefined}
         */
        const vectorStoreManager = await this.vectorStoreFactory.createVectorStoreAsync();
        if (!vectorStoreManager) {
            return parsedArgsOriginal;
        }
        /**
         * @type {ChatGPTDocument[]}
         */
        const documents = await vectorStoreManager.searchAsync(
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
        /**
         * @type {Object}
         */
        const args = parsedArgsOriginal.getRawArgs();
        delete args._question; // we already handled the question
        args['id'] = `${uuids.join(',')}`;
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = this.r4ArgsParser.parseArgs({resourceType, args});
        return parsedArgs;

    }
}

module.exports = {
    ChatGPTQueryRewriter
};
