const {BaseBundleConverter} = require("./baseBundleConverter");
const {FHIRBundleConverter} = require("@imranq2/fhir-to-csv/lib/fhir_bundle_converter");

class BundleToCsvConverter extends BaseBundleConverter {
    /**
     * convert
     * @param {Object} bundle
     * @return {Buffer}
     */
    convert({bundle}) {
        if (!bundle) {
            throw new Error("Bundle is not set");
        }

        /**
         * @type {FHIRBundleConverter}
         */
        const converter = new FHIRBundleConverter();

        const extractedData = converter.convertBundleToDictionaries(bundle);
        /**
         * @type {Buffer<ArrayBufferLike>}
         */
        const zipBuffer = converter.convertToCSVZipped(
            extractedData
        );
        return zipBuffer;
    }

    /**
     * convert
     * @param {Object[]} resources
     * @return {Buffer}
     */
    convertResources({resources}) {
        /**
         * @type {FHIRBundleConverter}
         */
        const converter = new FHIRBundleConverter();

        const extractedData = converter.convertResourcesToDictionaries(resources);
        /**
         * @type {Buffer<ArrayBufferLike>}
         */
        const zipBuffer = converter.convertToCSVZipped(
            extractedData
        );
        return zipBuffer;
    }
}

module.exports = {
    BundleToCsvConverter
};
