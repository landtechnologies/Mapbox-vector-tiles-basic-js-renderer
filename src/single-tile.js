// For info on usage, development and debugging,
// see https://docs.google.com/a/landtech.co/document/d/1eB2oH3d7mpDfK8gxTiYphxPgBM7EDu5MeUNKrQwYIrQ/

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
      SphericalMercator = require('@mapbox/sphericalmercator'),
      Cache = require('./util/lru_cache');

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
    this._loadedPromise = new Promise(res => 
      this.on('data', e => e.dataType === "style" && res()));
    this._source = {
      isDummy: true,
      loadTile: (tile, cb) => this._loadedPromise.then(()=>this._source.loadTile(tile, cb)),
      unloadTile: (tile) => this._loadedPromise.then(()=>this._source.unloadTile(tile)), 
      abortTile: (tile) => this._loadedPromise.then(()=>this._source.unloadTile(tile))
    };
  }

  addSource(id, source, options){
    console.assert(!this._source || this._source.isDummy, "can only load one source");
    this._source = Source.create(id, source, this.dispatcher, this);
    this._source.tiles = source.tiles;
    this._source.map = this.map;
    this._source.setEventedParent(this, {source: this._source});
    this.sourceCaches[id] = {
      getSource: () => this._source,
      getVisibleCoordinates: () => [this._currentCoord],
      getTile: () => this._currentTile,
      reload: () => {},
      pause: () => {},
      resume: () => {},
      serialize: () => this._source.serialize(),
      map: { }
    }; 
    this._loadedPromise
      .then(() => this._recalculate(16)); // TODO: use proper zoom value (which depends on z at the point we actually render)
  }

  setPaintProperty(layer, prop, val){
    return this._loadedPromise.then(() => super.setPaintProperty(layer, prop, val));      
  }

  setFilter(layer, filter){
    return this._loadedPromise.then(() => super.setFilter(layer, filter));   
  }

  setLayers(visibleLayerNames){
    // Note this is not part of mapbox style, but handy to put it here for use with pending-style    
    return this._loadedPromise
      .then(() => Object.keys(this._layers)
        .forEach(layerName => 
        this.setLayoutProperty(layerName, 'visibility', 
          visibleLayerNames.indexOf(layerName) > -1 ? 'visible' : 'none')
      ));
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
    this.transform = {
      zoom: 0, angle: 0, pitch: 0, _pitch: 0, scaleZoom: ()=> 0,
      cameraToCenterDistance: 1, cameraToTileDistance: () => 1 };
    this._tileCache = new Cache(TILE_CACHE_SIZE, t => this._source.unloadTile(t));
    this._style = new Style2(Object.assign({}, options.style, {transition: {duration: 0}}), this);
    this._style.setEventedParent(this, {style: this._style});
    this._style.on('data', e => (e.dataType === "style") && this._style.update([], {transition: false}));
    this._nextRenderId = 0;
    this._canvas = document.createElement('canvas');
    this._canvas.style.imageRendering = 'pixelated';
    this._canvas.addEventListener('webglcontextlost', () => console.log("webglcontextlost"), false);
    this._canvas.addEventListener('webglcontextrestored', () => this._createGlContext(), false); 
    this._createGlContext();
    this.setResolution(DEFAULT_RESOLUTION, DEFAULT_BUFFER_ZONE_WIDTH);
    this._pendingRenders = {}; // coord.id => render state
    this._tilesInUse = {}; // coord.id => tile (note that tile's have a .uses counter)
    this._configId = 0; // for use with async config changes..see setXYZ methods below
  }

  get _source(){
    return this._style._source;
  }

  _transformRequest(url, resourceType) {
    return {url: url, headers: {}, credentials: ''};
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
    this._cancelAllPendingRenders();
    let configId = ++this._configId;
    return this._style.setPaintProperty(layer, prop, val)
      .then(() => {
        this._style.update([], {transition: false});
        return () => this._configId === configId;
      });
  }

  setFilter(layer, filter){
    // https://www.mapbox.com/mapbox-gl-js/style-spec/#types-filter
    this._cancelAllPendingRenders();
    let configId = ++this._configId;
    return this._style.setFilter(layer, filter)
      .then(() => {
        this._style.update([], {transition: false});
        return () => this._configId === configId;
      });
  }

  // takes an array of layer names to show
  setLayers(visibleLayers){
    this._cancelAllPendingRenders();
    let configId = ++this._configId;
    return this._style.setLayers(visibleLayers)
      .then(() => {
        this._style.update([], {transition: false});
        return () => this._configId === configId;
      });
  }

  getSuggestedBufferWidth(zoom){
    let visibleLayerTypes = new Set(this.getLayersVisible(zoom).map(lyr => this._style._layers[lyr].type));
    let suggestions = [];

    visibleLayerTypes.delete("circle") && suggestions.push(30);
    visibleLayerTypes.delete("symbol") && suggestions.push(30);
    visibleLayerTypes.delete('fill') && suggestions.push(0);
    visibleLayerTypes.delete('line') && suggestions.push(0);
    (visibleLayerTypes.size > 0) && console.warn('unknown types ignored');
    suggestions.some(x=>x!==suggestions[0]) && console.warn('clash of buffer width suggestions');
    return suggestions[0];
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
    this._cancelAllPendingRenders();
    return ++this._configId;
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
    this.transform.width = this._canvasSizeFull;
    this.transform.height = this._canvasSizeFull;
    this.painter.resize(this._canvasSizeFull, this._canvasSizeFull); 
    this._cancelAllPendingRenders();

    if(this._debugBufferEl){
      this._debugBufferEl.style.width = this._canvasSizeFull + 'px';
      this._debugBufferEl.style.height = this._canvasSizeFull + 'px';
    } 

    return ++this._configId;
  }

  _invalidateAllLoadedTiles(){
    // this needs to be called on all changes: style, layers visible, resolution (i.e. zoom)
    // by removing the loadedPromise, we force a fresh load next time the tile
    // is needed...although note that "fresh" is only partial because the rawData
    // is still available.
    for(var id in this._tilesInUse){
      this._tilesInUse[id].loadedPromise = null;
    }
    this._tileCache.keys().forEach(id => 
      this._tileCache.getWithoutRemoving(id).loadedPromise = null);
  }

  _cancelAllPendingRenders(){ 
    for(var id in this._pendingRenders){
      var state = this._pendingRenders[id];
      while(state.callbacks.length){
        state.callbacks.shift().func("canceled");
        this._decrementTileUses(state.tile);
      }
      clearTimeout(state.timeout);
    }
    this._pendingRenders = {};
    this._invalidateAllLoadedTiles();
  }

  _decrementTileUses(tile){
    tile.uses--;
    if(tile.uses > 0){
      return;
    }
    delete this._tilesInUse[tile.coord.id];
    if(tile.hasData()){
      // this tile is worth keeping...
      this._tileCache.add(tile.coord.id, tile);
    } else {
      // this tile isn't ready and isn't needed, so abandon it...
      this._source.abortTile(tile);
      this._source.unloadTile(tile);
    }
  }

  releaseRender(renderRef, state){
    this._decrementTileUses(this._tilesInUse[renderRef.coordId]);

    var state = Object.values(this._pendingRenders)
                      .find(state => state.renderId === renderRef.id);
    if(!state){
      return; // tile was already rendered
    } 
    
    renderRef.callback.func("canceled");
    var idx = state.callbacks.indexOf(renderRef.callback);
    (idx !== -1) && state.callbacks.splice(idx,1); 
    if(state.callbacks.length === 0){
      // we no longer need to render
      clearTimeout(state.timeout);
      delete this._pendingRenders[state.id];
    }
    
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
      // this tile is already pending render, so we don't need to do much...
      state.tile.uses++;
      state.callbacks.push(callback);
      return {id: state.renderId, callback: callback, coordId: id};
    }

    // We need to create a pending render and possibly create & load a new tile...
    var tile = this._tilesInUse[id] ||
               this._tileCache.get(id) || // note this removes it from the cache if it exists
               new Tile(coord.wrapped(), this._resolution, z);
    tile.uses++;
    this._tilesInUse[id] = tile;
    var renderId = ++this._nextRenderId;
    state = this._pendingRenders[id] = {
      id: id,
      callbacks: [callback],
      tile: tile,
      coord: coord,
      renderId: renderId,
      timeout: setTimeout(() => {
        delete this._pendingRenders[coord.id];
        while(state.callbacks.length){
          state.callbacks.shift().func("timeout");
        }
      }, TILE_LOAD_TIMEOUT)
    };   

    if(!state.tile.loadedPromise){
      // We need to actually issue the load request...
      state.tile.loadedPromise = new Promise((res, rej) => 
        this._source.loadTile(state.tile, err => err ? rej(err) : res()));
    }

    // once the tile is loaded we can then execute the pending render for it...
    state.tile.loadedPromise.then(() => {
      state = this._pendingRenders[id];
      if(!state || state.renderId !== renderId){
        return; // render for this tile has been canceled, or superceded.
      }
      this.transform.zoom = z;
      this.transform.tileZoom = z;
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
              // convert from [-bufferZoneWidth, resolution+bufferZoneWidth] to [0, canvasSizeInner]
              // Note that requesting pixels from inside the buffer region is a special case, 
              // and has to be dealt with very carefully, using src[Left|Right|Top|Bottom]Extra....
              let srcLeft = Math.max(0, cb.drawImageSpec.srcLeft-xx);
              let srcRight = Math.min(this._canvasSizeInner, cb.drawImageSpec.srcLeft + cb.drawImageSpec.srcWidth -xx);
              let srcLeftExtra = cb.drawImageSpec.srcLeft < 0 && xx === 0 ? Math.max(cb.drawImageSpec.srcLeft, -this._bufferZoneWidth) : 0;
              let srcRightExtra = cb.drawImageSpec.srcLeft + cb.drawImageSpec.srcWidth > this._resolution ?
                                     Math.max(this._bufferZoneWidth, cb.drawImageSpec.srcLeft + cb.drawImageSpec.srcWidth - this._resolution) : 0;
              
              let srcTop = Math.max(0, cb.drawImageSpec.srcTop-yy);
              let srcBottom = Math.min(this._canvasSizeInner, cb.drawImageSpec.srcTop + cb.drawImageSpec.srcHeight -yy);
              let srcTopExtra = cb.drawImageSpec.srcTop < 0 && yy === 0 ? Math.max(cb.drawImageSpec.srcTop, -this._bufferZoneWidth) : 0;
              let srcBottomExtra = cb.drawImageSpec.srcTop + cb.drawImageSpec.srcHeight > this._resolution ?
                                     Math.max(this._bufferZoneWidth, cb.drawImageSpec.srcTop + cb.drawImageSpec.srcHeight - this._resolution) : 0;

              cb.ctx.drawImage( 
                this._canvas,
                srcLeft + srcLeftExtra + this._bufferZoneWidth, srcTop + srcTopExtra + this._bufferZoneWidth, 
                srcRight + srcRightExtra - (srcLeft + srcLeftExtra), srcBottom + srcBottomExtra - (srcTop + srcTopExtra), 
                cb.drawImageSpec.destLeft + ((xx > cb.drawImageSpec.srcLeft) && (xx - cb.drawImageSpec.srcLeft + srcLeftExtra)) |0,
                cb.drawImageSpec.destTop + ((yy > cb.drawImageSpec.srcTop) && (yy - cb.drawImageSpec.srcTop + srcTopExtra))|0,
                srcRight +srcRightExtra - (srcLeft + srcLeftExtra), srcBottom + srcBottomExtra - (srcTop + srcTopExtra))

          });
        } // yy
      } // xx
      
      this._style._currentCoord = null;
      this._style._currentTile = null;

      while(state.callbacks.length){
        state.callbacks.shift().func();
      }
      clearTimeout(state.timeout);
      delete this._pendingRenders[id];
    })
    .catch(err => {
      state = this._pendingRenders[id];
      if(!state || state.renderId !== renderId){
        return; // render for this tile has been canceled, or superceded.
      }
      while(state.callbacks.length){
        state.callbacks.shift().func(err);
      }
      clearTimeout(state.timeout);
      delete this._pendingRenders[id];
      this._source.unloadTile(state.tile);
    });

    return {id: state.renderId, callback: callback, coordId: id};
  }

  latLngToTileCoords(opts){
    let tileXY = sphericalMercator.px([opts.lng, opts.lat], opts.tileZ, false)
                                  .map(x=>x/256 /* why 256? */);
    let pointXY = tileXY.map(x => (x - (x|0)) * opts.extent);
    return {
      tileX: tileXY[0] |0,
      tileY: tileXY[1] |0,
      tileZ: opts.tileZ,
      pointX: pointXY[0],
      pointY: pointXY[1]
    }
  }

  queryRenderedFeatures(opts){
    let layers = {};
    this.getLayersVisible(opts.renderedZoom)
        .forEach(lyr => layers[lyr] = this._style._layers[lyr]);

    let p = this.latLngToTileCoords(Object.assign({extent: EXTENT}, opts));

    // collect the coordinates of the tile containing the given point, plus any with an overlapping buffer region
    let coords = []; 
    let bufferSize = this._bufferZoneWidth/this._resolution * EXTENT; // measured in the same units as pointXY
    coords.push(new TileCoord(p.tileZ, p.tileX, p.tileY, 0));
    // consider including the left, right, top, bottom adjacent tiles (if the point is near to the given edge)
    (p.pointX<bufferSize)        && coords.push(new TileCoord(p.tileZ, p.tileX-1, p.tileY, 0));
    (p.pointX>EXTENT-bufferSize) && coords.push(new TileCoord(p.tileZ, p.tileX+1, p.tileY, 0));
    (p.pointY<bufferSize)        && coords.push(new TileCoord(p.tileZ, p.tileX, p.tileY-1, 0));
    (p.pointY>EXTENT-bufferSize) && coords.push(new TileCoord(p.tileZ, p.tileX, p.tileY+1, 0));
    // and consider including the 4 corner adjacent tiles (again, if the point is near the given corner)
    (p.pointX<bufferSize && p.pointY<bufferSize)        && coords.push(new TileCoord(p.tileZ, p.tileX-1, p.tileY-1, 0));
    (p.pointX<bufferSize && p.pointY>EXTENT-bufferSize) && coords.push(new TileCoord(p.tileZ, p.tileX-1, p.tileY+1, 0));
    (p.pointX>EXTENT - bufferSize && p.pointY<bufferSize)        && coords.push(new TileCoord(p.tileZ, p.tileX+1, p.tileY-1, 0));
    (p.pointX>EXTENT - bufferSize && p.pointY>EXTENT-bufferSize) && coords.push(new TileCoord(p.tileZ, p.tileX+1, p.tileY+1, 0));
    
    // prepare the fake tileCache
    let tilesIn = coords
      .map(c => ({
        tile: this._tilesInUse[c.id],
        coord: c,
        queryGeometry: [[Point.convert([
          // for all but the 0th coord, we need to adjust the pointXY values to lie suitably outside the [0,EXTENT] range
          p.pointX + EXTENT*(p.tileX-c.x),  
          p.pointY + EXTENT*(p.tileY-c.y),
        ])]],
        scale: 1
      }))
      .filter(x => x.tile && x.tile.hasData()); // we are a bit lazy in terms of ensuring the data matches the rendered styles etc. 
    let sourceCache = Object.create(this._style.sourceCaches.landinsight);
    sourceCache.tilesIn = () => tilesIn;

    let featuresByRenderLayer = QueryFeatures.rendered(
      sourceCache,
      layers, 
      null /* query geometry is pre-specified in tilesIn */, 
      {circleFudgeExtraPx: 5}, opts.tileZ, 0);
      
    let featuresBySourceLayer = {};
    Object.keys(featuresByRenderLayer)
      .forEach(renderLayerName => 
        featuresByRenderLayer[renderLayerName].map(renderLayerFeatures => {
          let lyr = featuresBySourceLayer[renderLayerFeatures.layer['source-layer']]
                  = (featuresBySourceLayer[renderLayerFeatures.layer['source-layer']] || []);
          lyr.push(renderLayerFeatures._vectorTileFeature.properties)
        }));    
    return featuresBySourceLayer;
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