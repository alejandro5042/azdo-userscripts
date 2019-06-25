module.exports = {
  "root": true,
  "env": {
    "browser": true,
    "es6": true,
    "greasemonkey": true,
    "jquery": true
  },
  "extends": "airbnb",
  "globals": {
    "Atomics": "readonly",
    "SharedArrayBuffer": "readonly",
    "lscache": "readonly",
    "dateFns": "readonly",
    "_": "readonly"
  },
  "parserOptions": {
    "ecmaVersion": 2018
  },
  "rules": {
    // Tech debt. Remove or reconsider one day:
    "no-unused-vars": ["error", { "args": "none" }],
    "func-names": 0,
    "no-use-before-define": ["error", "nofunc"],
    "max-len": 0,
    "no-restricted-syntax": ["error", "ForInStatement", "LabeledStatement", "WithStatement"]
  }
};
