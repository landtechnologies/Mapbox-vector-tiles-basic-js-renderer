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
    ],
    alias: {
      'webworkify': 'webworkify-webpack',
      'workerbabelpolyfill': path.resolve(__dirname, 'workerbabelpolyfill.js')
    }
  },
  resolveLoader: {
    moduleExtensions: ['-loader']
  },
  module: {
    rules: [
      {
        test: /source\/worker\.js$/,
        enforce: 'pre',
        loader: 'imports-loader?workerbabelpolyfill'
      },
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