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
  drawSpec = Array.isArray(drawSpec) ? drawSpec : [drawSpec];
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
  minLeft = drawSpec.map(s=>s.srcLeft).reduce((a,b) =>Math.min(a,b), minLeft) - 50;
  minTop = drawSpec.map(s=>s.srcTop).reduce((a,b) => Math.min(a,b), minTop) - 50;
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

  drawSpec.forEach((d,ii) => {
    let src = document.createElement("div");
    src.classList = "src";
    src.style.left = (d.srcLeft - minLeft) + 'px';
    src.style.top = (d.srcTop - minTop) + 'px';
    src.style.width = d.width + 'px';
    src.style.height = d.height + 'px';
    let drawSpec2 = Object.assign({}, d);
    delete drawSpec2.destTop;
    delete drawSpec2.destLeft;
    src.textContent = "drawSpec[" + ii + "] src: " + JSON.stringify(drawSpec2, null, 2);
    imaginaryCanvasEl.appendChild(src);
  });
 

  // prepare the proper output canvas :::::::::::::::::::::::::::::::::::::::::
  let destWrapperEl = document.getElementById("dest-wrapper");
  destWrapperEl.innerHTML = "";
  drawSpec.forEach((d,ii) => {
    let dest = document.createElement("div");
    dest.classList = "dest";
    dest.style.left = d.destLeft + 'px';
    dest.style.top = d.destTop + 'px';
    dest.style.width = d.width + 'px';
    dest.style.height = d.height + 'px';
    let drawSpec2 = Object.assign({}, d);
    delete drawSpec2.srcLeft;
    delete drawSpec2.srcTop;
    dest.textContent = "drawSpec[" + ii + "] dest: " + JSON.stringify(drawSpec2, null, 2);
    destWrapperEl.appendChild(dest);
  });

  // perform the actual render ::::::::::::::::::::::::::::::::::::::::::::::::
  let realCanvasEl = document.getElementById("real-canvas");
  window.renderer && window.renderer.destroyDebugCanvas();
  window.renderer = new BasicRenderer({style});

  window.renderer.on('data',  data => {
    if(data.dataType !== "style") {
      return;
    }

    let ctx = realCanvasEl.getContext('2d');
    ctx.globalCompositeOperation = 'copy';
    drawSpec.forEach(d => renderer.renderTiles(ctx,
      d, tilesSpec,
      err => err ? console.error("renderTiles:" + err) : console.log("done rendering")));
  });
}

document.getElementById("applyBtn").onclick = doIt;
document.getElementById("styleText").value = JSON.stringify(defaults.style, null, 2);
document.getElementById("tilesSpecText").value = JSON.stringify(defaults.tilesSpec, null, 2);
document.getElementById("drawSpecText").value = JSON.stringify(defaults.drawSpec, null, 2);

doIt();