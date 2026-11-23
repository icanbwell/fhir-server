const async = require('async');

/**
 * Resolves on the next turn of the event loop, so pending I/O, timers and other requests can run.
 * @returns {Promise<void>}
 */
function yieldToEventLoopAsync () {
    return new Promise((resolve) => setImmediate(resolve));
}

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
            await yieldToEventLoopAsync();
        }
    }
}

/**
 * Runs `func` on the items one at a time in order, each after the previous one has finished, and
 * yields to the event loop after every `chunkSize` items. Rejects if `func` rejects, without
 * running the later items, so a caller that wants per-item failures must catch inside `func`.
 * @param {Object[]} items
 * @param {number} chunkSize
 * @param {function(Object): Promise<void>} func
 * @returns {Promise<void>}
 */
async function runInOrderInChunks ({ items, chunkSize, func }) {
    for (let i = 0; i < items.length; i += chunkSize) {
        for (const item of items.slice(i, i + chunkSize)) {
            await func(item);
        }
        if (i + chunkSize < items.length) {
            await yieldToEventLoopAsync();
        }
    }
}

module.exports = {
    runInChunks,
    runInOrderInChunks
};
