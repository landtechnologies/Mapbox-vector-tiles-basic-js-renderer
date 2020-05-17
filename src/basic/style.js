const Style = require('../style/style'),
      Source = require('../source/source'),
      Placement = require('../symbol/placement'),
      BasicSourceCache = require('./source_cache');


class BasicStyle extends Style {
  constructor(stylesheet, map, options){
    super(map, options);
    this.loadedPromise = new Promise(res => this.on('data', e => e.dataType === "style" && res()));
    this.loadedPromise.then(() => this.placement = new Placement(map.transform, 0));
    this.loadJSON(stylesheet);
  }

  addSource(id, source, options){
    let source_ = Source.create(id, source, this.dispatcher, this);
    source_.setEventedParent(this, {source: source_});
    source_.map = this.map;
    source_.tiles = source.tiles;
    source_.load()
    this.loadedPromise.then(() => new Promise(res => source_.on('data', e => e.dataType === 'source' && res())));
    this.sourceCaches[id] = new BasicSourceCache(source_);
  }
  
  // setLayers, and all other methods on the super, e.g. setPaintProperty, should be called
  // via loadedPromise.then, not synchrounsouly 

  setLayers(visibleLayerNames){
    // Note this is not part of mapbox style, but handy to put it here for use with pending-style    
    return Object.keys(this._layers)
      .map(layerName => 
        this.setLayoutProperty(layerName, 'visibility', 
          visibleLayerNames.includes(layerName) ? 'visible' : 'none')
      );
  }

};

module.exports = BasicStyle;