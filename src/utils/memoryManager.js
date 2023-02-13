class MemoryManager {
    /**
     * @param {number} bytes
     * @param {number} decimals
     * @returns {string}
     */
    formatBytes(bytes, decimals = 2) {
        if (!bytes) {
            return '0 Bytes';
        }

        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const size = sizes[`${i}`];

        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${size}`;
    }
}

module.exports = {
    MemoryManager
};
