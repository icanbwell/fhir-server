/**
 * @typedef {Object} SensitiveValueSetExpansion
 * @property {string} id Id of the value set expansion
 * @property {string} url Canonical URL of the value set expansion
 * @property {string} category Category of the value set expansion
 * @property {Map<string, Set<String>>} codes
 * @property {Date | undefined | null} lastUpdated Date when the value set expansion was last updated
*/

/**
 * @typedef {Object} SensitiveTaggingOptions
 * @property {boolean | undefined} [overwriteExistingTags] Whether to overwrite existing sensitive data tags on the resource
 * @property {boolean | undefined} [preserveManualOverrides] Whether to preserve manually added sensitive data tags on the resource
 */
