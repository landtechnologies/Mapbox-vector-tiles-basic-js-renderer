# Basic Vector Tile Rendering

This directory contains a renderer that does not produce a whole interactive map, it just deals with lists of tiles - see the demo in `../debug/basic` for a full explanation, or to view the demo live go [here](https://landtechnologies.github.io/Mapbox-vector-tiles-basic-js-renderer/debug/basic/).

This directory does not exist in the upsteam mapbox-gl-js, everything here is sepcific to this fork. However there are a few other places that changes have been made outside this directory.
The full summary of differences is as follows (not all of these differences are critical to the main renderer in this directory, but they were features I needed so they are here anyway, at least for now):

* The `renderer.js` file in this directory is considered the main entry point for the package rather than the `../ui/map.js`.
* The package is built with webpack not with browserify.
* The halo around text is rendered in the same pass as the text itself.
* You can use `FORMAT_NUMBER(...)` in text fields..see code in `../util/token.js`.
* We don't care about Flow or tests here.
* We don't bother with fancy anti-collision placement of symbols

If you have questions, please see the contact details on my github profile page [here](https://github.com/d1manson).