const path = require("path");
const SWIPL = require("./swipl/swipl");

// Wraps swipl.js built by Emscripten to provide location for
// the .data file.

module.exports = (options) => {
  return SWIPL({
    locateFile: (url, prefix) => {
      if (url === "swipl-web.data") {
        return path.join(__dirname, "swipl", "swipl-web.data");
      }
      return prefix + url;
    },
    ...options,
  });
};
