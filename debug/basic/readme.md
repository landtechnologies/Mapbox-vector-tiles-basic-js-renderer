# Basic Vector Tile Rendering

This is a demo showing the purpose of this fork of the original mapbox-gl-js.

It should be available hosted online by github [here](https://landtechnologies.github.io/Mapbox-vector-tiles-basic-js-renderer/debug/basic/).

TODO: relative paths work on github, but not locally. Fix this.

```bash
npm install http-server -g
http-server # run at the root of the repo
# open: localhost:<port>/debug/basic/index.html
```

Note that you may need to change the google maps key in `google.html` to be able to run it locally.

If you want to modify the code and build it locally, you need to be aware that this fork uses webpack to build mapbox rather than browserify, as in the original.

See the root readme for further details.

--

Tiles (for Brighton, UK) were obtained free from [openmaptiles.com](https://openmaptiles.com/downloads/tileset/osm/europe/great-britain/england/brighton/?usage=open-source) for use, here, in this open source project. They are currently hosted within an AWS S3 bucket owned by LandInsight. After download they were upacked into `.pbf` using [@mapbox/node-mbtiles](https://github.com/mapbox/node-mbtiles) (see script `unpack_tiles.js` here).
