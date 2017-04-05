/*
  This is basically a plugin for mapbox-gl.
  Asside from the constructor, it provides one main method:

  renderTile(z, x, y, callback)
  
  The callback is provided with (err, canvas) where the canvas has
  the given tile rendered to it, filling the entire canvas.
  It should consume the image immediately, ie. by using
  drawImage onto a new canvas, as there is no guarantee of
  the lifetime of the image on the canvas.

  The width (=height) of the tile rendered is set using the .setResolution method.
  The style for each layer is set as the "style" field passed in the options
  object to the constructor, but it can be overriden using the .setPaintProperty
  method.  IMPORTANT: the resolution and style used for rendering is read at the 
  point the render is actually performed, not at the point it is requested (
  the render is performed in an async manner, remember). Hopefully this meets 
  the requirements of the user.

  ==========================================
  Notes on development:

  At the point renderTile is called, the given tile can be in one of several states:
      1. Never previously mentioned (or long forgotten about).
         So need to load data from source(s) before rendering. (Browser may
         have the raw files in its cache, so this may not require making a roundtrip
         to the server, but that optimization is transparent to us).
      2. Recently requested, but not ready yet (i.e. in _pendingRenders)
      3. Previously requested, with data still available, so no need to wait before rendering.

  The property _pendingRenders maps from <coord.id> to an object that contains callbacks.
  Note this is not a cache: things are removed from the _pendingRenders when the rendering
  is completed (at which point they are added to _renderedTileCache).

*/

const Painter = require('./render/painter'),
      Style = require('./style/style'),
      EXTENT = require('./data/extent'),
      Evented = require('./util/evented'),
      TileCoord = require('./source/tile_coord'),
      mat4 = require('@mapbox/gl-matrix').mat4,
      Cache = require('./util/lru_cache');

const DEFAULT_RESOLUTION = 256;
const TILE_LOAD_TIMEOUT = 60000;

class MapboxSingleTile extends Evented {

  constructor(options) {
    super();
    this._initOptions = options = options || {}; 
    this.transform = {zoom: 0, angle: 0, pitch: 0, scaleZoom: ()=> 0};
    this._posMatrix = this._calculatePosMatrix(); // doesn't depend on anything!
    this._style = new Style(Object.assign({}, options.style, {transition: {duration: 0}}), this);
    this._style.setEventedParent(this, {style: this._style});
    this._style.on('data', e => (e.dataType === "source") && this._initSourceCache());
    this._style.on('data', e => (e.dataType === "style") && this._style.update([], {transition: false}));
    
    this._canvas = document.createElement('canvas');
    this._canvas.addEventListener('webglcontextlost', () => console.log("webglcontextlost"), false);
    this._canvas.addEventListener('webglcontextrestored', () => this._createGlContext(), false); 
    this._createGlContext();
    this.setResolution(DEFAULT_RESOLUTION);
    this._pendingRenders = {};
  }

  _initSourceCache(){
    var sources = Object.keys(this._style.sourceCaches);
    if(sources.length !== 1){
      throw "expected exactly 1 source"; // could implement multi-source, but not needed yet
    }
    this._sourceCache = this._style.sourceCaches[sources[0]]; 
    this._sourceCache._coveredTiles = {};
    this._sourceCache.transform = this.transform;
    this._sourceCache.on('data', e => e.coord && this._renderTileNowDataIsAvailable(e));
    this._sourceCache.on('error', e => e.tile &&  this._renderTileDataFetchFailed(e));
  }

  _calculatePosMatrix() {
    const posMatrix = mat4.identity(new Float64Array(16));
    const halfExtent = EXTENT/2;
    mat4.scale(posMatrix, posMatrix, [1/halfExtent, -1/halfExtent, 1]);
    mat4.translate(posMatrix, posMatrix, [-halfExtent, -halfExtent, 0]);
    return new Float32Array(posMatrix);
  }

  _createGlContext(){
    const attributes = Object.assign({
        failIfMajorPerformanceCaveat: this._initOptions.failIfMajorPerformanceCaveat,
        preserveDrawingBuffer: this._initOptions.preserveDrawingBuffer
    }, require('mapbox-gl-supported').webGLContextAttributes);
    
    this._gl = this._canvas.getContext('webgl', attributes) ||
               this._canvas.getContext('experimental-webgl', attributes);
    if (!this._gl) {
      throw new Error('Failed to initialize WebGL');
    }
    this.painter = new Painter(this._gl, this.transform);
    this.painter.style = this._style;
  }

  setPaintProperty(layer, prop, val){
    this._style.setPaintProperty(layer, prop, val);
    this._style.update([], {transition: false});
  }

  setFilter(layer, filter){
    // https://www.mapbox.com/mapbox-gl-js/style-spec/#types-filter
    this._style.setFilter(layer, filter);
    this._style.update([], {transition: false});
  }

  setResolution(r){
    // resolution at which the tile is rendered,
    // r is the width (=height) of the rendered tile.
    if(r == this._resolution){
      return;
    }
    this._size = r;
    this._canvas.width = r;
    this._canvas.height = r;
    this.transform.pixelsToGLUnits = [2 / r, -2 / r];
    this.painter.resize(r, r); 
    this._resolution = r;
  }

  _renderTileDataFetchFailed(e){
    var state = this._pendingRenders[e.tile.coord.id];
    if(!state){
      return; // timeout already occured
    }
    delete this._pendingRenders[e.tile.coord.id];
    clearTimeout(state.timeout);
    for(var variantKey in state.variants){
      var callbacks = state.variants[variantKey].callbacks;
      while(callbacks.length){
        callbacks.shift()("fetch failed");
      }
    }
  }

  _renderTileNowDataIsAvailable(e){
    var state = this._pendingRenders[e.coord.id];
    if(!state){
      return; // timeout already occured
    } else if(--state.awaitingSources > 0){
      return;
    } else {
      clearTimeout(state.timeout);
      delete this._pendingRenders[e.coord.id];      
    }

    var z = e.coord.z;
    this.transform.zoom = z;
    e.tile.tileSize = this._resolution;
    e.coord.posMatrix = this._posMatrix;
    this._sourceCache.getVisibleCoordinates = () => [e.coord];
    this.painter.render(this._style, {
      showTileBoundaries: this._initOptions.showTileBoundaries,
      showOverdrawInspector: this._initOptions.showOverdrawInspector
    });
    
    // return a reference to the main canvas
    // note that recipient must make use of it immediately,
    // i.e. by calling drawImage to a new canvas.
    while(state.callbacks.length){
      state.callbacks.shift()(null, this._canvas);
    }

  }
  

  renderTile(z, x, y, next){
    // see note at top of file for explanaiton of the 4 "states" a tile can be in   
    var coord = new TileCoord(z, x, y, 0);    
    
    // Deal with state (2).
    if(this._pendingRenders[coord.id]){
      this._pendingRenders[coord.id].callbacks.push(next);
      return;
    }

    var tile = this._sourceCache.addTile(coord);  
    var state = this._pendingRenders[coord.id] = {
      awaitingSources: tile.hasData() ? 0 : 1, // state (1) is dealt with when tile.hasData() is false - see .addTile call above
      callbacks: [next],
      timeout: 0
    };   
 
    if(state.awaitingSources == 0){
      // Deal with state (3).
      setTimeout(() => this._renderTileNowDataIsAvailable({coord: coord, tile: tile}), 1);

    } else {
      // More stuff for state (1)..this state is also mentioned a few lines above.
      state.timeout = setTimeout(() => {
        delete this._pendingRenders[coord.id];
        while(state.callbacks.length){
          state.callbacks.shift()("fetch timedout");
        }
      }, TILE_LOAD_TIMEOUT);
    }
 
  }

  showCanvasForDebug(){
    document.body.appendChild(this._canvas);
    this._canvas.style.position = "fixed";
    this._canvas.style.top = "20px";
    this._canvas.style.right = "20px";
    this._canvas.style.background = "#ccc";
    this._canvas.style.border = "1px solid red";
  }

}

export default MapboxSingleTile;