// Field-level pagination for Composition.section per the FHIR GraphQL spec
// (_offset / _count on a repeating element: https://build.fhir.org/graphql.html#searching).
// Lets callers fetch a single page of sections instead of the whole Composition.
// Merged into the generated Composition resolver via mergeResolvers; the generated
// resolver only defines __resolveReference, so this is purely additive.
module.exports = {
    Composition: {
        /**
         * @param {Object|null} parent - the Composition resource
         * @param {{_offset: (number|undefined), _count: (number|undefined)}} args
         * @return {Object[]|undefined}
         */
        section: (parent, args) => {
            const sections = parent ? parent.section : undefined;
            if (!Array.isArray(sections)) {
                return sections;
            }
            const { _offset, _count } = args || {};
            // No paging args -> return the full list (backwards compatible).
            if (_offset == null && _count == null) {
                return sections;
            }
            const start = _offset > 0 ? _offset : 0;
            const end = _count != null ? start + _count : undefined;
            return sections.slice(start, end);
        }
    }
};
