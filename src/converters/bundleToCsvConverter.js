const {BaseBundleConverter} = require("./baseBundleConverter");
const {FHIRBundleConverter} = require("@imranq2/fhir-to-csv/lib/converters/fhir_bundle_converter");

class BundleToCsvConverter extends BaseBundleConverter {
    /**
     * convert
     * @param {Bundle} bundle
     * @return {Promise<Buffer>}
     */
    async convert({bundle}) {
        if (!bundle) {
            throw new Error("Bundle is not set");
        }

        /**
         * @type {FHIRBundleConverter}
         */
        const converter = new FHIRBundleConverter();
        const extractedData = await converter.convertToDictionaries(bundle);
        /**
         * @type {Buffer<ArrayBufferLike>}
         */
        const excelBuffer = await converter.convertToExcel(
            extractedData
        );
        return excelBuffer;
    }
}

module.exports = {
    BundleToCsvConverter
};
