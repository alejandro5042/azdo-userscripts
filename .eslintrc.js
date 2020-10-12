module.exports = {
    "root": true,
    "env": {
        "browser": true,
        "es6": true,
        "greasemonkey": true,
        "jquery": true
    },
    "extends": "@ni",
    "globals": {
        "Atomics": "readonly",
        "SharedArrayBuffer": "readonly",
        "lscache": "readonly",
        "dateFns": "readonly",
        "eus": "readonly",
        "_": "readonly",
        "hljs": "readonly",
        "jsyaml": "readonly"
    },
    "parserOptions": {
        "ecmaVersion": 2018,
        "sourceType": "script"
    },
    "rules": {
        // Tech debt. Remove or reconsider one day:
        // "no-unused-vars": ["error", { "args": "none" }],
        "func-names": "off",
        "no-use-before-define": ["error", "nofunc"],
        "max-len": "off",
        "no-restricted-syntax": ["error", "ForInStatement", "LabeledStatement", "WithStatement"],
        "strict": "off",
        // "require-await": "error",
        // "require-yield": "error",
        // "linebreak-style": "off",
        // "arrow-parens": "off",
        "no-unused-vars": "off"
    },
    "overrides": [{
        "files": [".*.js"],
        "rules": {
            "quote-props": "off",
            "quotes": "off"
        }
    }],
};
