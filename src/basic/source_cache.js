const Cache = require('../util/lru_cache'),
      assert = require('assert');
const TILE_CACHE_SIZE = 100;



/*
  This "owns" tiles, with each tile existing in at most one of the following two places:
    + _tilesInUse - a map from tileID.key => tile, where the tiles have a .uses counter
    + _tileCache - a Least Recently Used cache, also from tileID.key => tile.
  In addition, one of the _tilesInUse may also appear as the following:
    + currentlyRenderingTiles - a list of tiles that we actually want to be able to paint
*/

class BasicSourceCache {
  _source;
  _tilesInUse = {}; // tileID.key => tile (note that tile's have a .uses counter)
  map = {};
  _tileCache;
  currentlyRenderingTiles; 

  constructor(source){
    this._source = source;
    this._tileCache = = new Cache(TILE_CACHE_SIZE, t => this._source.unloadTile(t));
  },
  getSource(){
    return this._source;
  }
  getVisibleCoordinates(){
    return this.currentlyRenderingTiles.map(t => t.tileID);
  }
  getTile(tileID){
    // important: every call to getTile should be paired with a call to releaseTile
    // you can also manually increment tile.uses, however do not decrement it directly, instead
    // call releaseTile.

    let tile = this._tilesInUse[tileID] ||
               this._tileCache.getAndRemove(id) ||
               new Tile(tileID.wrapped(), 512, z); // previous the 512 was this._resolution
    tile.uses++;
    this._tilesInUse[id] = tile;

    tile.source = this._source; // redundant if tile is not new
    if(!tile.loadedPromise){
      // We need to actually issue the load request, and express it as a promise...
      tile.loadedPromise = new Promise((res, rej) => 
        this._source.loadTile(tile, err => err ? rej(err) : res()));
    }

    return tile;
  }
  serialize(){
    return this._source.serialize();
  }
  prepare(context){
    Object.values(this._source.map._tilesInUse).forEach(t => t.upload(context));
  }
  releaseTile(tile){
    assert(tile.uses > 0);

    tile.uses--;
    if(tile.uses > 0){
      return;
    }
    delete this._tilesInUse[tile.tileID.key];
    if(tile.hasData()){
      // this tile is worth keeping...
      this._tileCache.add(tile.tileID.key, tile);
    } else {
      // this tile isn't ready and isn't needed, so abandon it...
      this._source.abortTile(tile);
      this._source.unloadTile(tile);
    }
  }

  invalidateAllLoadedTiles(){
    // this needs to be called on all changes: style, layers visible, resolution (i.e. zoom)
    // by removing the loadedPromise, we force a fresh load next time the tile
    // is needed...although note that "fresh" is only partial because the rawData
    // is still available.
    Object.key(this._tilesInUse).forEach(t => t.loadedPromise = null);
    this._tileCache.keys().forEach(id => this._tileCache.get(id).loadedPromise = null);
  }
  reload(){ }
  pause(){ }
  resume(){ }
};

module.exports = BasicSourceCache;