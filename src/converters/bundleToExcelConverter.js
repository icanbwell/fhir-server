const {BaseBundleConverter} = require("./baseBundleConverter");
const {FHIRBundleConverter} = require("@imranq2/fhir-to-csv/lib/fhir_bundle_converter");

class BundleToExcelConverter extends BaseBundleConverter {
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
        const extractedData = converter.convertToDictionaries(bundle);
        /**
         * @type {Buffer<ArrayBufferLike>}
         */
        const excelBuffer = converter.convertToExcel(
            extractedData
        );
        return excelBuffer;
    }
}

module.exports = {
    BundleToExcelConverter
};
