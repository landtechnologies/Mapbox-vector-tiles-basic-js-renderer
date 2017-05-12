/*
  This is basically a plugin for mapbox-gl.

  Aside from the constructor, it provides one main method:
    renderTile(z, x, y, canvas2dContext, drawImageSpec, callback)
  where drawImageSpec needs to have the 2x2+2=6 properties of the form:
     [src|dest][top|left]  |  src[width|height]
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

  The renderTile function returns a renderRef which can be passed
  to cancelRender. When canceled, if the callback is still pending it will be
  triggered with a "canceled" error, and then never again (guaranteed). It
  is also guarnteed that no image will be rendred to a context after it has
  been canceled.

  The drawImageSpec passed to renderTile uses pixel coordinates as implied by
  the resolution value set with setResolution. Note that if you have requested
  a buffer region (aka 'frame') around the rendered tile you can specify negative
  values as well as values outside the tile bounds - this will mean the buffer region
  is used in the drawImage call.

  The initial style for the render is set in {style:} passed to the constructor.
  However there are several methods for changing the render options.  Whenever 
  any one of these is set, all pending renders are canceled (with the "canceled"
  error sent to pending callbacks)....
    - setResolution(r, bufferSize) sets the width (equal to height) of the rendered tile
      to be r pixels, and specifies the width of the buffer (aka 'frame') in pixels.
    - setPaintProperty(layer, property, value) - see mapbox map's method of the same name
    - setFilter(layer, filter) - see mapbox map's method of the same name

  It is also possible to query for features at a given point:
    queryRenderedFeatures({lng:, lat:, tileZ:, timeoutMS:})
  This returns a promise* that resolves giving an array of mapbox features found to intersect
  the given (lat,lng), note that tileZ is neede, because we only look at features within tiles
  at a given zoom (this is similar to how you specify a single-tile for render, but here
  we may need to consult multiple tiles...we use the same bufferSize concept as in rendering).
  The querying uses the current styles and filters etc.  Note that this function does not
  include per-tile timeouts and canceling (as with render). Hopefully in future it will be done
  synchrounsly using an existing tileCache.  At the moment we just impose a basic crude overal
  timeout, which rejects the promise (after 1second by default).

  Note that we don't use the minZoom/maxZoom values in mapbox style (the range should at least 
  cover the single-tile's zoom level), instead we use minZoom_ and maxZoom_ (i.e. with underscores).
  This could potenitally be fixed, but was an easy fix for now.

  * yes we are inconsistent with primises/callbacks, I know.

  ==========================================
  Notes on development:

  As noted above, the "resolution" value states the width (equal to height) of 
  the rendered tile.  However, for really large values we dont render the whole
  thing in one go, instead we render sections of the tile one by one, and carefully
  interpret the drawImageSpec to ensure that the whole image is constructed as
  expected by the caller.  The canvas size being used is held in this._canvasSizeFull,
  as compared to the resolution which is this._resolution.  And when we have a buffer region,
  note that this._canvasSizeFull = this._canvasSizeInner + 2*this._bufferZoneWidth.

  The property _pendingRenders maps from <coord.id> to an object of the form:
   {tile, renderId, callbacks: [], ...}.
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

  To view the data in a tile, you can do something like:
    // at the top of the file
    var VectorTile = require('vector-tile').VectorTile;
    var Protobuf = require('pbf');
    // inside the laodTile callback:
    console.log(new VectorTile(new Protobuf(state.tile.rawTileData)).layers); 


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
      Tile = require('./source/tile'),
      Point = require('point-geometry'),
      QueryFeatures = require('./source/query_features'),
      SphericalMercator = require('@mapbox/sphericalmercator');

var sphericalMercator = new SphericalMercator();

const DEFAULT_RESOLUTION = 256;
const TILE_LOAD_TIMEOUT = 60000;
const TILE_CACHE_SIZE = 100;
const MAX_RENDER_SIZE = 1024; // for higher resolutions, we render in sections
const DEFAULT_BUFFER_ZONE_WIDTH = 0;

var layerStylesheetFromLayer = layer => layer && layer._eventedParent.stylesheet.layers.find(x=>x.id===layer.id);

class Style2 extends Style {
  constructor(stylesheet, map, options){
    super(stylesheet, map, options);
    this._callsPendingStyleLoad = [];
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
      serialize: () => this._source.serialize(),
      map: {}
    }; 
    this.on('data', e => {
      if(e.dataType !== "style"){
        return;
      }
      this._recalculate(16); // TODO: use proper zoom value (which depends on z at the point we actually render)
      while(this._callsPendingStyleLoad && this._callsPendingStyleLoad.length){
        this._callsPendingStyleLoad.shift()();
      }
      this._callsPendingStyleLoad = null;
    });
  }

  setPaintProperty(layer, prop, val){
    if(this._callsPendingStyleLoad){
      this._callsPendingStyleLoad.push(()=> super.setPaintProperty(layer, prop, val));      
    } else {
      super.setPaintProperty(layer, prop, val);
    }
  }

  setFilter(layer, filter){
    if(this._callsPendingStyleLoad){
      this._callsPendingStyleLoad.push(()=> super.setFilter(layer, filter));      
    } else {
      super.setFilter(layer, filter);
    }
  }

};

class Painter2 extends Painter {
  constructor(gl, transform){
    super(gl, transform);
    this._filterForZoom = 15;
  }
  resize(width, height) {
    const gl = this.gl;
    this.width = width;
    this.height = height;
    gl.viewport(0, 0, this.width, this.height);
  }
  renderLayer(painter, sourceCache, layer, coords) {
    let layerStylesheet = layerStylesheetFromLayer(layer);
    if (layerStylesheet && layerStylesheet.minzoom_ && this._filterForZoom < layerStylesheet.minzoom_) return;
    if (layerStylesheet && layerStylesheet.maxzoom_ && this._filterForZoom >= layerStylesheet.maxzoom_) return;
    super.renderLayer(painter, sourceCache, layer, coords);
  }
  enableTileClippingMask(){ }
};

class MapboxSingleTile extends Evented {

  constructor(options) {
    super();
    this._initOptions = options = options || {}; 
    this.transform = {zoom: 0, angle: 0, pitch: 0, scaleZoom: ()=> 0, cameraToCenterDistance: 1};
    this._style = new Style2(Object.assign({}, options.style, {transition: {duration: 0}}), this);
    this._style.setEventedParent(this, {style: this._style});
    this._style.on('data', e => (e.dataType === "style") && this._style.update([], {transition: false}));
    this._nextRenderId = 0;
    this._canvas = document.createElement('canvas');
    this._canvas.style.imageRendering = 'pixelated';
    this._canvas.addEventListener('webglcontextlost', () => console.log("webglcontextlost"), false);
    this._canvas.addEventListener('webglcontextrestored', () => this._createGlContext(), false); 
    for(let k in (options.img_srcs || {})){
      let img = new Image();
      img.onload = () => this._style.spriteAtlas.addImage(k, img);
      img.src = options.img_srcs[k];
    }
    this._createGlContext();
    this.setResolution(DEFAULT_RESOLUTION, DEFAULT_BUFFER_ZONE_WIDTH);
    this._pendingRenders = {}; // coord.id => render state
  }

  get _source(){
    return this._style._source;
  }

  _calculatePosMatrix(transX, transY) {   
    /*
      The returned matrix, M, is designed to be used as:
        X_gl_coords = M * X_mvt_data_coords
      where X_gl_coords are in the range [-1,1]
      and X_mvt_data_coords are in the range [0,Extent], or rather they are nearly 
      within that range, they actually go outside it by about 10% to let polygons/lines
      span across tile boundaries.
      The translate/scale functions here could probably be ditched in favour of
      the mat4 versions, but I found it easier to do the multiplies myself.
    */
    var translate = (a, v) => {
      this._tmpMat4f64b = this._tmpMat4f64b || new Float32Array(16);
      mat4.identity(this._tmpMat4f64b);
      mat4.translate(this._tmpMat4f64b, this._tmpMat4f64b,v);
      mat4.multiply(a,this._tmpMat4f64b,a);
    }
    var scale = (a, v) => {
      this._tmpMat4f64b = this._tmpMat4f64b || new Float32Array(16);
      mat4.identity(this._tmpMat4f64b);
      mat4.scale(this._tmpMat4f64b, this._tmpMat4f64b,v);
      mat4.multiply(a,this._tmpMat4f64b,a);
    }

    this._tmpMat4f64 = this._tmpMat4f64 || new Float64Array(16); // reuse each time for GC's benefit
    this._tmpMat4f32 = this._tmpMat4f32 || new Float32Array(16);

    const factor = (this._resolution/this._canvasSizeInner) // this bit is 1 for further-zoomed out rendering
                   *(this._canvasSizeInner/this._canvasSizeFull);
    const b = this._bufferZoneWidth/this._canvasSizeFull*2;

    // The main calculation...
    mat4.identity(this._tmpMat4f64);
    translate(this._tmpMat4f64, [-EXTENT*transX/this._resolution, -EXTENT*transY/this._resolution,0]);
    scale(this._tmpMat4f64,[2/EXTENT*factor, -2/EXTENT*factor, 1]);
    translate(this._tmpMat4f64, [-1+b, 1-b, 0]);

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
    this.painter = new Painter2(this._gl, this.transform);
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

  // takes an array of layer names to show
  setLayers(visibleLayers){
    this._cancelAllPending(false);
    Object.keys(this._style._layers).forEach(layerName => 
      this._style.setLayoutProperty(layerName, 'visibility', visibleLayers.indexOf(layerName) > -1 ? 'visible' : 'none'));
    this._style.update([], {transition: false});
  }

  getSuggestedBufferWidth(zoom){
    let visibleLayerTypes = this.getLayersVisible(zoom).map(lyr => this._style._layers[lyr].type);
    visibleLayerTypes = new Set(visibleLayerTypes);
    if(visibleLayerTypes.size > 1){
      console.warn("combining multiple layer types is probably not a good idea.");
    }
    if(visibleLayerTypes.has("circle") || visibleLayerTypes.has("symbol")){
      return 30;
    } else {
      return 0;
    }
  }

  getLayersVisible(zoom){
    // if zoom is provided will filter by min/max zoom as well as by layer visibility
    return Object.keys(this._style._layers)
      .filter(lyr=>this._style.getLayoutProperty(lyr, 'visibility') === 'visible')
      .filter(lyr => {
        let layerStylesheet = layerStylesheetFromLayer(this._style._layers[lyr]);
        return !zoom || (layerStylesheet && 
          zoom >= layerStylesheet.minzoom_ &&
          zoom <= layerStylesheet.maxzoom_);
      });
  }

  filterForZoom(zoom){
    if(zoom === this.painter._filterForZoom){
      return;
    }
    this.painter._filterForZoom = zoom;
    this._cancelAllPending(false);
  }

  setResolution(r, bufferZoneWidth){
    bufferZoneWidth = bufferZoneWidth || 0;
    if(r === this._resolution && this._bufferZoneWidth === bufferZoneWidth){
      return;
    }
    this._resolution = r;
    this._bufferZoneWidth = bufferZoneWidth;
    this._canvasSizeFull = Math.min(r + 2*bufferZoneWidth, MAX_RENDER_SIZE);
    this._canvasSizeInner = this._canvasSizeFull - 2*bufferZoneWidth;
    this._canvas.width = this._canvasSizeFull;
    this._canvas.height = this._canvasSizeFull;
    this.transform.pixelsToGLUnits = [2 / this._canvasSizeFull, -2 / this._canvasSizeFull];
    this.painter.resize(this._canvasSizeFull, this._canvasSizeFull); 
    this._cancelAllPending(false);

    if(this._debugBufferEl){
      this._debugBufferEl.style.width = this._canvasSizeFull + 'px';
      this._debugBufferEl.style.height = this._canvasSizeFull + 'px';
    } 
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

  cancelRender(renderRef, state){
    var state = Object.values(this._pendingRenders)
                      .find(state => state.renderId === renderRef.id);
    if(!state){
      return;
    }
    var idx = state.callbacks.indexOf(renderRef.callback);
    (idx !== -1) && state.callbacks.splice(idx,1);
    (state.callbacks.length === 0) && this._cancelRender(state);
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
      return {id: state.renderId, callback: callback};
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
        for(var xx=0; xx<this._resolution; xx+= this._canvasSizeInner){
          for(var yy=0; yy<this._resolution; yy+=this._canvasSizeInner){
            var relevantCallbacks = state.callbacks.filter(cb =>
              cb.drawImageSpec.srcLeft + cb.drawImageSpec.srcWidth > xx &&
              cb.drawImageSpec.srcLeft < xx + this._canvasSizeInner &&
              cb.drawImageSpec.srcTop + cb.drawImageSpec.srcHeight > yy && 
              cb.drawImageSpec.srcTop < yy + this._canvasSizeInner);
            if(relevantCallbacks.length === 0){
              continue;
            }

            state.coord.posMatrix = this._calculatePosMatrix(xx, yy);
            this.painter.render(this._style, {
              showTileBoundaries: this._initOptions.showTileBoundaries,
              showOverdrawInspector: this._initOptions.showOverdrawInspector
            });

            relevantCallbacks.forEach(cb => {
                // convert from [-bufferZoneWidth, resolution+bufferZoneWidth] to [0, canvasSizeFull]
                let srcLeft = Math.max(0, this._bufferZoneWidth + cb.drawImageSpec.srcLeft - xx);
                let srcTop = Math.max(0, this._bufferZoneWidth + cb.drawImageSpec.srcTop - yy);
                let srcRight = Math.min(this._canvasSizeFull,
                  this._bufferZoneWidth + cb.drawImageSpec.srcLeft + cb.drawImageSpec.srcWidth - xx);
                let srcBottom = Math.min(this._canvasSizeFull,
                  this._bufferZoneWidth + cb.drawImageSpec.srcTop + cb.drawImageSpec.srcHeight - yy);
                cb.ctx.drawImage(
                  this._canvas,
                  srcLeft, srcTop, 
                  srcRight - srcLeft, srcBottom - srcTop, 
                  cb.drawImageSpec.destLeft + ((xx > cb.drawImageSpec.srcLeft) && (xx - cb.drawImageSpec.srcLeft - this._bufferZoneWidth)) |0,
                  cb.drawImageSpec.destTop + ((yy > cb.drawImageSpec.srcTop) && (yy - cb.drawImageSpec.srcTop - this._bufferZoneWidth))|0,
                  srcRight - srcLeft, srcBottom - srcTop);
            });
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

    return {id: state.renderId, callback: callback};
  }


  queryRenderedFeatures(opts){
    let layers = {};
    this.getLayersVisible(opts.renderedZoom)
        .forEach(lyr => layers[lyr] = this._style._layers[lyr]);
    // convert from lat lng to...
    // (a) the tile XY id, i.e. which (x,y,z) tile are we talking about?
    let tileXY = sphericalMercator.px([opts.lng, opts.lat], opts.tileZ).map(x=>x/256 /* why 256? */) 
    // (b) the xy of the point within the relevant tile, expressed in [0,EXTENT] units.
    let pointXY = tileXY.map(x => (x - (x|0)) * EXTENT);

    // collect the coordinates of the tile containing the given point, plus any with an overlapping buffer region
    let coords = []; 
    let bufferSize = this._bufferZoneWidth/this._resolution * EXTENT; // measured in the same units as pointXY
    let X = tileXY[0] | 0, Y = tileXY[1] | 0, Z = opts.tileZ;
    coords.push(new TileCoord(Z, X, Y, 0));
    // consider including the left, right, top, bottom adjacent tiles (if the point is near to the given edge)
    (pointXY[0]<bufferSize)        && coords.push(new TileCoord(Z, X-1, Y, 0));
    (pointXY[0]>EXTENT-bufferSize) && coords.push(new TileCoord(Z, X+1, Y, 0));
    (pointXY[1]<bufferSize)        && coords.push(new TileCoord(Z, X, Y-1, 0));
    (pointXY[1]>EXTENT-bufferSize) && coords.push(new TileCoord(Z, X, Y+1, 0));
    // and consider including the 4 corner adjacent tiles (again, if the point is near the given corner)
    (pointXY[0]<bufferSize && pointXY[1]<bufferSize)        && coords.push(new TileCoord(Z, X-1, Y-1, 0));
    (pointXY[0]<bufferSize && pointXY[1]>EXTENT-bufferSize) && coords.push(new TileCoord(Z, X-1, Y+1, 0));
    (pointXY[0]>EXTENT - bufferSize && pointXY[1]<bufferSize)        && coords.push(new TileCoord(Z, X+1, Y-1, 0));
    (pointXY[0]>EXTENT - bufferSize && pointXY[1]>EXTENT-bufferSize) && coords.push(new TileCoord(Z, X+1, Y+1, 0));
    
    // prepare the fake tileCache (we will issue tile load requests in a moment)
    let sourceCache = Object.create(this._style.sourceCaches.landinsight);
    let tilesIn = coords.map(c => ({
      tile: new Tile(c, this._resolution, opts.tileZ),
      coord: c,
      queryGeometry: [[Point.convert([
        // for all but the 0th coord, we need to adjust the pointXY values to lie suitably outside the [0,EXTENT] range
        pointXY[0] + EXTENT*(X-c.x),  
        pointXY[1] + EXTENT*(Y-c.y),
      ])]],
      scale: 1
    }));
    sourceCache.tilesIn = () => tilesIn;
    let nTilesPending = coords.length;
    return new Promise((res, rej) => {     
      let timer = setTimeout(() => {
        timer = null;
        rej("timeout");
      }, opts.timeoutMS || 1000);

      tilesIn.forEach(t => this._source.loadTile(t.tile, err => {
        if(--nTilesPending>0 || !timer){
          return;
        }
        clearTimeout(timer);

        let featuresByRenderLayer = QueryFeatures.rendered(
          sourceCache,
          layers, 
          null /* query geometry is pre-specified in tilesIn */, 
          {circleFudgeExtraPx: 8}, opts.tileZ, 0);
        

        let featuresBySourceLayer = {};
        Object.keys(featuresByRenderLayer).forEach(f => featuresByRenderLayer[f].map(ff => 
          (featuresBySourceLayer[ff.layer['source-layer']] = featuresBySourceLayer[ff.layer['source-layer']] || [])
            .push(ff._vectorTileFeature.properties)));
        
        res(featuresBySourceLayer);

      }));
    });
  }

  showCanvasForDebug(){
    document.body.appendChild(this._canvas);
    this._canvas.style.position = "fixed";
    this._canvas.style.top = "250px";
    this._canvas.style.right = "20px";
    this._canvas.style.background = "#ccc";
    var buffer = this._debugBufferEl = document.createElement('div');
    buffer.style.position = "fixed";
    buffer.style.top = "250px";
    buffer.style.right = "20px";
    buffer.style.border = '45px solid rgba(255,0,0,0.2)'; // TODO: use this._bufferZoneWidth properly
    document.body.appendChild(buffer);
  }

}

export default MapboxSingleTile;