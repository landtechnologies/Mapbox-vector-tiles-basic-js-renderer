export default {

  tilesSpec: [

    {source: "mytiles", z: 14, x: 1200, y: 7000, top: -512, left: 0, size: 1024},
    {source: "mytiles", z: 16, x: 5000, y: 3000, top: 0, left: 0, size: 256},
    {source: "mytiles", z: 16, x: 5001, y: 3000, top: 0, left: 256, size: 256},
    {source: "mytiles", z: 16, x: 5000, y: 3001, top: 256, left: 0, size: 256},
    {source: "mytiles", z: 16, x: 5001, y: 3001, top: 256, left: 256, size: 256},
  ],

  drawSpec: {
    destLeft: 0,
    destTop: 0,
    srcLeft: 100,
    srcTop: 200,
    width: 256,
    height: 128
  },

  style: {
    
  }
}