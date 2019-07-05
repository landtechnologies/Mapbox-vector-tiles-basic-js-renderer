/* eslint-disable */
module.exports = {
  presets: [ 
    ["@babel/preset-env"]
  ],
  plugins: [
    "@babel/plugin-transform-flow-strip-types",
    "@babel/plugin-proposal-object-rest-spread",
    "@babel/plugin-proposal-class-properties",
    "@babel/plugin-transform-regenerator"
  ]
};
