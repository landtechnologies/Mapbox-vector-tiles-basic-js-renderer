import Overlay from './mapbox_google_overlay';
import DEFAULTS from './defaults';



window.initMap = function(){
  // this is called when google maps js is loaded
  var map = window.map = new google.maps.Map(document.getElementById('map'), {
    zoom: 16,
    center: {lat:  51.5912874, lng: -0.1080217},
    mapTypeId: "satellite"
  });

  var overlay = window.overlay = new Overlay({
    style: DEFAULTS.style,
    availableZooms: DEFAULTS.availableZooms,
    mousemoveSources: Object.keys(DEFAULTS.availableZooms)
  });

  overlay.addToMap(map);

  var infoEl = document.getElementById("info");

  overlay.on('mousemove', info => infoEl.textContent = JSON.stringify(info, null, 2))
}