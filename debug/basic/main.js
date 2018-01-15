import BasicRenderer from '../../src/basic/renderer';
import defaults from './defaults';

window.BasicRenderer = BasicRenderer;

function parseTextAreas(){
  let tilesSpec = window.tilesSpec = document.getElementById("tilesSpecText").value;
  let drawSpec = window.drawSpec = document.getElementById("drawSpecText").value;
  let style = window.style = document.getElementById("styleText").value;
  try{
    tilesSpec = JSON.parse(tilesSpec);
  } catch(e){
    return alert("tileSpec parse error: " + e);
  }
  if(!Array.isArray(tilesSpec)){
    return alert("tilesSpec needs to be an array");
  }
  if(!tilesSpec.every(s => 
      s.source && s.z > 0 && s.x > 0 && s.y > 0 &&
      Number.isFinite(s.top) && Number.isFinite(s.left) && Number.isFinite(s.size))){
      return alert("Bad tileSpec..one or more elements do not have the expected numerical fields");
    }
  try{
    drawSpec = JSON.parse(drawSpec);
  } catch(e){
    return alert("drawSpec parse error: " + e);
  }
  try{
    style = JSON.parse(style);
  } catch(e){
    return alert("style parse error: " + e);
  }
  return {tilesSpec, drawSpec, style}
}


function doIt(){
  let {tilesSpec, drawSpec, style} = parseTextAreas();

  // visualise everything's layout on the imaginary canvas :::::::::::::::::::::::::
  let minLeft = tilesSpec.map(s=>s.left).reduce((a,b)=>Math.min(a,b),Infinity);
  let minTop = tilesSpec.map(s=>s.top).reduce((a,b)=>Math.min(a,b), Infinity);
  minLeft = Math.min(minLeft, drawSpec.srcLeft) - 50;
  minTop = Math.min(minTop, drawSpec.srcTop) - 50;
  let imaginaryCanvasEl = document.getElementById("imaginary-canvas");
  imaginaryCanvasEl.innerHTML = "";

  let origin = document.createElement("div");
  origin.textContent = "'{left: " + minLeft + ", top: " + minTop + "}";
  origin.classList = 'origin';
  imaginaryCanvasEl.appendChild(origin);

  tilesSpec.forEach((s,ii) => {
    let t = document.createElement("div");
    t.classList = "source-tile"
    t.style.left = (s.left - minLeft) + 'px';
    t.style.top = (s.top - minTop) + 'px';
    t.style.width = s.size + 'px';
    t.style.height = s.size + 'px';
    t.textContent = 'tilesSpec[' + ii + ']:\n' + JSON.stringify(s,null,2);
    imaginaryCanvasEl.appendChild(t);
  })

  let src = document.createElement("div");
  src.classList = "src";
  src.style.left = (drawSpec.srcLeft - minLeft) + 'px';
  src.style.top = (drawSpec.srcTop - minTop) + 'px';
  src.style.width = drawSpec.width + 'px';
  src.style.height = drawSpec.height + 'px';
  let drawSpec2 = Object.assign({}, drawSpec);
  delete drawSpec2.destTop;
  delete drawSpec2.destLeft;
  src.textContent = "drawSpec src: " + JSON.stringify(drawSpec2, null, 2);
  imaginaryCanvasEl.appendChild(src);


  // prepare the proper output canvas :::::::::::::::::::::::::::::::::::::::::
  let dest = document.getElementById("dest");
  let BORDER_WIDTH = 2;
  dest.style.left = (drawSpec.destLeft - BORDER_WIDTH) + 'px';
  dest.style.top = (drawSpec.destTop - BORDER_WIDTH) + 'px';
  dest.style.width = drawSpec.width + 'px';
  dest.style.height = drawSpec.height + 'px';
  drawSpec2 = Object.assign({}, drawSpec);
  delete drawSpec2.srcLeft;
  delete drawSpec2.srcTop;
  dest.textContent = "drawSpec dest: " + JSON.stringify(drawSpec2, null, 2);

  // perform the actual render ::::::::::::::::::::::::::::::::::::::::::::::::
  let realCanvasEl = document.getElementById("real-canvas");
  window.renderer = new BasicRenderer({style});

  window.renderer.on('data',  data => {
    if(data.dataType !== "style") {
      return;
    }
    renderer.renderTiles(realCanvasEl.getContext('2d'),
      drawSpec,
      tilesSpec,
      err => err ? console.error("renderTiles:" + err) : console.log("done rendering"));
  });
}

document.getElementById("applyBtn").onclick = doIt;
document.getElementById("styleText").value = JSON.stringify(defaults.style, null, 2);
document.getElementById("tilesSpecText").value = JSON.stringify(defaults.tilesSpec, null, 2);
document.getElementById("drawSpecText").value = JSON.stringify(defaults.drawSpec, null, 2);

doIt();