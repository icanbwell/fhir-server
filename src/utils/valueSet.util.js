const async = require('async');
/**
 * This file implements helpers for expanding value sets
 */

/**
 * gets the value sets
 * @param {import('mongodb').Collection} collection1
 * @param {string} valueSetUrl
 * @return {Promise<{system, code, display, version: string}[]>}
 */
const getContentsOfValueSet = async (collection1, valueSetUrl) => {
    const valueSet = await collection1.findOne({url: valueSetUrl.toString()});
    return await module.exports.getValueSet(collection1, valueSet);
};

/**
 * Creates a concept
 * @param {string} system
 * @param {string} version
 * @param {string} code
 * @param {string} display
 * @return {{system, code, display, version: string}}
 */
const createConcept = (system, version, code, display) => {
    return {
        system: system,
        version: system + '/' + version,
        code: code,
        display: display
    };
};

/**
 *
 * @param {import('mongodb').Collection} collection1
 * @param {*} include
 * @return {Promise<{system, code, display, version: string}[]>}
 */
const getInclude = async (collection1, include) => {
    /**
     * @type {{system, code, display, version: string}[]}
     */
    let concepts = [];
    // include can either be a system, concept[] or a valueSet url
    if (include.valueSet) {
        concepts = await async.flatMap(include.valueSet,
            async valueSet => await getContentsOfValueSet(collection1, valueSet)
        );
    }
    if (include.system) {
        const system = include.system;
        const version = include.version;
        // get all the concepts
        concepts = await async.map(include.concept,
                async concept => createConcept(system, version, concept.code, concept.display)
        );
    }
    return concepts;
};

/**
 *
 * @param {import('mongodb').Collection} collection1
 * @param {*} resource1
 * @return {Promise<{system, code, display, version: string}[]>}
 */
const getValueSet = async (collection1, resource1) => {
    if (resource1.compose && resource1.compose.include) {
        // noinspection UnnecessaryLocalVariableJS
        const valueSets = await async.flatMap(resource1.compose.include,
            async include => await getInclude(collection1, include)
        );
        return valueSets;
    }
    return [];
};

module.exports = {
    getValueSet
};
