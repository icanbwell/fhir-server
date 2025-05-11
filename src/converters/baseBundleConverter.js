class BaseBundleConverter{
    /**
     * convert
     * @param {Bundle} bundle
     * @return {Promise<Buffer>}
     */
    convert({bundle}) {
        throw new Error("convert method not implemented");
    }
}

module.exports = {
    BaseBundleConverter
};
