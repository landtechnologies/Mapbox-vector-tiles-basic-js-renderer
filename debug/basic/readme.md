# Basic Vector Tile Rendering

This is a demo showing the purpose of this fork of the original mapbox-gl-js.

It should be available online via the gh-pages branch on github [here](https://landtechnologies.github.io/Mapbox-vector-tiles-basic-js-renderer/debug/basic/).

It can be run locally as follows:

```bash
npm install # in this directory, not just the repo root
npm run dev-html # serves html on a particular localhost port
npm run dev-webpack # you need to run this in a separate terminal
```

If you want to modify the code and build it locally, you need to be aware that this fork uses webpack to build mapbox rather than browserify, as in the original. The build is also done as part of the demo, rather than using a pre-built js file.

Tiles (for Brighton, UK) were obtained free from [openmaptiles.com](https://openmaptiles.com/downloads/tileset/osm/europe/great-britain/england/brighton/?usage=open-source) for use, here, in this open source project. They are currently hosted within an AWS S3 bucket owned by LandInsight. After download they were upacked into `.pbf` using [@mapbox/node-mbtiles](https://github.com/mapbox/node-mbtiles) (see script `unpack_tiles.js` here).

See the root readme for further details.
