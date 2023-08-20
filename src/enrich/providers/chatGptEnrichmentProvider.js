const {EnrichmentProvider} = require('./enrichmentProvider');
const {assertTypeEquals} = require('../../utils/assertType');
const {ChatGPTManager} = require('../../chatgpt/managers/chatgptManager');
const {ConfigManager} = require('../../utils/configManager');
const Extension = require('../../fhir/classes/4_0_0/complex_types/extension');
const Narrative = require('../../fhir/classes/4_0_0/complex_types/narrative');

class ChatGptEnrichmentProvider extends EnrichmentProvider {
    /**
     * constructor
     * @param {ChatGPTManager} chatgptManager
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            chatgptManager,
            configManager
        }
    ) {
        super();

        /**
         * @type {ChatGPTManager}
         */
        this.chatgptManager = chatgptManager;
        assertTypeEquals(chatgptManager, ChatGPTManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @return {Promise<Resource[]>}
     */
    async enrichAsync({resources, parsedArgs}) {
        if (!this.configManager.openAIApiKey) {
            return resources;
        }
        const {_debug, _explain, _question: question} = parsedArgs;
        if (question) {
            for (const resource of resources.filter(r => r.resourceType === 'Patient')) {
                await this.updateResourceWithAnswerAsync({resource, question, _debug, _explain});
            }
        }
        return resources;
    }

    /**
     * Updates a resource with answer to the question
     * @param {Resource} resource
     * @param {string} question
     * @param {boolean|undefined} _debug
     * @param {boolean|undefined} _explain
     * @return {Promise<void>}
     */
    async updateResourceWithAnswerAsync({resource, question, _debug, _explain}) {
        /** @type {DomainResource} */
        const domainResource = /** @type {DomainResource} */ resource;
        /**
         * @type {ChatGPTResponse}
         */
        const response = await this.chatgptManager.answerQuestionAsync(
            {
                resourceType: resource.resourceType,
                id: resource.id,
                question: question,
                outputFormat: 'html',
                verbose: _debug || _explain
            }
        );
        const html = response.responseText;
        // return as text Narrative
        /**
         * @type {Extension[]}
         */
        const extension = response.documents ?
            response.documents.map(doc =>
                new Extension(
                    {
                        url: 'http://www.icanbwell.com/relevantDocument',
                        valueString: JSON.stringify(doc)
                    }
                )
            ) : [];
        if (response.fullPrompt) {
            extension.push(
                new Extension(
                    {
                        url: 'http://www.icanbwell.com/prompt',
                        valueString: JSON.stringify(response.fullPrompt)
                    }
                )
            );
        }
        domainResource.text = new Narrative({
            status: 'generated',
            div: html
        });
        if (extension.length > 0 && (_debug || _explain)) {
            domainResource.text.extension = extension;
        }
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync({entries, parsedArgs}) {
        if (!this.configManager.openAIApiKey) {
            return entries;
        }

        const {_debug, _explain, _question: question} = parsedArgs;
        if (question) {
            for (const entry of entries.filter(e => e.resource.resourceType === 'Patient')) {
                await this.updateResourceWithAnswerAsync(
                    {
                        resource: entry.resource,
                        question,
                        _debug,
                        _explain
                    }
                );
            }
        }
        return entries;
    }
}

module.exports = {
    ChatGptEnrichmentProvider
};
