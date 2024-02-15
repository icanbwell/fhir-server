/**
 * Currently supports profiles from http://hl7.org/fhir/R4/profilelist.html
 */
const { canonicalToOriginalUrlMap } = require('./data/profile.map');

/**
 * Maps the canonical-url to its json url.
 * Its helps in getting the profile.json data.
 */
class ProfileUrlMapper {
    constructor() {
        const mapper = canonicalToOriginalUrlMap['4_0_0'];
        const urls = Object.create({});

        /** @type {Set<string>} */
        this._supportedResources = new Set();

        for (const resourceName in mapper) {
            this.supportedResources.add(resourceName);
            const profiles = mapper[`${resourceName}`];
            for (const canonicalUrl in profiles) {
                Object.defineProperty(urls, canonicalUrl, {
                    enumerable: true,
                    value: profiles[`${canonicalUrl}`],
                    writable: false
                });
            }
        }

        Object.defineProperty(this, '_canonicalToOriginalMap', {
            enumerable: true,
            value: urls,
            writable: false
        });
    }

    get supportedResources() {
        return this._supportedResources;
    }

    /**
     * If found, then return the original url, else return the passed url
     * @param {string} canonicalUrl
     * @returns {string} Url
     */
    getOriginalUrl(canonicalUrl) {
        return this._canonicalToOriginalMap[`${canonicalUrl}`] ?? canonicalUrl;
    }
}

module.exports = { ProfileUrlMapper };
