/* eslint-disable */
const path = require("path");

const resolve = (...paths) => path.resolve(__dirname, ...paths);

module.exports = {
  mode: "production",
  entry: {
    "mapbox-gl": ["./src"]
  },
  devtool: "source-map",
  output: {
    path: resolve("dist"),
    filename: "[name].js",
    libraryTarget: "commonjs2"
  },
  resolve: {
    extensions: [".js", ".json"]
  },
  module: {
    rules: [
      {
        test: /\.glsl$/,
        use: "raw-loader"
      },
      {
        test: resolve("src/source/worker.js"),
        use: {
          loader: "worker-loader",
          options: {
            inline: true,
            fallback: false
          }
        }
      },
      {
        test: /\.js$/,
        loader: "babel-loader",
        exclude: /node_modules/
      }
    ]
  }
};
