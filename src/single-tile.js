const Transform = require('./geo/transform'),
      Painter = require('./render/painter'),
      Style = require('./style/style'),
      Camera = require('./ui/camera'),
      TileCoord = require('./source/tile_coord'),
      EXTENT = require('./data/extent'),
      glmatrix = require('@mapbox/gl-matrix');

const mat4 = glmatrix.mat4;

const SIZE = 256;

class MapboxSingleTile extends Camera {

  constructor(options) {
    var transform =  new Transform(options.minZoom, options.maxZoom, options.renderWorldCopies);
    options = options || {};
    super(transform, options);  
    transform.calculatePosMatrix = this._transform_calculatePosMatrix.bind(transform);
    this._transform = transform;
    this._initOptions = options;
    this._style = new Style(options.style, this);
    this._style.setEventedParent(this, {style: this._style});
    this._canvas = document.createElement('canvas');
    this._canvas.width = SIZE;
    this._canvas.height = SIZE;

    this._transform.resize(SIZE, SIZE);
    this._canvas.addEventListener('webglcontextlost', () => console.log("webglcontextlost"), false);
    this._canvas.addEventListener('webglcontextrestored', () => this._createGlContext(), false); 
    this._createGlContext();
    this._sourceCaches = this._style.sourceCaches
    this._renderingTiles = {};
  }

  _transform_calculatePosMatrix(tileCoord, maxZoom) {
    // override for this._transform.calculatePosMatrix (patched in constructor, above)
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
    this.painter.resize(SIZE, SIZE);
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
    this.applyStyles(z); // TODO: only do this if zoom has changed      
    this.painter.render(this._style, {
      showTileBoundaries: this._initOptions.showTileBoundaries,
      showOverdrawInspector: this._initOptions.showOverdrawInspector
    });

    while(state.callbacks.length){
      var ret = document.createElement('canvas');
      ret.width = SIZE;
      ret.height = SIZE;
      ret.getContext('2d').drawImage(this._canvas, 0, 0);
      state.callbacks.shift()(ret);
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
    this._initSourcesCaches();

    this.jumpTo({ zoom: z }); // TODO: work out why this is still needed
    
    var coords = new TileCoord(z, x, y, 0);
    if(this._renderingTiles[coords.id]){
      next && this._renderingTiles[coords.id].callbacks.push(next);
      return;
    }

    var state = this._renderingTiles[coords.id] = {
      callbacks: [next],
      awaitingSources: 0
    };
    for(var k in this._sourceCaches){
      var tile = this._sourceCaches[k].addTile(coords);
      !tile.hasData() && state.awaitingSources++;
    }
    if(state.awaitingSources == 0){
      this._renderTileNowDataIsAvailable({coord: coords});
    }
    
  }

}

export default MapboxSingleTile;