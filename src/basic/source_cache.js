const Cache = require('../util/lru_cache'),
      assert = require('assert'),
      Tile = require('../source/tile'),
      Point = require('point-geometry'),
      EXTENT = require('../data/extent'),
      SphericalMercator = require('@mapbox/sphericalmercator');
   
let sphericalMercator = new SphericalMercator();

const TILE_CACHE_SIZE = 100;

const TILE_LOAD_TIMEOUT = 60*1000;

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
    this._tileCache = new Cache(TILE_CACHE_SIZE, t => this._source.unloadTile(t));
  }
  getSource(){
    return this._source;
  }
  getVisibleCoordinates(){
    return this.currentlyRenderingTiles.map(t => t.tileID);
  }
  getRenderableIds(){
    return this.getVisibleCoordinates();
  }
  acquireTile(tileID, size){
    // important: every call to acquireTile should be paired with a call to releaseTile
    // you can also manually increment tile.uses, however do not decrement it directly, instead
    // call releaseTile.
    let tile = this._tilesInUse[tileID.key] ||
               this._tileCache.getAndRemove(tileID.key) ||
               new Tile(tileID.wrapped(), size, tileID.canonical.z); 
    tile.uses++;
    this._tilesInUse[tileID.key] = tile;

    tile.cache = this; // redundant if tile is not new
    if(!tile.loadedPromise){
      // We need to actually issue the load request, and express it as a promise...
      tile.loadedPromise = new Promise((res, rej) => {
        // note that we don't touch the .uses counter here on errors
        let timeout = setTimeout(() => {
          this._source.abortTile(tile);
          tile.loadedPromise = null;
          rej("timeout");
        }, TILE_LOAD_TIMEOUT);
        this._source.loadTile(tile, err => {
          clearTimeout(timeout);
          if(err){
            this.loadedPromise = null;
            rej(err);
          } else {
            res();
          }
        });
      });
    }

    return tile;
  }
  getTileByID(tileID){
    return this.getTile(tileID); //alias
  }
  getTile(tileID){
    // note that the requested tile should actually also feature in currentlyRenderingTiles..but that's harder to query
    return this._tilesInUse[tileID.key];
  }
  serialize(){
    return this._source.serialize();
  }
  prepare(context){
    this.currentlyRenderingTiles.forEach(t => t.upload(context));
  }
  releaseTile(tile){
    assert(tile.uses > 0);
    if(--tile.uses > 0){
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
    Object.values(this._tilesInUse).forEach(t => t.loadedPromise = null);
    this._tileCache.keys().forEach(id => this._tileCache.get(id).loadedPromise = null);
  }

  tilesIn(opts){
    let tileXY = sphericalMercator.px([opts.lng, opts.lat], opts.tileZ, false)
                                  .map(x=>x/256 /* why 256? */);
    let tileX = tileXY[0] |0;
    let tileY = tileXY[1] |0;
    let pointXY = tileXY.map(x => (x - (x|0)) * EXTENT);
    let pointX = pointXY[0];
    let pointY = pointXY[1];

    return Object.values(this._tilesInUse)
      .filter(t => t.hasData()) // we are a bit lazy in terms of ensuring the data matches the rendered styles etc. ..could check loadedPromise has resolved
      .map(t => ({
        tile: t,
        tileID: t.tileID,
        queryGeometry: [[Point.convert([
          // for all but the 0th coord, we need to adjust the pointXY values to lie suitably outside the [0,EXTENT] range
          pointX + EXTENT*(tileX-t.tileID.canonical.x),  
          pointY + EXTENT*(tileY-t.tileID.canonical.y),
        ])]],
        scale: 1
      }));
  }

  reload(){ }
  pause(){ }
  resume(){ }
};

module.exports = BasicSourceCache;