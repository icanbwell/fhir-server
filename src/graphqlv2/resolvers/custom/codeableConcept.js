module.exports = {
    CodeableConcept: {
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */

        coding: async (parent, args, context, info) => {
            // noinspection JSValidateTypes
            /**
             * @type {CodeableConcept|null}
             */
            const codeableConcept = parent;
            if (!codeableConcept) {
                return codeableConcept;
            }
            if (codeableConcept && codeableConcept.coding && args.system && Array.isArray(args.system)) {
                return codeableConcept.coding.filter(n => args.system.includes(n.system));
            }
            return codeableConcept.coding;
        }
    }
};
