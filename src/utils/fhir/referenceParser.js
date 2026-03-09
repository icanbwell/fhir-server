/**
 * Utility class for parsing and validating FHIR references
 *
 * Supports multiple FHIR reference formats:
 * - Absolute URLs: "https://example.com/fhir/Patient/123"
 * - Relative references: "Patient/123"
 * - URN format: "urn:uuid:53fefa32-fcbb-4ff8-8a92-55ee120877b7"
 */
class FhirReferenceParser {
    /**
     * Extracts entity type from FHIR reference
     *
     * @param {string} reference - FHIR reference string
     * @returns {string} Entity type (e.g., "Patient", "Practitioner", "uuid") or 'unknown'
     *
     * @example
     * FhirReferenceParser.extractEntityType("Patient/123")
     * // Returns: "Patient"
     *
     * @example
     * FhirReferenceParser.extractEntityType("https://example.com/fhir/Patient/123")
     * // Returns: "Patient"
     *
     * @example
     * FhirReferenceParser.extractEntityType("urn:uuid:53fefa32-fcbb-4ff8-8a92-55ee120877b7")
     * // Returns: "uuid"
     */
    static extractEntityType(reference) {
        if (!reference || typeof reference !== 'string') {
            return 'unknown';
        }

        // URN format: urn:uuid:xxx or urn:oid:xxx
        if (reference.startsWith('urn:')) {
            const parts = reference.split(':');
            return parts.length > 1 ? parts[1] : 'unknown';
        }

        // Absolute or relative reference: extract resource type before ID
        // Pattern: [http://...]/ResourceType/id or ResourceType/id
        const parts = reference.split('/');

        // Find the resource type (should be second-to-last element in path)
        // Walk backwards to skip trailing empty parts and IDs
        for (let i = parts.length - 2; i >= 0; i--) {
            const part = parts[i];
            // Skip empty parts, 'fhir' path segments, and numeric IDs
            if (part && part !== 'fhir' && !/^\d+$/.test(part)) {
                return part;
            }
        }

        return 'unknown';
    }

    /**
     * Validates FHIR reference format
     *
     * A valid reference must:
     * - Be a non-empty string
     * - Contain at least one '/' (for relative/absolute) OR start with 'urn:' (for URN format)
     *
     * @param {string} reference - FHIR reference to validate
     * @returns {boolean} True if reference format is valid
     *
     * @example
     * FhirReferenceParser.isValid("Patient/123") // true
     * FhirReferenceParser.isValid("urn:uuid:...") // true
     * FhirReferenceParser.isValid("InvalidFormat") // false
     * FhirReferenceParser.isValid("") // false
     */
    static isValid(reference) {
        if (!reference || typeof reference !== 'string') {
            return false;
        }

        // Must have at least one '/' or be a URN
        return reference.includes('/') || reference.startsWith('urn:');
    }

    /**
     * Extracts the ID portion from a FHIR reference
     *
     * @param {string} reference - FHIR reference string
     * @returns {string|null} The ID portion or null if cannot extract
     *
     * @example
     * FhirReferenceParser.extractId("Patient/123") // "123"
     * FhirReferenceParser.extractId("https://example.com/fhir/Patient/123") // "123"
     * FhirReferenceParser.extractId("urn:uuid:53fefa32-fcbb-4ff8-8a92-55ee120877b7") // "53fefa32-fcbb-4ff8-8a92-55ee120877b7"
     */
    static extractId(reference) {
        if (!reference || typeof reference !== 'string') {
            return null;
        }

        // URN format: return everything after last ':'
        if (reference.startsWith('urn:')) {
            const parts = reference.split(':');
            return parts[parts.length - 1] || null;
        }

        // Absolute or relative: return last path segment
        const parts = reference.split('/');
        const lastPart = parts[parts.length - 1];
        return lastPart || null;
    }
}

module.exports = { FhirReferenceParser };
