/**
 * This function removes any fields which has a _ prefix recursively in an object.
 * @param {object} obj
 */
function removeUnderscoreProps(obj) {
  if (obj && typeof obj === 'object') {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (key.startsWith('_')) {
          delete obj[key];
        } else {
          removeUnderscoreProps(obj[key]);
        }
      }
    }
  }
}

module.exports = {
    removeUnderscoreProps
};
