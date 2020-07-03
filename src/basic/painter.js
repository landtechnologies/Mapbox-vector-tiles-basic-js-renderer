const Painter = require('../render/painter');

var layerStylesheetFromLayer = layer => layer && layer._eventedParent.stylesheet.layers.find(x=>x.id===layer.id);

class BasicPainter extends Painter {
  constructor(gl, transform){
    super(gl, transform);
    this._filterForZoom = 15;
  }
  resize(width, height) {
    const gl = this.context.gl;
    this.width = width;
    this.height = height;
    gl.viewport(0, 0, this.width, this.height);
  }
  renderLayer(painter, sourceCache, layer, coords) {
    let layerStylesheet = layerStylesheetFromLayer(layer);
    if (layerStylesheet && layerStylesheet.minzoom_ && coords[0].overscaledZ < layerStylesheet.minzoom_) return;
    if (layerStylesheet && layerStylesheet.maxzoom_ && coords[0].overscaledZ >= layerStylesheet.maxzoom_) return;
    super.renderLayer(painter, sourceCache, layer, coords);
  }
};

module.exports = BasicPainter;