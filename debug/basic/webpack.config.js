var path = require('path');
var webpack = require('webpack');

module.exports = {
  entry: {
    'main': [
      'babel-polyfill',
      './main.js'
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
        include: [
          __dirname,
          path.resolve(__dirname, "../../src"),
        ],
        query: {
          plugins: ["transform-flow-comments", "transform-class-properties"]
        }

      }
    ]
  }
};