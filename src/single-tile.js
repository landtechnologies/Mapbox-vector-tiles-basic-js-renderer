/*
  This is basically a plugin for mapbox-gl.

  Aside from the constructor, it provides one main method:
    renderTile(z, x, y, canvas2dContext, drawImageSpec, callback)
  where drawImageSpec needs to have the 2x3=6 properties of the form:
     [src|dest][size|top|left]
  If the render is successful the image will be draw onto the specified
  context using the specified drawImageSpec, and then the callback will
  be triggered immediately (sync) afterwards with an error/null passed.
  Errors include "timeout" and "cancel" among other things, and when an
  error is returned it means the image was not rendered and never will be.
  IMPORTANT: the destination canvas must be greater than about 512x512 to
  ensure chrome puts it on the gpu not the cpu...when left on the cpu the
  drawImage call can take 100x longer, which is horrible. Note that the size
  of the tile and the size of the visible part of the canvas is not relevant,
  only the total size of the canvas.

  The renderTile function returns a renderId which can be passed
  to cancelRender. When canceled, any pending callbacks will be
  triggered with a "canceled" error, and then never again (guaranteed). It
  is also guarnteed that no image will be rendred to a context after it has
  been canceled.

  The initial style for the render is set in {style:} passed to the constructor.
  However there are several methods for chaning the render options.  Whenever 
  any one of these is set, all pending renders are canceled (with the "canceled"
  error sent to pending callbacks)....
    - setResolution(r) sets the width (equal to height) of the rendered tile
    - setPaintProperty(layer, property, value) - see mapbox map's method of the same name
    - setFilter(layer, filter) - see mapbox map's method of the same name

  ==========================================
  Notes on development:

  As noted above, the "resolution" value states the width (equal to height) of 
  the rendered tile.  However, for really large values we dont render the whole
  thing in one go, instead we render sections of the tile one by one, and carefully
  interpret the drawImageSpec to ensure that the whole image is constructed as
  expected by the caller.  The canvas size being used is held in this._canvasSize,
  as comared to the resolution which is this._resolution.

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
  (as we set the cache header on our server to let this happen). 

  Suggestion: In addition to the above, we might want to implement a 
  cache of "deserialsed" tiles (the terminology used by mapbox)...this should 
  make it a bit (?) faster to  render tiles at different resolutions and/or 
  with diffrent styles/filters.  In fact, when changing resolution there is
  no need to do any work prior to the GPU-render, so it would definitely help
  having the tiles cached in that case.

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
const MAX_RENDER_SIZE = 1024; // for higher resolutions, we render in sections

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

  _calculatePosMatrix(transX, transY) {
    this._tmpMat4f64 = this._tmpMat4f64 || new Float64Array(16); // reuse each time for GC's benefit
    this._tmpMat4f32 = this._tmpMat4f32 || new Float32Array(16);
    const factor = this._resolution/this._canvasSize;
    mat4.identity(this._tmpMat4f64);
    mat4.scale(this._tmpMat4f64, this._tmpMat4f64, [factor * 2/EXTENT, -factor * 2/EXTENT, 1]);
    mat4.translate(this._tmpMat4f64, this._tmpMat4f64, 
      [-EXTENT/factor/2 - EXTENT*transX/this._resolution,
       -EXTENT/factor/2 - EXTENT*transY/this._resolution, 
       0]);
    this._tmpMat4f32.set(this._tmpMat4f64);
    return this._tmpMat4f32;
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
    if(r == this._resolution){
      return;
    }
    this._resolution = r;
    this._canvasSize = Math.min(r, MAX_RENDER_SIZE);
    this._canvas.width = this._canvasSize;
    this._canvas.height = this._canvasSize;
    this.transform.pixelsToGLUnits = [2 / this._canvasSize, -2 / this._canvasSize];
    this.painter.resize(this._canvasSize, this._canvasSize); 
    this._cancelAllPending(false);
  }

  _cancelAllPending(){
    for(var id in this._pendingRenders){
      this._cancelRender(this._pendingRenders[id]);
    }
    this._pendingRenders = {};
  }

  _cancelRender(state){
    while(state.callbacks.length){
      state.callbacks.shift().func("canceled");
    }
    clearTimeout(state.timeout);
    delete this._pendingRenders[state.id];
    this._source.abortTile(state.tile);
    this._source.unloadTile(state.tile);
  }

  cancelRender(renderId, state){
    var state = Object.values(this._pendingRenders)
                      .find(state => state.renderId === renderId);
    state && this._cancelRender(state);
  }

  renderTile(z, x, y, ctx, drawImageSpec, next){
    var callback = {
      func: next,
      ctx: ctx,
      drawImageSpec: drawImageSpec
    };
    var coord = new TileCoord(z, x, y, 0);    
    var id = coord.id;
    var state = this._pendingRenders[id];
    if(state){
      state.callbacks.push(callback);
      return state.renderId;
    }

    var renderId = ++this._nextRenderId;
    state = this._pendingRenders[id] = {
      id: id,
      callbacks: [callback],
      tile: new Tile(coord.wrapped(), this._resolution, z),
      coord: coord,
      renderId: renderId,
      timeout: setTimeout(() => {
        delete this._pendingRenders[coord.id];
        while(state.callbacks.length){
          state.callbacks.shift().func("timeout");
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
        this._style._currentCoord = state.coord;
        this._style._currentTile = state.tile;

        for(var xx=0; xx<this._resolution; xx+= this._canvasSize){
          for(var yy=0; yy<this._resolution; yy+=this._canvasSize){
            var relevantCallbacks = state.callbacks.filter(cb =>
              cb.drawImageSpec.srcLeft >= xx &&
              cb.drawImageSpec.srcLeft < xx + this._canvasSize &&
              cb.drawImageSpec.srcTop >= yy && 
              cb.drawImageSpec.srcTop < yy + this._canvasSize);
            if(relevantCallbacks.length === 0){
              continue;
            }

            state.coord.posMatrix = this._calculatePosMatrix(xx, yy);
            this.painter.render(this._style, {
              showTileBoundaries: this._initOptions.showTileBoundaries,
              showOverdrawInspector: this._initOptions.showOverdrawInspector
            });

            relevantCallbacks.forEach(cb =>
              cb.ctx.drawImage(
                this._canvas,
                cb.drawImageSpec.srcLeft-xx, cb.drawImageSpec.srcTop-yy, 
                cb.drawImageSpec.srcSize, cb.drawImageSpec.srcSize, 
                cb.drawImageSpec.destLeft, cb.drawImageSpec.destTop,
                cb.drawImageSpec.destSize, cb.drawImageSpec.destSize));
          } // yy
        } // xx
        
        this._style._currentCoord = null;
        this._style._currentTile = null;
      }

      while(state.callbacks.length){
        state.callbacks.shift().func(err);
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