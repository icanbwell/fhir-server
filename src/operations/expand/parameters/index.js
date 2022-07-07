const filter = require('./filter');

const parameters = {
  filter
};

// module.exports = exports;

const applyExpansionParameters = (query, resource) => {
  Object.entries(parameters).forEach(([param, fn]) => {
    const parameter = query[param];
    if (parameter) {
      resource.expansion.contains = fn.execute(resource.expansion.contains, parameter);
    }
  });
  return resource;
};

module.exports = {
  applyExpansionParameters: applyExpansionParameters
};



