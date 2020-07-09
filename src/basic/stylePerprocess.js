module.exports = function mvtStylePreprocess(style) {
  if (typeof style !== 'object') return;
  if (!Array.isArray(style.layers)) return;

  // minzoom/maxzoom to minzoom_/maxzoom_
  style.layers.forEach((layer) => {
    if (typeof layer.minzoom === 'number') {
      layer.minzoom_ = layer.minzoom
      delete layer.minzoom
    }
    if (typeof layer.maxzoom === 'number') {
      layer.maxzoom_ = layer.maxzoom
      delete layer.maxzoom
    }
  })

  // delete raster layer
  style.layers = style.layers.filter(l => {
   return l.type !== 'raster' && l.type !== 'background'
  })
}
