const Style = require('../style/style'),
      Source = require('../source/source'),
      Placement = require('../symbol/placement'),
      BasicSourceCache = require('./source_cache');


class BasicStyle extends Style {
  constructor(stylesheet, map, options){
    super(map, options);
    this._loadedPromise = new Promise(res => this.on('data', e => e.dataType === "style" && res()));
    this._loadedPromise.then(() => this.placement = new Placement(map.transform, 0));
    this.loadJSON(stylesheet);
  }

  addSource(id, source, options){
    source.map = this.map;
    this.sourceCaches[id] = BasicSourceCache(source);
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

module.exports = BasicStyle;