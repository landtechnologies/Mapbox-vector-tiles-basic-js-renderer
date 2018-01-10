const BasicPainter = require('./painter'),
      BasicStyle = require('./style'),
      EXTENT = require('../data/extent'),
      Evented = require('../util/evented'),
      {OverscaledTileID} = require('../source/tile_id'),
      {mat4} = require('@mapbox/gl-matrix'),
      Source = require('../source/source'),
      Tile = require('../source/tile'),
      Point = require('point-geometry'),
      QueryFeatures = require('../source/query_features'),
      SphericalMercator = require('@mapbox/sphericalmercator'),
      EvaluationParameters = require('../style/evaluation_parameters'),
      Placement = require('../symbol/placement');

window.BasicStyle = BasicStyle;
var sphericalMercator = new SphericalMercator();

const DEFAULT_RESOLUTION = 256;
const TILE_LOAD_TIMEOUT = 60000;
const MAX_RENDER_SIZE = 1024; // for higher resolutions, we render in sections
const DEFAULT_BUFFER_ZONE_WIDTH = 0;

var layerStylesheetFromLayer = layer => layer && layer._eventedParent.stylesheet.layers.find(x=>x.id===layer.id);


class MapboxBasicRenderer extends Evented {

  constructor(options) {
    super();
    this._initOptions = options = options || {}; 
    this.transform = {
      zoom: 0, angle: 0, pitch: 0, _pitch: 0, scaleZoom: ()=> 0,
      cameraToCenterDistance: 1, cameraToTileDistance: () => 1 , clone: () => this.transform};
    this._style = new BasicStyle(Object.assign({}, options.style, {transition: {duration: 0}}), this);
    this._style.setEventedParent(this, {style: this._style});
    this._style.on('data', e => (e.dataType === "style") && this._style.update(new EvaluationParameters(16, {transition: false, fadeDuration: 0})));
    this._nextRenderId = 0;
    this._canvas = document.createElement('canvas');
    this._canvas.style.imageRendering = 'pixelated';
    this._canvas.addEventListener('webglcontextlost', () => console.log("webglcontextlost"), false);
    this._canvas.addEventListener('webglcontextrestored', () => this._createGlContext(), false); 
    this._createGlContext();
    this.setResolution(DEFAULT_RESOLUTION, DEFAULT_BUFFER_ZONE_WIDTH);
    this._pendingRenders = {}; // tileID.key => render state
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
    this.painter = new BasicPainter(this._gl, this.transform);
    this.painter.style = this._style;
  }

  setPaintProperty(layer, prop, val){
    this._cancelAllPendingRenders();
    let configId = ++this._configId;
    return this._style.setPaintProperty(layer, prop, val)
      .then(() => {
        this._style.update(new EvaluationParameters(16, {transition: false, fadeDuration: 0}));
        return () => this._configId === configId;
      });
  }

  setFilter(layer, filter){
    // https://www.mapbox.com/mapbox-gl-js/style-spec/#types-filter
    this._cancelAllPendingRenders();
    let configId = ++this._configId;
    return this._style.setFilter(layer, filter)
      .then(() => {
        this._style.update(new EvaluationParameters(16, {transition: false, fadeDuration: 0}));
        return () => this._configId === configId;
      });
  }
 
  // takes an array of layer names to show
  setLayers(visibleLayers){
    this._cancelAllPendingRenders();
    let configId = ++this._configId;
    return this._style.setLayers(visibleLayers)
      .then(() => {
        this._style.update(new EvaluationParameters(16, {transition: false, fadeDuration: 0}));
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

  _cancelAllPendingRenders(){ 
    Object.keys(this._pendingRenders).forEach(k => this._finishRender(k, "canceled"))
    this._pendingRenders = {};
    Object.values(this._style.sourceCaches).forEach(s => s.invalidateAllLoadedTiles());
  }

  releaseRender(renderRef, state){
    // call this when the rendered thing is no longer on screen (it could happen long after the render finishes, or before it finishes).
    
    Object.keys(renderRef.tiles).forEach(k =>
      this._style.sourceCaches[k].releaseTile(renderRef.tiles[k]));
    
    let state = Object.values(this._pendingRenders)
                      .find(state => state.renderId === renderRef.id);
    if(!state){
      return; // tile was already rendered
    } 
    
    renderRef.consumer.next("canceled");
    let idx = state.consumers.indexOf(renderRef.consumer);
    (idx !== -1) && state.consumers.splice(idx,1); 

    // if there are no consumers left then clean-up the render
    (state.consumers.length === 0) && this._finishRender(state.tileGroupID, "fully-canceled");    
  }

  _finishRender(tileGroupID, err){ 
    let state = this._pendingRenders[tileGroupID];
    if(!state || state.renderId !== renderId){
      return; // render for this tile has been canceled, or superceded.
    }
    while(state.consumers.length){
      state.consumers.shift().next(err);
    }
    clearTimeout(state.timeout);
    delete this._pendingRenders[tileGroupID];
    
    if(err){
      Object.keys(state.tiles).forEach(k => this._style.sourceCaches[k].releaseTile(state.tiles[k])); 
    } // if the render is successful, then the parent is responsible for calling releaseRender at some point in order to releaseTiles
  }

  renderTile(ctx, destSpec, sourceSpec, next){
    let consumer = {ctx, destSpec, sourceSpec, next};

    // need to filter sourceSpec based on which source layers we actually need with the current settings
    // note that each consumer adds an extra use++ to each source tile of relevance,
    // and this must be decremented when either the render fails or when the rendered output is no
    // longer on screen (the latter case must be dealt with explicitly by the caller).

    // prepare the tileIDs map from sourceName=>tile, and its string hash, tileGroupID
    let tileIDs = {};
    Object.keys(sourceSpec).forEach(k => {
      let spec = sourceSpec[k]; 
      tileIDs[k] = new OverscaledTileID(spec.z, 0, spec.z, spec.x, spec.y, 0);
    });
    let tileGroupID = Object.keys(tileIDs).sort()
      .map(k => k + tileIDs[k].key)
      .join("");

    // See if the tile group is already pending render, if so we don't need to do much...
    let state = this._pendingRenders[tileGroupID];
    if(state){
      Object.values(state.tiles).forEach(t => t.uses++);
      state.consumers.push(consumer);
      return {id: state.renderId, consumer, state.tiles};
    }

    // Unfortunately we need to create a new pending render (which may include creating & loading new tiles)...
    let renderId = ++this._nextRenderId;
    let tiles = {};
    Object.keys(sourceSpec).forEach(k => {
      let spec = sourceSpec[k];
      tiles[k] = this._style.sourceCaches[k].getTile(tileIDs[k].key); // includes .uses++
    });
    state = this._pendingRenders[tileGroupID] = {
      tileGroupID,
      tiles,
      renderId,
      consumers: [consumer],
      timeout: setTimeout(() => this._finishRender(tileGroupID, "timeout"), TILE_LOAD_TIMEOUT)
    };   

    // once all the tiles are loaded we can then execute the pending render...
    Promise.all(Object.values(tiles).map(t => t.loadedPromise)).then(() => {

      state = this._pendingRenders[tileGroupID];
      if(!state || state.renderId !== renderId){
        return; // render for this tileGroupID has been canceled, or superceded.
      }

      // This needs to be source-specific!!
      this.transform.zoom = z; 
      this.transform.tileZoom = z;
      
      Object.values(state.tiles).forEach(t => t.tileSize = this._resolution);
      Object.keys(state.tiles).forEach(k => this._style.sourceCaches[k].setCurrentlyRenderingTile(state.tiles[k]));

      for(var xx=0; xx<this._resolution; xx+= this._canvasSizeInner){
        for(var yy=0; yy<this._resolution; yy+=this._canvasSizeInner){
          // need to figure this out!!
          var relevantConsumers = state.consumers.filter(cb =>
            cb.drawImageSpec.srcLeft + cb.drawImageSpec.srcWidth > xx &&
            cb.drawImageSpec.srcLeft < xx + this._canvasSizeInner &&
            cb.drawImageSpec.srcTop + cb.drawImageSpec.srcHeight > yy && 
            cb.drawImageSpec.srcTop < yy + this._canvasSizeInner);
          if(relevantConsumers.length === 0){
            continue;
          }

          Object.values(state.tiles).forEach(t => t.tileID.posMatrix = this._calculatePosMatrix(xx, yy));
          this.painter.render(this._style, {showTileBoundaries: false, showOverdrawInspector: false});

          relevantConsumers.forEach(cb => {
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
      
      Object.keys(state.tiles).forEach(k => this._style.sourceCaches[k].setCurrentlyRenderingTile(null));

      while(state.consumers.length){
        state.consumers.shift().next();
      }
      clearTimeout(state.timeout);
      delete this._pendingRenders[tileGroupID];
    })
    .catch(err => this._finishRender(tileGroupID, err));

    return {id: state.renderId, consumer, tiles};
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
    return {};

    let layers = {};
    this.getLayersVisible(opts.renderedZoom)
        .forEach(lyr => layers[lyr] = this._style._layers[lyr]);

    let p = this.latLngToTileCoords(Object.assign({extent: EXTENT}, opts));

    // collect the coordinates of the tile containing the given point, plus any with an overlapping buffer region
    let tileIDs = []; 
    let bufferSize = this._bufferZoneWidth/this._resolution * EXTENT; // measured in the same units as pointXY
    tileIDs.push(new OverscaledTileID(p.tileZ, 0, p.tileZ, p.tileX, p.tileY, 0));
    // consider including the left, right, top, bottom adjacent tiles (if the point is near to the given edge)
    (p.pointX<bufferSize)        && tileIDs.push(new OverscaledTileID(p.tileZ, 0, p.tileZ, p.tileX-1, p.tileY, 0));
    (p.pointX>EXTENT-bufferSize) && tileIDs.push(new OverscaledTileID(p.tileZ, 0, p.tileZ, p.tileX+1, p.tileY, 0));
    (p.pointY<bufferSize)        && tileIDs.push(new OverscaledTileID(p.tileZ, 0, p.tileZ, p.tileX, p.tileY-1, 0));
    (p.pointY>EXTENT-bufferSize) && tileIDs.push(new OverscaledTileID(p.tileZ, 0, p.tileZ, p.tileX, p.tileY+1, 0));
    // and consider including the 4 corner adjacent tiles (again, if the point is near the given corner)
    (p.pointX<bufferSize && p.pointY<bufferSize)        && tileIDs.push(new OverscaledTileID(p.tileZ, 0, p.tileZ, p.tileX-1, p.tileY-1, 0));
    (p.pointX<bufferSize && p.pointY>EXTENT-bufferSize) && tileIDs.push(new OverscaledTileID(p.tileZ, 0, p.tileZ, p.tileX-1, p.tileY+1, 0));
    (p.pointX>EXTENT - bufferSize && p.pointY<bufferSize)        && tileIDs.push(new OverscaledTileID(p.tileZ, 0, p.tileZ, p.tileX+1, p.tileY-1, 0));
    (p.pointX>EXTENT - bufferSize && p.pointY>EXTENT-bufferSize) && tileIDs.push(new OverscaledTileID(p.tileZ, 0, p.tileZ, p.tileX+1, p.tileY+1, 0));
    
    // prepare the fake tileCache
    let tilesIn = tileIDs
      .map(c => ({
        tile: this._tilesInUse[c.key],
        tileID: c,
        queryGeometry: [[Point.convert([
          // for all but the 0th coord, we need to adjust the pointXY values to lie suitably outside the [0,EXTENT] range
          p.pointX + EXTENT*(p.tileX-c.canonical.x),  
          p.pointY + EXTENT*(p.tileY-c.canonical.y),
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
      {}, opts.tileZ, 0);
      
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

module.exports =  MapboxBasicRenderer;