const deepcopy = require('deepcopy');

/**
 * Merges meta tags from two FHIR bundles according to specific rules
 * @param {Object} bundle1 - First FHIR bundle
 * @param {Object} bundle2 - Second FHIR bundle
 * @returns {Object} - Merged bundle with combined meta tags
 */
function mergeBundleMetaTags(bundle1, bundle2) {
    if (!bundle1 && !bundle2) {
        return null;
    }

    if (!bundle1) return bundle2;
    if (!bundle2) return bundle1;

    const mergedBundle = deepcopy(bundle1) || {};

    const tags1 = bundle1?.meta?.tag || [];
    const tags2 = bundle2?.meta?.tag || [];

    const tagsBySystem = new Map();

    tags1.forEach(tag => {
        if (tag.system) {
            tagsBySystem.set(tag.system, { ...tag, source: 1 });
        }
    });

    tags2.forEach(tag => {
        if (tag.system) {
            const existing = tagsBySystem.get(tag.system);
            if (existing) {
                tagsBySystem.set(tag.system, mergeTag(existing, tag, tag.system));
            } else {
                tagsBySystem.set(tag.system, { ...tag, source: 2 });
            }
        }
    });

    mergedBundle.meta = mergedBundle.meta || {};
    mergedBundle.meta.tag = Array.from(tagsBySystem.values()).map(tag => {
        const { source, ...cleanTag } = tag;
        return cleanTag;
    });

    return mergedBundle;
}

/**
 * Merges individual tag based on system type
 * @param {Object} tag1 - Tag from first bundle
 * @param {Object} tag2 - Tag from second bundle
 * @param {string} system - Tag system identifier
 * @returns {Object} - Merged tag
 */
function mergeTag(tag1, tag2, system) {
    if (system.includes('query') && !system.includes('queryCollection') &&
        !system.includes('queryOptions') && !system.includes('queryFields') &&
        !system.includes('queryTime') && !system.includes('queryOptimization') &&
        !system.includes('queryExplain')) {
        return mergeQueryTag(tag1, tag2);
    }

    if (system.includes('queryCollection')) {
        return mergeQueryCollectionTag(tag1, tag2);
    }

    if (system.includes('queryOptions') || system.includes('queryFields') ||
        system.includes('queryOptimization')) {
        return tag1;
    }

    if (system.includes('queryTime')) {
        return mergeQueryTimeTag(tag1, tag2);
    }

    if (system.includes('queryExplain') && !system.includes('queryExplainSimple')) {
        return mergeQueryExplainTag(tag1, tag2);
    }

    if (system.includes('queryExplainSimple')) {
        return mergeQueryExplainTag(tag1, tag2);
    }

    return tag1;
}

/**
 * Merges query tags with " | " separator
 */
function mergeQueryTag(tag1, tag2) {
    const display1 = tag1.display || '';
    const display2 = tag2.display || '';

    if (!display1) return tag2;
    if (!display2) return tag1;

    return {
        ...tag1,
        display: `${display1} | ${display2}`
    };
}

/**
 * Merges queryCollection tags with "|" separator (no space)
 */
function mergeQueryCollectionTag(tag1, tag2) {
    const code1 = tag1.code || '';
    const code2 = tag2.code || '';

    if (!code1) return tag2;
    if (!code2) return tag1;

    return {
        ...tag1,
        code: `${code1}|${code2}`
    };
}

/**
 * Merges queryTime tags by adding numeric values
 */
function mergeQueryTimeTag(tag1, tag2) {
    const display1 = tag1.display || '0';
    const display2 = tag2.display || '0';

    const time1 = parseFloat(display1) || 0;
    const time2 = parseFloat(display2) || 0;
    const totalTime = time1 + time2;

    return {
        ...tag1,
        display: totalTime.toString()
    };
}

/**
 * Merges queryExplain tags by combining arrays
 */
function mergeQueryExplainTag(tag1, tag2) {
    const display1 = tag1.display || '';
    const display2 = tag2.display || '';

    if (!display1) return tag2;
    if (!display2) return tag1;

    try {
        const array1 = JSON.parse(display1);
        const array2 = JSON.parse(display2);

        if (Array.isArray(array1) && Array.isArray(array2)) {
            const merged = [...array1, ...array2];
            return {
                ...tag1,
                display: JSON.stringify(merged)
            };
        }
    } catch (e) {
        return tag1;
    }

    return tag1;
}

module.exports = {
    mergeBundleMetaTags
};
