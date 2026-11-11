const async = require('async');

/**
 * Runs `func` on the items in chunks of `chunkSize`, the items of a chunk in parallel, and yields
 * to the event loop between chunks. Rejects if `func` rejects, so a caller that wants per-item
 * failures must catch inside `func`.
 * @param {Object[]} items
 * @param {number} chunkSize
 * @param {function(Object): Promise<void>} func
 * @returns {Promise<void>}
 */
async function runInChunks ({ items, chunkSize, func }) {
    for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        await async.mapLimit(chunk, chunkSize, func);
        if (i + chunkSize < items.length) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    }
}

module.exports = {
    runInChunks
};
