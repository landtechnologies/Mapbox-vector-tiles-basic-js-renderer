const Transform = require('./geo/transform'),
      Painter = require('./render/painter'),
      Style = require('./style/style'),
      Camera = require('./ui/camera'),
      TileCoord = require('./source/tile_coord'),
      EXTENT = require('./data/extent'),
      glmatrix = require('@mapbox/gl-matrix');

const mat4 = glmatrix.mat4;

const DEFAULT_SIZE = 256;

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
    this._renderingTiles = {};
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
    var state = this._renderingTiles[e.coord.id];
    if(--state.awaitingSources > 0){
      return;
    }
    delete this._renderingTiles[e.coord.id];

    var z = e.coord.z;

    for (var v in state.variants){
      var options = state.variants[v].options;
      var callbacks = state.variants[v].callbacks;
      var size = options.size || DEFAULT_SIZE;
      this.applyStyles(z); // TODO: only do this if zoom has changed      
      e.coord.posMatrix = this._calculatePosMatrix(e.coord);
      for(var k in this._sourceCaches){
        this._sourceCaches[k].getVisibleCoordinates = () => [e.coord];
      }

      this._setSize(size);
      this.painter.render(this._style, {
        showTileBoundaries: this._initOptions.showTileBoundaries,
        showOverdrawInspector: this._initOptions.showOverdrawInspector
      });
      while(callbacks.length){
        callbacks.shift()(this._canvas);
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
    /* 
    The tile can be in one of several states:
      1. Never previously mentioned (or long forgotten about).
         So need to load data from source(s) before rendering.
      2. Recently requested, but not ready yet (i.e. in _renderingTiles)
        a. Requested with the same options as this request
        b. Requested with different options to this request
      3. TODO: recently rendered, with resulting image cached for the correct options.
      4. Previously requested, but image not cached (with correct options).  However
        data is still available, so no need to wait for data before rendering.
    */

    this._initSourcesCaches();
    this.jumpTo({ zoom: z }); // TODO: work out why this is still needed..might be to do with if layer should be shown

    // Deal with state (2).
    var coords = new TileCoord(z, x, y, 0);    
    options = options || {};
    var optionsKey = JSON.stringify(options);
    if(this._renderingTiles[coords.id]){
      if(this._renderingTiles[coords.id].variants[optionsKey]){
        this._renderingTiles[coords.id].variants[optionsKey].callbacks.push(next);
      } else {
        this._renderingTiles[coords.id].variants[optionsKey] = {
          options: options,
          callbacks: [next]
        }
      }
      return;
    }


    var state = this._renderingTiles[coords.id] = {
      awaitingSources: 0,
      variants: {}
    };
    state.variants[optionsKey] = {
      options: Object.assign({}, options), // should just be a shallow object, so simply clone is ok
      callbacks: [next]
    };

    for(var k in this._sourceCaches){
      var tile = this._sourceCaches[k].addTile(coords); 
      !tile.hasData() && state.awaitingSources++;
      // if tile.hasData() is false, the .addTile call above will ultimately lead to state (1) being dealt with.
    }

    // Deal with state (4).
    if(state.awaitingSources == 0){
      this._renderTileNowDataIsAvailable({coord: coords});
    }
    
  }

}

export default MapboxSingleTile;