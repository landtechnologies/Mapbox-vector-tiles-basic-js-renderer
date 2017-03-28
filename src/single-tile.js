const Transform = require('./geo/transform');
const Painter = require('./render/painter');
const Style = require('./style/style');
const Camera = require('./ui/camera');

const SIZE = 512;

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
    this._canvas.width = SIZE;
    this._canvas.height = SIZE;

    this._transform.resize(SIZE, SIZE);
    this._canvas.addEventListener('webglcontextlost', () => console.log("webglcontextlost"), false);
    this._canvas.addEventListener('webglcontextrestored', () => this._createGlContext(), false); 
    this._createGlContext();
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
    this._painter = new Painter(this._gl, this._transform);
    this._painter.resize(SIZE, SIZE);
  }


  renderTile(z, x, y, options, cb){
    // TODO: use x and y properly...
    this.jumpTo({
      center: m.map.getCenter().toJSON(),  //{Lat:, Lng: }
      zoom: z || 15
    });

    this._style._updateSources(this._transform);

    this._painter.render(this._style, {
      showTileBoundaries: this._initOptions.showTileBoundaries,
      showOverdrawInspector: this._initOptions.showOverdrawInspector
    });
    cb && cb(null);
  }

}

export default MapboxSingleTile;