module.exports = {
    "root": true,
    "env": {
        "browser": true,
        "es6": true,
        "greasemonkey": true,
        "jquery": true
    },
    "extends": "eslint:recommended",
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
        "no-unused-vars": ["error", { "args": "none" }],
        "prefer-const": 2
    }
};
