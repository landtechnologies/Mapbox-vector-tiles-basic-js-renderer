

window.initMap = function() {
    // this is called when google maps js is loaded
    var map = (window.map = new google.maps.Map(
        document.getElementById("map"),
        {
            zoom: 16,
            center: { lat: 50.822078302938486, lng: -0.14190586317999987 },
            mapTypeId: "satellite"
        }
    ));

    var overlay = (window.overlay = new MapboxGoogleOverlay({
        style: DEFAULTS.style,
        availableZooms: DEFAULTS.availableZooms,
        mousemoveSources: Object.keys(DEFAULTS.availableZooms)
    }));

    overlay.addToMap(map);

    var infoEl = document.getElementById("info");

    overlay.on(
        "mousemove",
        info => (infoEl.textContent = JSON.stringify(info, null, 2))
    );
};
