const map = L.map('map').setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();
let showAreas = true;

// Configure base layer
const gmap_road = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_sat = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_terrain = L.tileLayer('https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_hybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 22
});


const ndvi = L.tileLayer.wms("https://engrids.soc.cmu.ac.th/geoserver/gwc/service/wms?", {
    layers: 'rubber:rubber4326',
    format: 'image/png',
    transparent: true,
    maxZoom: 24,
    zIndex: 5
});

const rubber_parcel = L.tileLayer.wms("https://engrids.soc.cmu.ac.th/geoserver/rubber/wms?", {
    layers: 'rubber:rubber_pacel',
    format: 'image/png',
    transparent: true,
    maxZoom: 24,
    zIndex: 6
});
const longdoLayer = L.tileLayer('https://ms.longdo.com/mmmap/img.php?zoom={z}&x={x}&y={y}&mode=dol_hd', {
    attribution: '&copy; Longdo Map',
    tileSize: 256,
    maxZoom: 30,
    minZoom: 1
});

const baseLayers = {
    "Google Road": gmap_road,
    "Google Satellite": gmap_sat.addTo(map),
    "Google Terrain": gmap_terrain,
    "Google Hybrid": gmap_hybrid,
    "Stadia Light": light
};

const ndviTile = L.featureGroup();
const trueColorTile = L.featureGroup();

const overlayMaps = {
    "แปลงยาง": featureGroup.addTo(map),
    "แปลงยาง(เดิม)": rubber_parcel,
    "NDVI": ndvi,
    "NDVI gee": ndviTile,
    "S2 gee": trueColorTile,
    "Longdo Map": longdoLayer.addTo(map),
};

L.control.layers(baseLayers, overlayMaps).addTo(map);

fetch('/rub/api/gee')
    .then(res => res.json())
    .then((data) => {
        const truecolor = L.tileLayer(data.truecolor.urlFormat, {
            attribution: 'Google Earth Engine',
            maxZoom: 24,
            zIndex: 3
        });

        const ndvi = L.tileLayer(data.ndvi.urlFormat, {
            attribution: 'Google Earth Engine',
            maxZoom: 24,
            zIndex: 4
        });

        // Add layers to map
        truecolor.addTo(trueColorTile);
        ndvi.addTo(ndviTile);
    });

// Configure Geoman controls
map.pm.addControls({
    position: 'topright',
    drawCircle: false,
    drawMarker: false,
    drawPolyline: false,
    drawRectangle: false,
    drawPolygon: true,
    editMode: true,
    dragMode: false,
    cutPolygon: false,
    removalMode: false,
    rotateMode: false,
    drawText: false,
    drawCircleMarker: false,
});

// Area calculation utilities
const formatArea = (area) => {
    return area >= 1e6
        ? `${(area / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} km²`
        : `${area.toLocaleString(undefined, { maximumFractionDigits: 2 })} m²`;
};

// Label management
const updateAreaLabel = async (layer) => {
    try {
        const geojsonFeature = layer.toGeoJSON();

        const res = await fetch(`/rub/api/area`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ geometry: geojsonFeature.geometry })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`API error ${res.status}: ${errText}`);
        }

        const { area } = await res.json();
        const xls_sqm = document.getElementById('xls_sqm').value;

        document.getElementById('shparea_sqm').value = area.toFixed(0);
        const diff = Math.abs(area - xls_sqm);

        if (diff >= 100) {
            document.getElementById('message').innerHTML = '<h5><span class="badge bg-danger">เนื้อที่ยังไม่เท่ากัน</span></h5>';
        } else {
            document.getElementById('message').innerHTML = '<h5><span class="badge bg-success">เนื้อที่ใกล้เคียงกัน</span></h5>';
        }
    } catch (error) {
        console.error('Error updating label:', error);
    }
};

const xls_app_no = document.getElementById('xls_app_no');
const xls_sqm = document.getElementById('xls_sqm');
const shparea_sqm = document.getElementById('shparea_sqm');
const refinal = document.getElementById('refinal');


function showFeaturePanel(feature, layer) {
    xls_app_no.value = feature.properties.app_no;
    xls_sqm.value = Number(feature.properties.xls_sqm).toFixed(0);
    shparea_sqm.value = Number(feature.properties.shparea_sqm).toFixed(0);
    refinal.value = feature.properties.refinal ? feature.properties.refinal : '';

    // xls_app_no.value = feature.properties.app_no;
    // xls_sqm.value = feature.properties.xls_sqm;
    // refinal.value = feature.properties.refinal;

    // console.log(feature.properties);
    updateAreaLabel(layer);
}

const getFeatureStyle = (feature) => {
    const xls = Number(feature.properties.xls_sqm);
    const shp = Number(feature.properties.shparea_sqm);
    const diff = xls - shp;
    const isEqual = Math.abs(diff) <= 100;

    return {
        color: isEqual ? '#00cc00' : '#FF7601',
        weight: 2,
        opacity: 0.9,
        fillColor: isEqual ? '#90ee90' : '#FFBF78',
        fillOpacity: 0.1
    };
};

var selectedPolygon = null;
let highlightedLayer = null; // Track the currently highlighted layer

function onEachFeature(feature, layer) {
    featureGroup.addLayer(layer);
    layer.on({
        click: function (e) {
            selectedPolygon = layer;
            showFeaturePanel(feature, layer);
            if (highlightedLayer === e.target) {
                resetHighlight(e);
                highlightedLayer = null;
            } else {
                // Clicked new feature - highlight it
                if (highlightedLayer) {
                    resetHighlight({ target: highlightedLayer }); // Remove previous highlight
                }
                highlightFeature(e);
                highlightedLayer = e.target;
            }
        }
    });
}

var geojson;

function resetHighlight(e) {
    geojson.resetStyle(e.target);
}

function highlightFeature(e) {
    const layer = e.target;
    layer.setStyle({
        weight: 5,
        color: '#0ccbf0',
        dashArray: '',
        fillOpacity: 0.3
    });
    layer.bringToFront();
}

const loadGeoData = async (id) => {
    try {
        const tb = document.getElementById('tb').value;
        const response = await fetch('/rub/api/getsinglefeature/' + tb + '/' + id);
        const { data } = await response.json();
        console.log('Loaded data:', data);

        const geoJsonData = {
            type: 'FeatureCollection',
            features: data.map(item => ({
                type: 'Feature',
                geometry: JSON.parse(item.geom),
                properties: {
                    id: item.id,
                    app_no: item.app_no,
                    xls_sqm: item.xls_sqm,
                    shparea_sqm: item.shparea_sqm,
                    refinal: item.refinal,
                }
            }))
        };

        geojson = L.geoJson(geoJsonData, {
            style: getFeatureStyle,
            onEachFeature: onEachFeature
        }).addTo(map);

        map.fitBounds(featureGroup.getBounds());
    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load spatial data');
    }
};

var selectedLine = null;
const handleLayerCreate = (e) => {
    const layer = e.layer;
    featureGroup.addLayer(layer);
    layer.pm.enable();
    selectedLine = layer;

    layer.on('pm:edit pm:dragend pm:update pm:change', () => console.log(layer));
    layer.on('click', () => {
        featureGroup.eachLayer(l => l.pm.disable());
        layer.pm.enable();
    });
};

map.on('pm:create', handleLayerCreate);
map.on('pm:edit', (e) => {
    const layer = e.layer;
    featureGroup.eachLayer(l => l.pm.disable());
    layer.pm.enable();
});
map.on('click', () => featureGroup.eachLayer(l => l.pm.disable()));


document.getElementById('clear').addEventListener('click', () => {
    if (highlightedLayer) {
        resetHighlight({ target: highlightedLayer });
        highlightedLayer = null;
    }

    selectedPolygon = null;
    selectedLine = null;
    sub_id.value = '';
    xls_app_no.value = '';
    shpsplit_sqm.value = '';
    classtype.value = '';
})

document.getElementById('save').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!selectedPolygon) {
        alert('เลือก polygon ก่อน');
        return;
    }

    const id = document.getElementById('id').value;
    const tb = document.getElementById('tb').value;
    const refinal = document.getElementById('refinal').value;
    const displayName = document.getElementById('displayName').value;


    const polygon1 = selectedPolygon.toGeoJSON();
    const polygon2 = selectedLine?.toGeoJSON();

    let coordinates = [];

    if (polygon1.geometry.type === "Polygon") {
        coordinates.push(polygon1.geometry.coordinates);
    }
    if (polygon2 && polygon2.geometry.type === "Polygon") {
        coordinates.push(polygon2.geometry.coordinates);
    }

    const polygon = {
        type: "Feature",
        geometry: {
            type: "MultiPolygon",
            coordinates: coordinates
        },
        properties: {}
    };

    const data = {
        id: id,
        refinal: refinal,
        displayName: displayName,
        features: [polygon]
    };

    console.log('Saving feature:', data);

    try {
        const response = await fetch('/rub/api/savefeature/' + tb, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('Error saving feature:', result);
            alert('บันทึกไม่สำเร็จ: ' + (result.error || 'ไม่ทราบสาเหตุ'));
        } else {
            alert('บันทึกสำเร็จ');
        }
    } catch (err) {
        console.error('Fetch error:', err);
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
});

document.getElementById('reshape').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reshape/index.html?tb=' + tb;
})

const initApp = async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const id = urlParams.get('id');
        const tb = urlParams.get('tb');
        if (!tb || tb === 'undefined') {
            alert('พื้นที่ไม่ถูกต้อง');
            window.location.href = './../index.html';
        }

        document.getElementById('id').value = id;
        document.getElementById('tb').value = tb;
        await loadGeoData(id);
    } catch (error) {
        console.error('Error loading data:', error);
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/rub/auth/me');
        const { user } = await res.json();

        if (user) {
            document.getElementById('google-login-link').style.display = 'none';
            document.getElementById('profile-section').style.display = 'flex';
            document.getElementById('profile-image').src = user.photo;
            document.getElementById('display-name').textContent = user.displayName;
            document.getElementById('displayName').value = user.displayName;

            await initApp();

            document.getElementById('logout-link').addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    const result = await fetch('/rub/auth/logout');
                    const { success } = await result.json();
                    if (success) {
                        window.location.href = '/rub/index.html';
                    } else {
                        alert('Logout failed');
                    }
                } catch (err) {
                    console.error('Logout failed:', err);
                }
            });
        } else {
            window.location.href = '/rub/index.html';
        }
    } catch (err) {
        console.error('Failed to fetch user:', err);
    }
});

