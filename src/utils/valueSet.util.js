const async = require('async');
/**
 * This file implements helpers for expanding value sets
 */

const getContentsOfValueSet = async (collection1, valueSetUrl) => {
    const valueSet = await collection1.findOne({url: valueSetUrl.toString()});
    return await module.exports.getValueSet(valueSet);
};

const createConcept = async (system, version, code, display) => {
    return {
        system: system,
        version: system + '/' + version,
        code: code,
        display: display
    };
};

const getInclude = async (collection1, include) => {
    let concepts = [];
    // include can either be a system, concept[] or a valueSet url
    if (include.valueSet) {
        concepts = concepts.concat(
            await async.flatMap(include.valueSet,
                async valueSet => await getContentsOfValueSet(collection1, valueSet)
            )
        );
    }
    if (include.system) {
        const system = include.system;
        const version = include.version;
        // get all the concepts
        concepts.concat(
            await async.map(include.concept,
                async concept => await createConcept(system, version, concept.code, concept.display)
            )
        );
    }
    return concepts;
};

const getValueSet = async (collection1, resource1) => {
    if (resource1.compose && resource1.compose.include) {
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
