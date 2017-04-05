/*
  This is basically a plugin for mapbox-gl.
  Asside from the constructor, it provides one main method:

  renderTile(z, x, y, callback)
  
  The callback is provided with (err, canvas) where the canvas has
  the given tile rendered to it, filling the entire canvas.
  It should consume the image immediately, ie. by using
  drawImage onto a new canvas, as there is no guarantee of
  the lifetime of the image on the canvas.

  Canceling a render. The renderTile function returns a renderId
  which can be passed to cancelRender. When canceled, any pending
  callbacks will be triggered with a "canceled" error, and then
  never again (guaranteed).

  The initial style for the render is set in {style:} passed to the constructor.
  However there are several methods for chaning the render options.  Whenever 
  any one of these is set, all pending renders are canceled (with the "canceled"
  error sent to pending callbacks)....
    - setResolution(r) sets the width (equal to height) of the rendered tile
    - setPaintProperty(layer, property, value) - see mapbox map's method of the same name
    - setFilter(layer, filter) - see mapbox map's method of the same name

  ==========================================
  Notes on development:

  The property _pendingRenders maps from <coord.id> to an object that 
  contains of the form {tile, renderId, callbacks: [], ...}.
  Note this is not a cache: things are removed from the _pendingRenders 
  when the rendering is completed, we also unload the tile from the worker.

  When renderTile is called, we get the coord.id value and check for a
  pending render state, appending the new callback if it exists.  If it does
  not exist we create a new one, and issue the tile-load request (which has
  to complete before we can perform the render).  When the resolution/filter/style
  is updated we clear all pending renders.  Note how each render has a unique
  renderId, which we can use to track results comming back from the worker to
  ensure that they are still wanted (rather than canceled or superceded for 
  the given tile).

  Caching: the browser will cache the raw protobuf files for a few hours 
  (as we set the cache header on our server to let this happen). In addition
  to this we might want to implement a cache of "deserialsed" tiles (the 
  terminology used by mapbox)...this should make it a bit (?) faster to
  render tiles at different zoom levels and/or with different styles/filters.

*/

const Painter = require('./render/painter'),
      Style = require('./style/style'),
      EXTENT = require('./data/extent'),
      Evented = require('./util/evented'),
      TileCoord = require('./source/tile_coord'),
      mat4 = require('@mapbox/gl-matrix').mat4,
      Source = require('./source/source'),
      Tile = require('./source/tile');

const DEFAULT_RESOLUTION = 256;
const TILE_LOAD_TIMEOUT = 60000;
const TILE_CACHE_SIZE = 100;

class Style2 extends Style {
  constructor(stylesheet, map, options){
    super(stylesheet, map, options);
  }
  addSource(id, source, options){
    console.assert(!this._source, "can only load one source");
    this._source = Source.create(id, source, this.dispatcher, this);
    this._source.tiles = source.tiles;
    this._source.map = this.map;
    this._source.setEventedParent(this, {source: this._source});
    this.sourceCaches[id] = {
      getSource: () => this._source,
      getVisibleCoordinates: () => [this._currentCoord],
      getTile: () => this._currentTile,
      reload: () => {},
      serialize: () => this._source.serialize()
    }; 
  }
};

class MapboxSingleTile extends Evented {

  constructor(options) {
    super();
    this._initOptions = options = options || {}; 
    this.transform = {zoom: 0, angle: 0, pitch: 0, scaleZoom: ()=> 0};
    this._posMatrix = this._calculatePosMatrix(); // doesn't depend on anything!
    this._style = new Style2(Object.assign({}, options.style, {transition: {duration: 0}}), this);
    this._style.setEventedParent(this, {style: this._style});
    this._style.on('data', e => (e.dataType === "style") && this._style.update([], {transition: false}));
    this._nextRenderId = 0;
    this._canvas = document.createElement('canvas');
    this._canvas.addEventListener('webglcontextlost', () => console.log("webglcontextlost"), false);
    this._canvas.addEventListener('webglcontextrestored', () => this._createGlContext(), false); 
    this._createGlContext();
    this.setResolution(DEFAULT_RESOLUTION);
    this._pendingRenders = {}; // coord.id => render state
  }

  get _source(){
    return this._style._source;
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
    this._cancelAllPending(false);
    this._style.update([], {transition: false});
  }

  setFilter(layer, filter){
    // https://www.mapbox.com/mapbox-gl-js/style-spec/#types-filter
    this._style.setFilter(layer, filter);
    this._cancelAllPending(false);
    this._style.update([], {transition: false});
  }

  setResolution(r){
    // resolution at which the tile is rendered,
    if(r == this._resolution){
      return;
    }
    this._size = r;
    this._canvas.width = r;
    this._canvas.height = r;
    this.transform.pixelsToGLUnits = [2 / r, -2 / r];
    this.painter.resize(r, r); 
    this._resolution = r;
    this._cancelAllPending(false);
  }

  _cancelAllPending(abortFetch){
    // TODO: handle abortFetch=true
    for(var id in this._pendingRenders){
      this._cancelRender(this._pendingRenders[id]);
    }
    this._pendingRenders = {};
  }

  _cancelRender(state){
    while(state.callbacks.length){
      state.callbacks.shift()("canceled");
    }
    clearTimeout(state.timeout);
    delete this._pendingRenders[state.id];
    this._source.unloadTile(state.tile);
  }

  cancelRender(renderId, state){
    var state = Object.values(this._pendingRenders)
                      .find(state => state.renderId === renderId);
    state && this._cancelRender(state);
  }

  renderTile(z, x, y, next){
    var coord = new TileCoord(z, x, y, 0);    
    var id = coord.id;
    var state = this._pendingRenders[id];
    if(state){
      state.callbacks.push(next);
      return state.renderId;
    }

    var renderId = ++this._nextRenderId;
    state = this._pendingRenders[id] = {
      id: id,
      callbacks: [next],
      tile: new Tile(coord.wrapped(), this._resolution, z),
      coord: coord,
      renderId: renderId,
      timeout: setTimeout(() => {
        delete this._pendingRenders[coord.id];
        while(state.callbacks.length){
          state.callbacks.shift()("timeout");
        }
      }, TILE_LOAD_TIMEOUT)
    };   

    this._source.loadTile(state.tile, err => {
      state = this._pendingRenders[id];
      if(!state || state.renderId !== renderId){
        return; // render for this tile has been canceled, or superceded.
      }

      if(!err){
        this.transform.zoom = z;
        state.tile.tileSize = this._resolution;
        state.coord.posMatrix = this._posMatrix;
        this._style._currentCoord = state.coord;
        this._style._currentTile = state.tile;
        this.painter.render(this._style, {
          showTileBoundaries: this._initOptions.showTileBoundaries,
          showOverdrawInspector: this._initOptions.showOverdrawInspector
        });
        this._style._currentCoord = null;
        this._style._currentTile = null;
      }

      while(state.callbacks.length){
        state.callbacks.shift()(err, !err && this._canvas);
      }

      clearTimeout(state.timeout);
      delete this._pendingRenders[id];
      this._source.unloadTile(state.tile);
      
    });

    return state.renderId;
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