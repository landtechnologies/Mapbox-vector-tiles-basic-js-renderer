/*
  This is basically a plugin for mapbox-gl.
  Asside from the constructor, it provides one main method:

  renderTile(z, x, y, options, callback)
  
  The callback is provided with a canvas which has the given
  tile rendered to it, filling the entire canvas.
  It should consume the image immediately, ie. by using
  drawImage onto a new canvas, as there is no guarantee of
  the lifetime of the image on the canvas.

  The options provided to render tile have the following optional fields:
    size - the width/height in pixels of the rendered result. This is
           needed for customizing resolution of rendering..it's best to
           ask for it rendered at the resolution you are going to use it at,
           though you could do it smaller/larger if you really want.

  ==========================================
  Notes on development:

  At the point renderTile is called, the given tile can be in one of several states:
      1. Never previously mentioned (or long forgotten about).
         So need to load data from source(s) before rendering.
      2. Recently requested, but not ready yet (i.e. in _pendingRenders)
        a. Requested with the same options as this request
        b. Requested with different options to this request
      3. Recently rendered, with resulting image cached for the correct options.
      4. Previously requested, but image not cached (with correct options).  However
        data is still available, so no need to wait for data before rendering.

  The property _renderedTileCache is a Least-Recently-Used cache that maps from
  <coord.id + JSON.stringify(options)> to single canvases.

  The property _pendingRenders maps from <coord.id> to an object that contains a "variants" field, which
  is a map from <JSON.stringify(options)> to options/callbacks.  Note this is not a cache; things are
  removed from the _pendingRenders only when the rendering is completed (at which point they are added
  to _renderedTileCache).

*/

const Transform = require('./geo/transform'),
      Painter = require('./render/painter'),
      Style = require('./style/style'),
      Camera = require('./ui/camera'),
      TileCoord = require('./source/tile_coord'),
      EXTENT = require('./data/extent'),
      glmatrix = require('@mapbox/gl-matrix'),
      Cache = require('./util/lru_cache');

const mat4 = glmatrix.mat4;

const DEFAULT_SIZE = 256;
const DEFAULT_CACHE_SIZE = 10;

class MapboxSingleTile extends Camera {

  constructor(options) {
    var transform =  new Transform(options.minZoom, options.maxZoom, options.renderWorldCopies);
    options = options || {};
    super(transform, options);  
    this._transform = transform;
    this._initOptions = options;
    this._style = new Style(options.style, this);
    this._style.setEventedParent(this, {style: this._style});
    this._canvas = document.createElement('canvas');
    this._canvas.addEventListener('webglcontextlost', () => console.log("webglcontextlost"), false);
    this._canvas.addEventListener('webglcontextrestored', () => this._createGlContext(), false); 
    this._createGlContext();
    this._setSize(DEFAULT_SIZE);
    this._sourceCaches = this._style.sourceCaches
    this._pendingRenders = {};
    this._useCache = options.cacheSize !== 0;
    this._useCache && (this._renderedTileCache = new Cache(options.cacheSize || DEFAULT_CACHE_SIZE));
  }

  _setSize(s){
    if(s == this._size){
      return;
    }
    this._size = s;
    this._canvas.width = s;
    this._canvas.height = s;
    this._transform.resize(s, s);   
    this.painter.resize(s, s); 
  }

  _calculatePosMatrix(tileCoord) {
    const S = 4092; // I think this is the size of the tile in its own coordiante scheme, not sure why we have to x2
    const posMatrix = mat4.identity(new Float64Array(16));
    mat4.scale(posMatrix, posMatrix, [1/S,-1/S,1]);
    mat4.translate(posMatrix, posMatrix, [-S,-S,0]);
    return new Float32Array(posMatrix);
  }

  showCanvasForDebug(){
    document.body.appendChild(this._canvas);
    this._canvas.style.position = "fixed";
    this._canvas.style.top = "20px";
    this._canvas.style.right = "20px";
    this._canvas.style.background = "#ccc";
    this._canvas.style.border = "1px solid red";
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
    this.painter = new Painter(this._gl, this._transform);
    this.painter.style = this._style;
  }

  applyStyles(z) {
    // alternative to style.js@_recalculate
    for (const sourceId in this._sourceCaches){
      this._sourceCaches[sourceId].used = false;
    }
    for(var layerId of this._style._order){
      const layer = this._style._layers[layerId];
      layer.recalculate(z);
      if (!layer.isHidden(z) && layer.source) {
        this._sourceCaches[layer.source].used = true;
      }
    }
    this._style._applyClasses([], {transition: false});
  }

  _renderTileNowDataIsAvailable(e){
    var state = this._pendingRenders[e.coord.id];
    if(--state.awaitingSources > 0){
      return;
    }
    delete this._pendingRenders[e.coord.id];

    var z = e.coord.z;
    this.applyStyles(z); // TODO: only do this if zoom has changed      

    for (var variantKey in state.variants){
      var options = state.variants[variantKey].options;
      var callbacks = state.variants[variantKey].callbacks;
      var size = options.size || DEFAULT_SIZE;
      e.coord.posMatrix = this._calculatePosMatrix(e.coord);
      for(var k in this._sourceCaches){
        this._sourceCaches[k].getVisibleCoordinates = () => [e.coord];
      }
      this._setSize(size);
      this.painter.render(this._style, {
        showTileBoundaries: this._initOptions.showTileBoundaries,
        showOverdrawInspector: this._initOptions.showOverdrawInspector
      });
      
      // copy the canvas into cache (if required)
      var returnCanvas;
      if(this._useCache){
        returnCanvas = document.createElement('canvas');
        returnCanvas.width = size;
        returnCanvas.height = size;
        console.time("drawImage " + e.coord.id + variantKey);
        returnCanvas.getContext('2d').drawImage(this._canvas, 0, 0);
        console.timeEnd("drawImage " + e.coord.id + variantKey);
        this._renderedTileCache.add(e.coord.id + variantKey, returnCanvas);        
      } else {
        returnCanvas = this._canvas
      }

      // return a reference to the cached/main canvas
      // note that recipient must make use of it immediately,
      // i.e. by calling drawImage to a new canvas.
      while(callbacks.length){
        callbacks.shift()(returnCanvas);
      }

    }
  }
  
  _initSourcesCaches(){
    if(this._initSourcesCachesDone){
      return;
    }
    for(var k in this._sourceCaches){
      this._sourceCaches[k]._coveredTiles = {};
      this._sourceCaches[k].transform = this._transform;
      this._sourceCaches[k].on('data', this._renderTileNowDataIsAvailable.bind(this));
    }
    this._initSourcesCachesDone = true;
  }

  renderTile(z, x, y, options, next){
    // see note at top of file for explanaiton of the 4 "states" a tile can be in

    this._initSourcesCaches();
    this.jumpTo({ zoom: z }); // TODO: work out why this is still needed..might be to do with if layer should be shown

    var coord = new TileCoord(z, x, y, 0);    
    options = options || {};
    var variantKey = JSON.stringify(options);
    
    // Deal with state (3).
    if(this._useCache && this._renderedTileCache.has(coord.id + variantKey)){
      return next(this._renderedTileCache.get(coord.id + variantKey));
    }

    // Deal with state (2).
    if(this._pendingRenders[coord.id]){
      if(this._pendingRenders[coord.id].variants[variantKey]){
        this._pendingRenders[coord.id].variants[variantKey].callbacks.push(next);
      } else {
        this._pendingRenders[coord.id].variants[variantKey] = {
          options: options,
          callbacks: [next]
        }
      }
      return;
    }


    var state = this._pendingRenders[coord.id] = {
      awaitingSources: 0,
      variants: {}
    };
    state.variants[variantKey] = {
      options: Object.assign({}, options), // should just be a shallow object, so simply clone is ok
      callbacks: [next]
    };

    for(var k in this._sourceCaches){
      var tile = this._sourceCaches[k].addTile(coord); 
      !tile.hasData() && state.awaitingSources++;
      // if tile.hasData() is false, the .addTile call above will ultimately lead to state (1) being dealt with.
    }

    // Deal with state (4).
    if(state.awaitingSources == 0){
      this._renderTileNowDataIsAvailable({coord: coord});
    }
    
  }

}

export default MapboxSingleTile;