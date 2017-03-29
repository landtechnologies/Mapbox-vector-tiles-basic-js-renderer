const Transform = require('./geo/transform'),
      Painter = require('./render/painter'),
      Style = require('./style/style'),
      Camera = require('./ui/camera'),
      TileCoord = require('./source/tile_coord'),
      EXTENT = require('./data/extent'),
      glmatrix = require('@mapbox/gl-matrix');

const mat4 = glmatrix.mat4;

const SIZE = 512;

window.mat4 = mat4;

mat4.str = function(a) { // better than version in gl-matrix src..and don't need to worry about minification
    return 'mat4('     + a.slice(0,4).join("  ") + 
            "\n      " + a.slice(4,8).join("  ") + 
            "\n      " + a.slice(8,12).join("  ") +
            "\n      " + a.slice(12,16).join("  ") + ')';
}

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

  }

  _transform_calculatePosMatrix(tileCoord, maxZoom) {
    // override for this._transform.calculatePosMatrix (patched in constructor, above)
    const S = 4092; // I think this is the size of the tile in its own coordiante scheme, not sure why we have to x2
    const posMatrix = mat4.identity(new Float64Array(16));
    mat4.scale(posMatrix, posMatrix, [1.8/(2*S),-1.8/(2*S),1]); // TODO: change 1.8 to 2
    mat4.translate(posMatrix, posMatrix, [-S,-S,0]);
    return new Float32Array(posMatrix);
  }

  showCanvasForDebug(){
    document.body.appendChild(this._canvas);
    this._canvas.style.position = "fixed";
    this._canvas.style.top = "20px";
    this._canvas.style.right = "20px";
    this._canvas.style.border = "1px solid red";
    this._canvas.style.background = "#666";
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
  }


  renderTile(z, x, y, options, cb){
    // TODO: use x and y properly...
    z = z || 15; x = x || 16370; y = y || 10900;
    
    this.jumpTo({
      center: m.map.getCenter().toJSON(),  //{Lat:, Lng: }
      zoom: z || 15
    });

    // TODO: remove  old tiles from cache
    for(var k in this._sourceCaches){
      this._sourceCaches[k]._coveredTiles = {};
      this._sourceCaches[k].transform = this._transform;
      this._sourceCaches[k].addTile(new TileCoord(z,x,y,0));
    }
    
    this.painter.render(this._style, {
      showTileBoundaries: this._initOptions.showTileBoundaries,
      showOverdrawInspector: this._initOptions.showOverdrawInspector
    });
    cb && cb(null);
  }

}

export default MapboxSingleTile;