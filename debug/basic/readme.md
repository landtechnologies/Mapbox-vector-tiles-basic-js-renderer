# Basic Vector Tile Rendering

This is a demo showing the purpose of this fork of the original mapbox-gl-js.

It should be available hosted online by github [here](https://landtechnologies.github.io/Mapbox-vector-tiles-basic-js-renderer/debug/basic/).

It can be built locally as follows:

```bash
npm install # in this directory, as well as the repo root
npm run build
```

You probably need a localhost server to make it work locally (e.g. run `npm install http-server -g` and `http-server`), note that you may also need to change the google maps key in `google.html` to be able to run it locally.

If you want to modify the code and build it locally, you need to be aware that this fork uses webpack to build mapbox rather than browserify, as in the original. The build is also done as part of the demo, rather than using a pre-built js file.

See the root readme for further details.

--

Tiles (for Brighton, UK) were obtained free from [openmaptiles.com](https://openmaptiles.com/downloads/tileset/osm/europe/great-britain/england/brighton/?usage=open-source) for use, here, in this open source project. They are currently hosted within an AWS S3 bucket owned by LandInsight. After download they were upacked into `.pbf` using [@mapbox/node-mbtiles](https://github.com/mapbox/node-mbtiles) (see script `unpack_tiles.js` here).
