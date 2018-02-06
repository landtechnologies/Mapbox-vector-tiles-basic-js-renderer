var path = require('path');
var webpack = require('webpack');

module.exports = {
  entry: {
    'main': [
      'babel-polyfill',
      './main.js'
    ],
    'google': [
      'babel-polyfill',
      './google.js'
    ],
    'mapbox-worker': [
      'babel-polyfill',
      '../../src/source/worker'
    ]
  },
  output: {
    path: path.resolve(__dirname),
    filename: '[name].build.js'
  },
  devtool: 'source-map',
  resolve: {
    modules: [
      path.resolve(__dirname, "./node_modules"),
      path.resolve(__dirname, "../../node_modules"),
    ]
  },
  resolveLoader: {
    moduleExtensions: ['-loader']
  },
  module: {
    rules: [
      {
        test: /\.glsl$/,
        use: 'raw-loader'
      },
      {
        test: /\.js$/,
        loader: 'babel-loader',
        query: {
          presets: ["es2015"],
          plugins: ["transform-flow-comments" , "transform-class-properties"].map(p => path.resolve(__dirname, 'node_modules', 'babel-plugin-' + p))
        }

      }
    ]
  }
};