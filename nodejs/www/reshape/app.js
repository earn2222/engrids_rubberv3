// Initialize map and feature group
const map = L.map('map', { maxZoom: 22 }).setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();
const lddFeatureGroup = L.featureGroup();
let _userRole = null;

// Custom Rubber Tree Icon
const rubberTreeIcon = L.icon({
    iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 640">
            <defs>
                <filter id="p-shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="12" />
                    <feOffset dx="0" dy="10" result="offsetblur" />
                    <feComponentTransfer><feFuncA type="linear" slope="0.3" /></feComponentTransfer>
                    <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <linearGradient id="p-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:#81c784" />
                    <stop offset="100%" style="stop-color:#2e7d32" />
                </linearGradient>
            </defs>
            <path fill="url(#p-grad)" filter="url(#p-shadow)" d="M256 640c-15 0-30-5-40-15C160 560 32 420 32 256 32 120 144 0 256 0s224 120 224 256c0 164-128 304-184 369-10 10-25 15-40 15z"/>
            <circle cx="256" cy="245" r="170" fill="white"/>
            <path fill="#2e7d32" d="M256 120c-40 0-80 35-80 110 0 60 80 110 80 110s80-50 80-110c0-75-40-110-80-110z"/>
            <path fill="#1b5e20" d="M256 150c-30 0-60 25-60 80 0 50 60 90 60 90s60-40 60-90c0-55-30-80-60-80z" opacity="0.6"/>
            <path fill="#5d4037" d="M236 320h40v40h-40z"/>
        </svg>
    `),
    iconSize: [28, 35],
    iconAnchor: [14, 35],
    popupAnchor: [0, -35]
});

// Custom Highlighted Rubber Tree Icon
const rubberTreeIconHighlight = L.icon({
    iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 640">
            <defs>
                <filter id="p-shadow-hi" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="12" />
                    <feOffset dx="0" dy="10" result="offsetblur" />
                    <feComponentTransfer><feFuncA type="linear" slope="0.3" /></feComponentTransfer>
                    <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <linearGradient id="p-grad-hi" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:#84ffff" />
                    <stop offset="100%" style="stop-color:#00bcd4" />
                </linearGradient>
            </defs>
            <path fill="url(#p-grad-hi)" filter="url(#p-shadow-hi)" d="M256 640c-15 0-30-5-40-15C160 560 32 420 32 256 32 120 144 0 256 0s224 120 224 256c0 164-128 304-184 369-10 10-25 15-40 15z"/>
            <circle cx="256" cy="245" r="170" fill="white"/>
            <path fill="#00bcd4" d="M256 120c-40 0-80 35-80 110 0 60 80 110 80 110s80-50 80-110c0-75-40-110-80-110z"/>
            <path fill="#00838f" d="M256 150c-30 0-60 25-60 80 0 50 60 90 60 90s60-40 60-90c0-55-30-80-60-80z" opacity="0.6"/>
            <path fill="#5d4037" d="M236 320h40v40h-40z"/>
        </svg>
    `),
    iconSize: [40, 50],
    iconAnchor: [20, 50],
    popupAnchor: [0, -50]
});

// Configure base layer
const gmap_road = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    maxNativeZoom: 18,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_sat = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    maxNativeZoom: 18,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_terrain = L.tileLayer('https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    maxNativeZoom: 18,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_hybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    maxNativeZoom: 18,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 22,
    maxNativeZoom: 22
});

// Add the custom tile layer
const longdoLayer = L.tileLayer('https://ms.longdo.com/mmmap/img.php?zoom={z}&x={x}&y={y}&mode=dol_hd', {
    attribution: '&copy; Longdo Map',
    tileSize: 256,
    maxZoom: 22,
    maxNativeZoom: 18,
    minZoom: 1
});


const ndvi = L.tileLayer.wms("https://engrids.soc.cmu.ac.th/geoserver/gwc/service/wms?", {
    layers: 'rubber:rubber4326',
    format: 'image/png',
    transparent: true,
    maxZoom: 22,
    zIndex: 5
});

// shpall background layer — bbox-filtered per viewport, reloads on map move
const shpallLayer = L.featureGroup();
let _shpallActive = false;
let _shpallTimer = null;

function _shpallStyle() {
    return {
        color: '#0055ff', weight: 2.5, opacity: 0.9,
        fillColor: '#0055ff', fillOpacity: 0.15
    };
}

async function loadShpallLayer() {
    if (!_shpallActive) return;
    const tb = document.getElementById('tb').value || new URLSearchParams(window.location.search).get('tb') || 'shpall';
    try {
        const b = map.getBounds();
        const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
        const res = await fetch(`/rub3/api/shpall/${tb}?bbox=${bbox}`);
        const data = await res.json();
        shpallLayer.clearLayers();
        if (data.success && data.features && data.features.length > 0) {
            L.geoJSON({ type: 'FeatureCollection', features: data.features }, {
                interactive: false, style: _shpallStyle
            }).addTo(shpallLayer);
            console.log(`shpall: แสดง ${data.features.length} แปลง`);
        }
    } catch (err) {
        console.error('shpall load error:', err);
    }
}

function _shpallDebounce() {
    if (!_shpallActive) return;
    clearTimeout(_shpallTimer);
    _shpallTimer = setTimeout(loadShpallLayer, 400);
}

shpallLayer.on('add', () => { _shpallActive = true; loadShpallLayer(); });
shpallLayer.on('remove', () => { _shpallActive = false; shpallLayer.clearLayers(); });
map.on('moveend zoomend', _shpallDebounce);


const baseLayers = {
    "Google Road": gmap_road,
    "Google Satellite": gmap_sat.addTo(map),
    "Google Terrain": gmap_terrain,
    "Google Hybrid": gmap_hybrid,
    "Stadia Light": light
};

const overlayMaps = {
    "แปลงยาง": featureGroup.addTo(map),
    "Longdo Map": longdoLayer.addTo(map),
};

L.control.layers(baseLayers, overlayMaps).addTo(map);


map.on('click', (e) => {
    console.log(e.latlng);

})
// View-only mode — no Geoman editing controls

const getFeatureStyle = () => ({
    color: '#e65100', weight: 2.5, opacity: 1,
    fillColor: '#ff9800', fillOpacity: 0.25
});

const highlightSelectedLayer = (layerToHighlight) => {
    featureGroup.eachLayer(l => {
        if (l instanceof L.Path && l.feature) {
            l.setStyle(getFeatureStyle(l.feature));
        } else if (l instanceof L.Marker) {
            l.setIcon(rubberTreeIcon);
            l.closePopup();
        }
    });

    if (layerToHighlight) {
        if (layerToHighlight instanceof L.Path) {
            layerToHighlight.setStyle({
                color: '#00FFFF',
                weight: 4,
                opacity: 1,
                fillColor: '#00FFFF',
                fillOpacity: 0.4
            });
            layerToHighlight.bringToFront();
            layerToHighlight.openPopup();
        } else if (layerToHighlight instanceof L.Marker) {
            layerToHighlight.setIcon(rubberTreeIconHighlight);
            layerToHighlight.openPopup();
        }
    }
};

map.on('pm:create', (e) => {
    const layer = e.layer;
    featureGroup.addLayer(layer);
    layer.pm.enable({ removeVertexOn: 'contextmenu' });

    // If a point is selected, replace it with this new polygon
    if (selectedLayer && selectedLayer instanceof L.Marker) {
        const properties = selectedLayer.options.properties || (selectedLayer.feature && selectedLayer.feature.properties) || {};
        layer.feature = { type: 'Feature', properties: { ...properties } };

        featureGroup.removeLayer(selectedLayer);
        selectedLayer = layer;
        layerEdited = true;

        layer.bindPopup(`${properties.id}`);
        layer.on('click', (ev) => {
            // ถ้ากำลัง digitize (draw) อยู่ ไม่ให้แปลงอื่นมาแย่งข้อมูล
            if (isDrawing) return;
            showFeaturePanel(layer.feature, layer);
            featureGroup.eachLayer(l => l.pm.disable());
            layer.pm.enable({ removeVertexOn: 'contextmenu' });
            highlightSelectedLayer(layer);
            layerEdited = false;
            selectedLayer = layer;
        });

        layer.on('pm:edit pm:dragend pm:change', () => {
            layerEdited = true;
            updateAreaLabel();
        });

        updateAreaLabel();
        highlightSelectedLayer(layer);
    } else {
        // If nothing was selected or a polygon was selected, just set as selected
        selectedLayer = layer;
        layerEdited = true;
        updateAreaLabel();
        highlightSelectedLayer(layer);
    }
});

// Area calculation utilities

function customLineToPolygon(geojsonFeature) {
    const geom = geojsonFeature.geometry;
    let finalCoords = [];

    if (geom.type === 'LineString') {
        let coords = [...geom.coordinates];
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
            coords.push([...first]);
        }
        if (coords.length >= 4) finalCoords.push(coords);
    } else if (geom.type === 'MultiLineString') {
        geom.coordinates.forEach(lineCoords => {
            let coords = [...lineCoords];
            const first = coords[0];
            const last = coords[coords.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
                coords.push([...first]);
            }
            if (coords.length >= 4) finalCoords.push(coords);
        });
    }

    if (finalCoords.length === 0) {
        throw new Error("พิกัดจุดไม่เพียงพอที่จะสร้างรูปหลายเหลี่ยม (Polygon)");
    }

    return {
        type: "Feature",
        properties: geojsonFeature.properties || {},
        geometry: {
            type: "Polygon",
            coordinates: finalCoords
        }
    };
}

// Label management - always uses selectedLayer to avoid stale/wrong closure references
// view-only — no area update needed
const updateAreaLabel = () => { };

function showFeaturePanel(feature, layer) {
    document.getElementById('id').value = feature.properties.id;
    document.getElementById('xls_id_farmer').value = feature.properties.id_farmer || '';
    document.getElementById('current_sqm').value =
        Number(feature.properties.sqm_rechac || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
    document.getElementById('current_rai').value =
        Number(feature.properties.rai_rechac || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
    document.getElementById('classify').disabled = false;
}

// Track whether the user has actually edited the selected polygon
let layerEdited = false;

// Track whether the map is currently in drawing mode (to prevent adjacent polygon clicks from hijacking the panel)
let isDrawing = false;
map.on('pm:drawstart', () => { isDrawing = true; });
map.on('pm:drawend', () => { isDrawing = false; });
map.on('pm:create', () => { isDrawing = false; });

const onEachFeature = (feature, layer) => {
    layer.bindPopup(`${feature.properties.id}`);

    layer.on('click', (e) => {
        showFeaturePanel(feature, layer);
        highlightSelectedLayer(layer);
        selectedLayer = layer;
    });

    layer.on('pm:edit pm:dragend pm:change', () => {
        layerEdited = true;
        updateAreaLabel();
    });
}

var selectedLayer = null;
const loadGeoData = async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const id_from = parseInt(urlParams.get('id_from'));
        const id_to = parseInt(urlParams.get('id_to'));
        const assignee = urlParams.get('assignee');

        const tb = document.getElementById('tb').value;
        const response = await fetch(`/rub3/api/getfeaturesv3/${tb}`);
        const { data } = await response.json();

        let filteredData = data;
        if (!isNaN(id_from) && !isNaN(id_to)) {
            filteredData = data.filter(item => item.id >= id_from && item.id <= id_to);
            console.log(`Filtering for ${assignee}: IDs ${id_from} - ${id_to}. Found ${filteredData.length} records.`);

            const infoEl = document.getElementById('assignmentInfo');
            if (infoEl && assignee) {
                infoEl.innerHTML = `
                    <div class="card border-0 shadow-sm" style="border-radius: 15px; background: linear-gradient(135deg, #66bb6a, #2e7d32); color: white;">
                        <div class="card-body p-3">
                            <div class="d-flex align-items-center">
                                <i class="bi bi-person-circle fs-4 me-2"></i>
                                <div>
                                    <div class="small opacity-75">ผู้รับผิดชอบ</div>
                                    <div class="fw-bold fs-5">${assignee}</div>
                                    <div class="small mt-1 px-2 py-1 bg-white bg-opacity-25 rounded-pill d-inline-block">ID: ${id_from} - ${id_to}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }


        const tableData = filteredData.map(item => {
            let geom = null;
            if (item.geom) {
                geom = JSON.parse(item.geom);
            } else if (item.geom_point) {
                geom = JSON.parse(item.geom_point);
            }
            return {
                id: item.id,
                geom: geom,
                id_farmer: item.farmer_id || '',
                name: item.name || '',
                surname: item.surname || '',
                old_year: item.old_year || '',
                classtype: item.classtype || '',
                sqm_rechac: item.sqm_rechac || 0,
                rai_rechac: item.rai_rechac || 0,
            };
        }).filter(item => item.geom !== null);


        // สร้างตารางหน้า ui
        const dataTable = $('#featureTable').DataTable({
            data: tableData,
            columns: [
                {
                    data: null,
                    title: 'Zoom',
                    render: (data, type, row) => {
                        const _geojson = JSON.stringify(row.geom);
                        return `<a class="btn btn-success map-btn" 
                                    data-refid="${row.id}" 
                                    data-geojson='${_geojson}'
                                    href="#">
                                    <em class="icon ni ni-zoom-in"></em>&nbsp;ซูม
                                </a>`
                    }
                },
                { data: 'id', title: 'ID' },
                {
                    data: 'name',
                    title: 'ชื่อ',
                    render: (data) => data || '<span class="text-muted">-</span>'
                },
                {
                    data: 'surname',
                    title: 'นามสกุล',
                    render: (data) => data || '<span class="text-muted">-</span>'
                },
                { data: 'id_farmer', title: 'เลขเกษตรกร' },
                {
                    data: 'old_year',
                    title: 'อายุ',
                    render: (data) => data || '<span class="text-muted">-</span>'
                },
                {
                    data: 'classtype',
                    title: 'สถานะ Class',
                    render: (data) => {
                        return data
                            ? '<span class="text-success">คลาสแล้ว</span>'
                            : '<span class="text-danger">ยังไม่ได้คลาส</span>';
                    }
                },
                {
                    data: 'sqm_rechac',
                    title: 'เนื้อที่ขณะนี้ (m²)',
                    render: (data) => Number(data || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })
                },
                {
                    data: 'rai_rechac',
                    title: 'เนื้อที่ขณะนี้ (ไร่)',
                    render: (data) => Number(data || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })
                }
            ],
            pageLength: 10,
            responsive: false,
            select: true,
            destroy: true,
            scrollX: true,
            initComplete: function () { }
        });

        const updateMap = () => {
            featureGroup.clearLayers(); // Clear existing layers
            const visibleRows = dataTable.rows({ search: 'applied' }).data().toArray();

            visibleRows.forEach(row => {
                const geoJsonData = {
                    type: 'Feature',
                    geometry: row.geom,
                    properties: {
                        id: row.id,
                        id_farmer: row.id_farmer,
                        name: row.name,
                        surname: row.surname,
                        sqm_rechac: row.sqm_rechac,
                        rai_rechac: row.rai_rechac,
                    }
                }

                if (row.geom.type === 'Point') {
                    // For Point geometries, add a marker with custom rubber tree icon
                    const [lng, lat] = row.geom.coordinates;
                    const marker = L.marker([lat, lng], {
                        icon: rubberTreeIcon,
                        properties: geoJsonData.properties
                    }).addTo(featureGroup);
                    marker.bindPopup(`${row.id}`);
                    marker.on('click', (e) => {
                        // ถ้ากำลัง digitize (draw) อยู่ ไม่ให้แปลงอื่นมาแย่งข้อมูล
                        if (isDrawing) return;
                        showFeaturePanel(geoJsonData, marker);
                        selectedLayer = marker;
                        highlightSelectedLayer(marker);
                    });
                } else {
                    // Add individual polygon layers directly so featureGroup.eachLayer() finds them
                    L.geoJson(geoJsonData, {
                        style: getFeatureStyle,
                        onEachFeature: onEachFeature,
                    }).eachLayer(l => featureGroup.addLayer(l));
                }
            });
        };

        updateMap();

        dataTable.on('draw', () => {
            updateMap();
        });

        $('#featureTable tbody').on('click', '.map-btn', function (e) {
            try {
                e.stopPropagation();
                const geojson = $(this).data('geojson');
                const refid = $(this).data('refid');

                if (geojson.type === 'Point') {
                    const [lng, lat] = geojson.coordinates;
                    map.setView([lat, lng], 18);
                } else {
                    const layer = L.geoJSON(geojson);
                    const bounds = layer.getBounds();
                    map.fitBounds(bounds, {
                        padding: [20, 20],
                    });
                }
                // Find the corresponding layer
                featureGroup.eachLayer(layer => {
                    if (layer instanceof L.Marker) {
                        if (layer.options.properties.id === refid) {
                            selectedLayer = layer;
                            showFeaturePanel({ properties: layer.options.properties }, layer);
                            highlightSelectedLayer(layer);
                        }
                    } else if (layer instanceof L.Path) {
                        if (layer.feature.properties.id === refid) {
                            selectedLayer = layer;
                            showFeaturePanel(layer.feature, layer);
                            highlightSelectedLayer(layer);
                        }
                    }
                });
            } catch (error) {
                console.error('Failed to parse GeoJSON:', error);
            }
        });



        dataTable.rows().every(function () {
            const rowData = this.data();
            $(this.node()).attr('id', `row_${rowData.id}`);
        });

    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load spatial data');
    }
};

map.on('click', () => { highlightSelectedLayer(null); });

document.getElementById('dashboard').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    const urlParams = new URLSearchParams(window.location.search);
    const id_from = urlParams.get('id_from');
    const id_to = urlParams.get('id_to');
    const assignee = urlParams.get('assignee');

    let url = './../reclassdash/index.html?tb=' + tb;
    if (id_from && id_to && assignee) {
        url += `&id_from=${id_from}&id_to=${id_to}&assignee=${encodeURIComponent(assignee)}`;
    }
    window.location.href = url;
});

document.getElementById('classify').addEventListener('click', async () => {
    const id = document.getElementById('id').value;
    const tb = document.getElementById('tb').value;
    if (!id || !tb) { alert('กรุณาเลือกแปลงก่อน'); return; }

    const displayName = document.getElementById('displayName').value || '';
    const urlParams = new URLSearchParams(window.location.search);
    const id_from = urlParams.get('id_from');
    const id_to = urlParams.get('id_to');
    const assignee = urlParams.get('assignee');

    let url = `./../reclass/index.html?tb=${tb}&id=${id}`;
    if (id_from && id_to && assignee) {
        url += `&id_from=${id_from}&id_to=${id_to}&assignee=${encodeURIComponent(assignee)}`;
    }

    try {
        const btn = document.getElementById('classify');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังดำเนินการ...';

        // 1. If edited, we MUST save the new geometry first
        if (layerEdited && selectedLayer) {
            let geom;
            if (selectedLayer instanceof L.Marker) {
                geom = { type: 'Point', coordinates: [selectedLayer.getLatLng().lng, selectedLayer.getLatLng().lat] };
            } else {
                geom = selectedLayer.toGeoJSON().geometry;
            }

            const res = await fetch(`/rub3/api/updatefeatures/${tb}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: id,
                    features: [{ type: 'Feature', geometry: geom, properties: { id: id } }],
                    displayName: displayName,
                    geometryChanged: true
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to update geometry');
        }

        // 2. ALWAYS Unsplit to reset reclass table (start classifying fresh)
        const resUnsplit = await fetch(`/rub3/api/unsplit_feature/${tb}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, displayName: displayName })
        });
        const dataUnsplit = await resUnsplit.json();
        if (!dataUnsplit.success) throw new Error(dataUnsplit.error || 'Failed to unsplit feature');

        layerEdited = false; // Reset state
        window.location.href = url;
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
        const btn = document.getElementById('classify');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-diagram-3-fill me-1"></i>Classify แปลงที่นี้';
    }
});

const initApp = async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const tb = urlParams.get('tb');
        if (!tb || tb === 'undefined') {
            alert('พื้นที่ไม่ถูกต้อง');
            window.location.href = './../index.html';
        } else {
            document.getElementById('tb').value = tb;
            await loadGeoData();
            map.fitBounds(featureGroup.getBounds());
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/rub3/auth/me');
        const { user } = await res.json();

        if (user) {
            document.getElementById('google-login-link').style.display = 'none';
            document.getElementById('profile-section').style.display = 'flex';
            const profileImg = document.getElementById('profile-image');
            profileImg.referrerPolicy = "no-referrer";
            profileImg.src = user.photo;
            profileImg.onerror = function() {
                this.onerror = null;
                this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=E9F5EC&color=2e7d32&rounded=true`;
            };
            document.getElementById('display-name').textContent = user.displayName;
            document.getElementById('displayName').value = user.displayName;
            _userRole = user.role || 'worker';

            await initApp();

            document.getElementById('logout-link').addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    const result = await fetch('/rub3/auth/logout');
                    const { success } = await result.json();
                    if (success) {
                        window.location.href = '/rub3/index.html';
                    } else {
                        alert('Logout failed');
                    }
                } catch (err) {
                    console.error('Logout failed:', err);
                }
            });
        } else {
            window.location.href = '/rub3/index.html';
        }
    } catch (err) {
        console.error('Failed to fetch user:', err);
    }
});




