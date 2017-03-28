const Transform = require('./geo/transform');
const Painter = require('./render/painter');

function MapboxSingleTile(options) {
  options = options || {};
  this._transform = new Transform(options.minZoom, options.maxZoom, options.renderWorldCopies);
  this._canvas = document.createElement('canvas');
  this._canvas.width = 512;
  this._canvas.height = 512;
  this._initOptions = options;
  this._canvas.addEventListener('webglcontextlost', () => console.log("webglcontextlost"), false);
  this._canvas.addEventListener('webglcontextrestored', () => this._createGlContext(), false); 
  this._createGlContext();
}


MapboxSingleTile.prototype.showCanvasForDebug = function(){
  document.body.appendChild(this._canvas);
  this._canvas.style.position = "fixed";
  this._canvas.style.top = "20px";
  this._canvas.style.right = "20px";
  this._canvas.style.border = "1px solid red";
}

MapboxSingleTile.prototype._createGlContext = function(){
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
}


MapboxSingleTile.prototype.renderTile = function(z, x, y, options, cb){
  this._painter.render(this.style, {
    showTileBoundaries: this._initOptions.showTileBoundaries,
    showOverdrawInspector: this._initOptions.showOverdrawInspector
  });
  cb(null);
}

export default MapboxSingleTile;