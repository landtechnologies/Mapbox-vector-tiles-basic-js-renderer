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
    ]
  },
  module: {
    rules: [
      {
        test: /\.glsl$/,
        use: 'raw-loader'
      },
      {
        test: path.resolve(__dirname,'../../src/source/worker.js'),
        use: {  
          loader: 'worker-loader',
          options: { name: 'worker.js' } // may want to add a version token to the name in production
        }
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