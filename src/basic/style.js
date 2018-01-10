const Style = require('../style/style'),
      Source = require('../source/source'),
      Placement = require('../symbol/placement');

class BasicStyle extends Style {
  constructor(stylesheet, map, options){
    super(map, options);
    this._loadedPromise = new Promise(res => 
      this.on('data', e => e.dataType === "style" && res()));
    this._loadedPromise.then(()=>this.placement = new Placement(map.transform, 0));
    this._source = {
      isDummy: true,
      loadTile: (tile, cb) => this._loadedPromise.then(()=>this._source.loadTile(tile, cb)),
      unloadTile: (tile) => this._loadedPromise.then(()=>this._source.unloadTile(tile)), 
      abortTile: (tile) => this._loadedPromise.then(()=>this._source.unloadTile(tile))
    };
    this.loadJSON(stylesheet);
  }

  addSource(id, source, options){
    console.assert(!this._source || this._source.isDummy, "can only load one source");
    this._source = Source.create(id, source, this.dispatcher, this);
    this._source.tiles = source.tiles;
    this._source.map = this.map;
    this._source.setEventedParent(this, {source: this._source});
    this.sourceCaches[id] = {
      getSource: () => this._source,
      getVisibleCoordinates: () => [this._currentCoord],
      getTile: () => this._currentTile,
      reload: () => {},
      pause: () => {},
      resume: () => {},
      serialize: () => this._source.serialize(),
      map: { },
      prepare: (context) => {
        Object.values(this._source.map._tilesInUse).forEach(t => t.upload(context));
      }
    }; 
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