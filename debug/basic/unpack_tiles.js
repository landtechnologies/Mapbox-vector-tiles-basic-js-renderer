var tilelive = require("@mapbox/tilelive");
var MBTiles = require("@mapbox/mbtiles");
var s3 = require("@mapbox/tilelive-s3");
// set aws key & secret, as well as AWS_S3_ENDPOINT if not default

s3.registerProtocols(tilelive);
MBTiles.registerProtocols(tilelive);

var sourceUri = "mbtiles:///" + process.env.PATH_TO_MBTILES_FILE;
var sinkUri = "s3://" + process.env.S3_BUCKET_AND_FOLDER + "/{z}/{x}/{y}";

// load the mbtiles source
tilelive.load(sourceUri, function(err, src) {
    // load the s3 sink
    tilelive.load(sinkUri, function(err, dest) {
        var options = {}; // prepare options for tilelive copy
        options.listScheme = src.createZXYStream(); // create ZXY stream from mbtiles
        // now copy all tiles to the destination
        tilelive.copy(src, dest, options, function(err) {
            console.log("tiles are now on s3!");
        });
    });
});
