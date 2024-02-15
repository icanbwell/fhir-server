'use strict';
const async = require('async');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { assertTypeEquals } = require('./assertType');

/**
 * This file implements helpers for expanding value sets
 */
class ValueSetManager {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     */
    constructor ({ databaseQueryFactory }) {
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
    }

    /**
     * gets the value sets
     * @param {string} resourceType
     * @param {string} base_version
     * @param {string} valueSetUrl
     * @return {Promise<{system, code, display, version: string}[]>}
     */
    async getContentsOfValueSetAsync (resourceType, base_version, valueSetUrl) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery(
            { resourceType, base_version }
        );
        const valueSet = await databaseQueryManager.findOneAsync({ query: { url: valueSetUrl.toString() } });
        return await this.getValueSetConceptsAsync(resourceType, base_version, valueSet);
    }

    /**
     * Creates a concept
     * @param {string} system
     * @param {string} version
     * @param {string} code
     * @param {string} display
     * @return {{system, code, display, version: string}}
     */
    createConcept (system, version, code, display) {
        return {
            system: system,
            version: version,
            code: code,
            display: display
        };
    }

    /**
     *  Gets the included concepts which can either be concepts or a nested value set
     * @param {string} resourceType
     * @param {string} base_version
     * @param {{valueSet:string[],system:string,version:string,concept:Coding[] }} include
     * @return {Promise<{system, code, display, version: string}[]>}
     */
    async getIncludeAsync (resourceType, base_version, include) {
        /**
         * @type {{system, code, display, version: string}[]}
         */
        let concepts = [];
        // include can either be a system, concept[] or a valueSet url
        if (include.valueSet) {
            concepts = await async.flatMap(include.valueSet,
                async valueSet => await this.getContentsOfValueSetAsync(
                    resourceType, base_version, valueSet)
            );
        }
        if (include.system) {
            const system = include.system;
            const version = include.version;
            // get all the concepts
            concepts = include.concept.map(
                concept => this.createConcept(system, version, concept.code, concept.display)
            );
        }
        return concepts;
    }

    /**
     * Gets the concepts in this value set.  Recurses down into any nested value sets
     * @param {string} resourceType
     * @param {string} base_version
     * @param {Resource} resource1
     * @return {Promise<{system, code, display, version: string}[]>}
     */
    async getValueSetConceptsAsync (resourceType, base_version, resource1) {
        /**
         * @type {{system, code, display, version: string}[]}
         */
        let expandedValueSets = [];
        if (resource1.compose && resource1.compose.include) {
            // noinspection UnnecessaryLocalVariableJS
            expandedValueSets = await async.flatMap(resource1.compose.include,
                async include => await this.getIncludeAsync(
                    resourceType, base_version, include)
            );
        }

        // append expanded value sets to existing value sets
        /**
         * @type {{system, code, display, version: string}[]}
         */
        const existingValueSets = (resource1.expansion && resource1.expansion.contains) ? resource1.expansion.contains : [];
        return existingValueSets.concat(expandedValueSets);
    }

    /**
     * Expands the value set as a new expansion field and removes the 'compose' field
     * @param {string} resourceType
     * @param {string} base_version
     * @param {Resource} resource1
     * @return {Resource}
     */
    async getExpandedValueSetAsync (resourceType, base_version, resource1) {
        /**
         * @type {{system, code, display, version: string}[]}
         */
        const concepts = await this.getValueSetConceptsAsync(resourceType, base_version, resource1);
        resource1['expansion'] = {
            contains: concepts,
            'offset': 0,
            'total': concepts.length
        };
        // remove compose
        delete resource1['compose'];
        return resource1;
    }
}

module.exports = {
    ValueSetManager
};
