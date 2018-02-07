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

See the root readme for further details.