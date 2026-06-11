// Initialize map and feature group
const map = L.map('map', { maxZoom: 22 }).setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();
const lddFeatureGroup = L.featureGroup();

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

// shpall background layer — loaded from database, shown when checkbox is toggled
const shpallLayer = L.featureGroup();  // placeholder group — data loaded on first add
let shpallLoaded = false;

async function loadShpallLayer() {
    if (shpallLoaded) return;
    try {
        const res = await fetch('/rub/api/shpall');
        const data = await res.json();
        if (!data.success || !data.features || data.features.length === 0) {
            console.warn('shpall: ไม่พบข้อมูลหรือยังไม่มี table', data);
            return;
        }
        L.geoJSON({ type: 'FeatureCollection', features: data.features }, {
            interactive: false,
            style: () => ({
                color: '#0055ff',
                weight: 2.5,
                opacity: 0.9,
                fillColor: '#0055ff',
                fillOpacity: 0.15,
                dashArray: '4 4'
            })
        }).addTo(shpallLayer);
        shpallLoaded = true;
        console.log(`shpall: โหลดสำเร็จ ${data.features.length} แปลง`);
    } catch (err) {
        console.error('shpall load error:', err);
    }
}

// Listen for layer add event to lazy-load data
shpallLayer.on('add', () => loadShpallLayer());


const baseLayers = {
    "Google Road": gmap_road,
    "Google Satellite": gmap_sat.addTo(map),
    "Google Terrain": gmap_terrain,
    "Google Hybrid": gmap_hybrid,
    "Stadia Light": light
};

const overlayMaps = {
    "แปลงยาง": featureGroup.addTo(map),
    "แปลงยาง (เดิม)": shpallLayer,
    "Longdo Map": longdoLayer.addTo(map),
};

L.control.layers(baseLayers, overlayMaps).addTo(map);


map.on('click', (e) => {
    console.log(e.latlng);

})
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

// Disable browser default context menu on map so right-click can delete nodes
map.getContainer().addEventListener('contextmenu', (e) => e.preventDefault());

// Set global Geoman option: right-click removes vertex
map.pm.setGlobalOptions({ removeVertexOn: 'contextmenu' });

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
            layerEdited = false;
            selectedLayer = layer;
        });

        layer.on('pm:edit pm:dragend pm:change', () => {
            layerEdited = true;
            updateAreaLabel();
        });

        updateAreaLabel();
    } else {
        // If nothing was selected or a polygon was selected, just set as selected
        selectedLayer = layer;
        layerEdited = true;
        updateAreaLabel();
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
const updateAreaLabel = async () => {
    if (!selectedLayer) return;
    try {
        const geojsonFeature = selectedLayer.toGeoJSON();
        let geometry = geojsonFeature.geometry || (geojsonFeature.features && geojsonFeature.features[0]?.geometry);

        if (!geometry) {
            console.warn('updateAreaLabel: no geometry found on selectedLayer');
            return;
        }

        if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
            try {
                let polygonFeature = customLineToPolygon(geojsonFeature);
                geometry = polygonFeature.geometry;
            } catch (e) {
                // Let it pass with warning if it's an incomplete line
            }
        }

        console.log('Calculating area for geometry:', JSON.stringify(geometry).substring(0, 100));

        const res = await fetch(`/rub/api/area`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ geometry })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`API error ${res.status}: ${errText}`);
        }

        const { area } = await res.json();
        const target_area = Number(document.getElementById('deed_sqm').value.replace(/,/g, ''));

        console.log(`Area result: ${area}, target: ${target_area}`);
        document.getElementById('current_sqm').value = Math.round(area).toLocaleString();
        document.getElementById('current_rai').value = (area / 1600).toLocaleString(undefined, { maximumFractionDigits: 2 });
        
        const diff = Math.abs(area - target_area);

        if (diff > 100) {
            document.getElementById('message').innerHTML = '<h5><span class="badge bg-danger">เนื้อที่ยังไม่เท่ากัน</span></h5>';
        } else {
            document.getElementById('message').innerHTML = '<h5><span class="badge bg-success">เนื้อที่ใกล้เคียงกัน</span></h5>';
        }
    } catch (error) {
        console.error('Error updating label:', error);
    }
};

function showFeaturePanel(feature, layer) {
    const id = document.getElementById('id');
    const xls_id_farmer = document.getElementById('xls_id_farmer');
    const deed_sqm = document.getElementById('deed_sqm');
    const deed_total = document.getElementById('deed_total');
    const current_sqm = document.getElementById('current_sqm');
    const current_rai = document.getElementById('current_rai');
    const refinal = document.getElementById('refinal');

    id.value = feature.properties.id;
    xls_id_farmer.value = feature.properties.id_farmer || '';
    document.getElementById('Rubr_Sqm').value = Number(feature.properties.rubr_sqm || 0);
    const deed_sqm_val = Number(feature.properties.deed_sqm || 0);
    const deed_total_val = Number(feature.properties.deed_total || 0);
    const lbl_deed_sqm = document.getElementById('lbl_deed_sqm');
    const lbl_deed_total = document.getElementById('lbl_deed_total');

    let targetSqm = deed_sqm_val;

    if (deed_sqm_val === 0) {
        lbl_deed_sqm.innerText = 'เนื้อที่เป้าหมายยางพารา (m²):';
        lbl_deed_total.innerText = 'เนื้อที่เป้าหมายยางพารา (ไร่):';
        targetSqm = Number(feature.properties.rubr_sqm || 0);
        deed_sqm.value = targetSqm.toLocaleString(undefined, { maximumFractionDigits: 2 });
        deed_total.value = Number(feature.properties.rubr_total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
    } else {
        lbl_deed_sqm.innerText = 'เนื้อที่เป้าหมายโฉนด (m²):';
        lbl_deed_total.innerText = 'เนื้อที่เป้าหมายโฉนด (ไร่):';
        deed_sqm.value = targetSqm.toLocaleString(undefined, { maximumFractionDigits: 2 });
        deed_total.value = deed_total_val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    if (layer && layer instanceof L.Marker) {
        current_sqm.value = '0';
        current_rai.value = '0';
    } else {
        current_sqm.value = Math.round(Number(feature.properties.current_sqm || 0)).toLocaleString();
        current_rai.value = Number(feature.properties.current_rai || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    refinal.value = feature.properties.refinal || '';

    const currentMsg = document.getElementById('message');
    const target = targetSqm;
    const current = Number(feature.properties.current_sqm || 0);  // เปรียบเทียบ m² กับ m²
    const diff = Math.abs(target - current);

    if (diff <= 100) {
        currentMsg.innerHTML = '<h5><span class="badge bg-success">เนื้อที่ใกล้เคียงกัน</span></h5>';
    } else {
        currentMsg.innerHTML = '<h5><span class="badge bg-danger">เนื้อที่ยังไม่เท่ากัน</span></h5>';
    }
}

const getFeatureStyle = (feature) => {
    let target = Number(feature.properties.deed_sqm || 0);
    if (target === 0) {
        target = Number(feature.properties.rubr_sqm || 0);
    }
    const shp = Number(feature.properties.current_sqm || 0);  // เปรียบเทียบ m² กับ m²
    const diff = target - shp;
    const isEqual = Math.abs(diff) <= 100;

    return {
        color: isEqual ? '#00cc00' : '#FF7601',
        weight: 2,
        opacity: 0.9,
        fillColor: isEqual ? '#90ee90' : '#FFBF78',
        fillOpacity: 0.1
    };
};

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
        // ถ้ากำลัง digitize (draw) อยู่ ไม่ให้แปลงอื่นมาแย่งข้อมูล
        if (isDrawing) return;
        showFeaturePanel(feature, layer);
        featureGroup.eachLayer(l => l.pm.disable());
        layer.pm.enable({ removeVertexOn: 'contextmenu' });
        layerEdited = false; // reset on new selection
        selectedLayer = layer;
    });

    // Listen to pm:enable to attach a real-time change listener.
    // Skip the FIRST pm:change (auto-fired by pm.enable itself), then respond to all actual user edits.
    layer.on('pm:enable', () => {
        let firstChange = true;
        const onGeomChange = () => {
            if (firstChange) { firstChange = false; return; } // ignore enable-triggered change
            layerEdited = true;
            updateAreaLabel(); // uses selectedLayer internally
        };
        layer.on('pm:change', onGeomChange);
        // Clean up listener when editing is disabled
        layer.once('pm:disable', () => {
            layer.off('pm:change', onGeomChange);
        });
    });

    // Also fire once on final edit/dragend
    layer.on('pm:edit pm:dragend', () => {
        layerEdited = true;
        updateAreaLabel(); // uses selectedLayer internally
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
        const response = await fetch(`/rub/api/getfeaturesv3/${tb}`);
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
                refinal: item.refinal,
                farm_name: item['Full_nam'] || '',
                f_name: item['F_name'] || '',
                l_name: item['L_name'] || '',
                age: item['Para_Age'] || '',
                geom: geom,
                id_farmer: item['Farmer_ID'] || '',
                deed_id: item['Deed_ID'] || '',
                deed_sqm: item['Deed_Sqm'] || 0,          // เนื้อที่เป้าหมายโฉนด (m²) = Deed_Sqm
                deed_total: item['Deed_total'] || 0,        // เนื้อที่เป้าหมายโฉนด (ไร่) = Deed_total
                rubr_sqm: item['Rubr_Sqm'] || 0,
                rubr_total: item['Rubr_Area'] || 0,
                current_sqm: item['Sqm_Deed'] || 0,         // เนื้อที่ขณะนี้ (m²) = Sqm_Deed
                current_rai: item['Deed_Area'] || 0,        // เนื้อที่ขณะนี้ (ไร่) = Deed_Area
                classified: item.classified,
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
                { data: 'farm_name', title: 'ชื่อเกษตรกร' },
                { data: 'age', title: 'อายุ (ปี)' },
                { data: 'id_farmer', title: 'เลขทะเบียนเกษตรกร' },
                { data: 'deed_id', title: 'เลขโฉนด' },
                { 
                    data: 'deed_sqm', 
                    title: 'เนื้อที่เป้าหมายโฉนด (m²)',
                    render: (data, type, row) => Math.round(Number(data || 0)).toLocaleString()
                },
                { 
                    data: 'current_sqm', 
                    title: 'เนื้อที่ขณะนี้ (m²)',
                    render: (data, type, row) => Math.round(Number(data || 0)).toLocaleString()
                },
                {
                    data: null,
                    title: 'ตรวจสอบ (m²)',
                    render: (data, type, row) => {
                        const target = Number(row.deed_sqm || 0);
                        const current = Number(row.current_sqm || 0);  // เปรียบเทียบ m² กับ m²
                        const diff = Math.round(target - current);
                        const color = Math.abs(diff) <= 100 ? 'green' : 'red';
                        const diffStyle = `color: ${color}; font-weight: bold;`;
                        return `<span style="${diffStyle}">
                                    ${Math.abs(diff) <= 100 ? "เนื้อที่ถูกต้อง" : "เนื้อที่ไม่ถูกต้อง"}
                                    (${diff.toLocaleString()})
                                </span>`;
                    }
                },
                {
                    data: 'classified',
                    title: 'Classified',
                    render: (data, type, row) => {
                        const color = data ? 'green' : 'red';
                        const diffStyle = `color: ${color}; font-weight: bold;`;
                        return `<span style="${diffStyle}">${data ? "Classify แล้ว" : "ยังไม่ Classify"}</span>`;
                    }
                },
                {
                    data: null,
                    title: 'ลบข้อมูล',
                    render: (data, type, row) => {
                        return `<button class="btn btn-danger btn-sm btn-icon delete-btn" data-id="${row.id}" title="ลบข้อมูลแปลงนี้">
                                    <i class="bi bi-trash"></i>
                                </button>`;
                    }
                }
            ],
            pageLength: 10,
            responsive: false,
            select: true,
            destroy: true,
            scrollX: true,
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
                        refinal: row.refinal,
                        id_farmer: row.id_farmer,
                        deed_sqm: row.deed_sqm,
                        deed_total: row.deed_total,
                        rubr_sqm: row.rubr_sqm,
                        rubr_total: row.rubr_total,
                        current_sqm: row.current_sqm,
                        current_rai: row.current_rai
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
                    });
                } else {
                    // For Polygon/MultiPolygon, add as GeoJSON layer
                    L.geoJson(geoJsonData, {
                        style: getFeatureStyle,
                        onEachFeature: onEachFeature,
                    }).addTo(featureGroup);
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
                        }
                    } else if (layer instanceof L.Path) {
                        if (layer.feature.properties.id === refid) {
                            selectedLayer = layer;
                            showFeaturePanel(layer.feature, layer);
                        }
                    }
                });
            } catch (error) {
                console.error('Failed to parse GeoJSON:', error);
            }
        });

        // Event listener for the new delete button
        $('#featureTable tbody').on('click', '.delete-btn', async function (e) {
            e.stopPropagation();
            const id = $(this).data('id');
            const tb = document.getElementById('tb').value;

            if (confirm(`คุณต้องการลบข้อมูลแปลงนี้ใช่หรือไม่? (ID: ${id})`)) {
                try {
                    const response = await fetch(`/rub/api/deletefeature/${tb}/${id}`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    const result = await response.json();

                    if (result.success) {
                        alert(`ลบข้อมูลสำเร็จ (ID: ${id})`);
                        // Clear the map layers before reloading data
                        featureGroup.eachLayer(layer => {
                            layer.pm.disable();
                            layer.areaLabel?.remove();
                        });
                        featureGroup.clearLayers();
                        // Reset side panel
                        document.getElementById('id').value = '';
                        document.getElementById('xls_id_farmer').value = '';
                        document.getElementById('Rubr_Sqm').value = '';
                        document.getElementById('deed_sqm').value = '';
                        document.getElementById('deed_total').value = '';
                        document.getElementById('current_sqm').value = '';
                        document.getElementById('current_rai').value = '';
                        document.getElementById('refinal').value = '';
                        document.getElementById('restoreId').value = '';
                        document.getElementById('message').innerHTML = '';
                        selectedLayer = null;

                        await loadGeoData(); // Reload table and map
                    } else {
                        alert('เกิดข้อผิดพลาดในการลบข้อมูล: ' + (result.error || ''));
                    }
                } catch (error) {
                    console.error('Error deleting data:', error);
                    alert('ไม่สามารถลบข้อมูลได้');
                }
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

map.on('click', (e) => featureGroup.eachLayer(l => l.pm.disable()));

document.getElementById('save').addEventListener('click', async () => {
    if (!selectedLayer) {
        alert('กรุณาเลือกแปลงที่ต้องการบันทึกก่อน');
        return;
    }

    const id = document.getElementById('id').value;
    const refinal = document.getElementById('refinal').value;
    const displayName = document.getElementById('displayName').value;
    const currentShpareaSq = document.getElementById('current_sqm').value.replace(/,/g, '');

    const features = [];
    const geojson = selectedLayer.toGeoJSON();
    let finalGeojson = geojson;
    if (geojson.geometry.type === 'LineString' || geojson.geometry.type === 'MultiLineString') {
        try {
            // Try to auto-close the line if it was drawn as Polyline
            finalGeojson = customLineToPolygon(geojson);
        } catch (e) {
            alert('กรุณาวาดเส้นให้บรรจบกันเป็นรูปปิด (Polygon)');
            return;
        }
    }
    features.push(finalGeojson);

    try {
        const tb = document.getElementById('tb').value;
        const response = await fetch(`/rub/api/updatefeatures/${tb}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, refinal, features, displayName, geometryChanged: layerEdited, currentShpareaSq })
        });
        const result = await response.json();

        if (result.success) {
            layerEdited = false; // reset flag after successful save
            featureGroup.eachLayer(layer => {
                layer.pm.disable();
                layer.areaLabel?.remove();
            });

            featureGroup.clearLayers();
            await loadGeoData(); // Wait for reload

            // After reload, re-select the saved feature and restore sidebar from DB values
            const savedId = Number(id);
            featureGroup.eachLayer(layer => {
                if (layer.feature && layer.feature.properties.id === savedId) {
                    selectedLayer = layer;
                    showFeaturePanel(layer.feature, layer);
                    layer.pm.enable({ removeVertexOn: 'contextmenu' });
                }
            });

            alert(`อัพเดท features เรียบร้อย (ID: ${id})`);
        } else {
            alert('Failed to update features: ' + (result.error || ''));
        }
    } catch (error) {
        console.error('Error saving data:', error);
        alert('Failed to save data');
    }
});

document.getElementById("restore").addEventListener("click", () => {
    try {
        const modal = document.getElementById("restoreModal");
        if (modal) {
            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();
        } else {
            console.error(`Modal with ID ${modalId} not found.`);
        }
    } catch (error) {
        console.error('Failed to fetch user:', err);
    }
})

document.getElementById('btnRestore').addEventListener("click", async () => {
    try {
        const tb = document.getElementById('tb').value;
        const id = document.getElementById('restoreId').value;
        const response = await fetch(`/rub/api/restorefeatures/${tb}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const result = await response.json();

        if (result.success) {
            // อัปเดตค่า current_sqm/current_rai ใน sidebar จากข้อมูลที่ restore กลับมา
            const restoredDeedArea = Number(result.data?.['Deed_Area'] || 0);
            const restoredSqmDeed  = Number(result.data?.['Sqm_Deed']  || 0);
            document.getElementById('current_sqm').value = Math.round(restoredSqmDeed).toLocaleString();
            document.getElementById('current_rai').value = restoredDeedArea.toLocaleString(undefined, { maximumFractionDigits: 2 });

            // เปรียบเทียบกับ target เพื่ออัปเดต message
            const target = Number(document.getElementById('deed_sqm').value.replace(/,/g, '') || 0);
            const diff = Math.abs(target - restoredSqmDeed);
            document.getElementById('message').innerHTML = diff <= 100
                ? '<h5><span class="badge bg-success">เนื้อที่ใกล้เคียงกัน</span></h5>'
                : '<h5><span class="badge bg-danger">เนื้อที่ยังไม่เท่ากัน</span></h5>';

            featureGroup.eachLayer(layer => {
                layer.pm.disable();
                layer.areaLabel?.remove();
            });

            featureGroup.clearLayers();
            await loadGeoData();
            document.getElementById('restoreId').value = "";
            const modal = document.getElementById("restoreModal");
            if (modal) {
                const bsModal = bootstrap.Modal.getInstance(modal);
                bsModal.hide();
            }
            alert(`Restore เรียบร้อย (ID: ${id})\nเนื้อที่: ${restoredArea.toFixed(0)} m²`);
        } else {
            alert('Failed to restore features: ' + (result.error || ''));
        }
    } catch (error) {
        console.error('Error restoring data:', error);
        alert('Failed to restore data');
    }
});

// เลือกไอดี
document.getElementById('classify').addEventListener('click', () => {
    const id = document.getElementById('id').value;
    if (!id) {
        alert('เลือกแปลงที่ต้องการ classify ก่อน');
        return;
    }
    const tb = document.getElementById('tb').value;

    // Capture current assignment params
    const urlParams = new URLSearchParams(window.location.search);
    const id_from = urlParams.get('id_from');
    const id_to = urlParams.get('id_to');
    const assignee = urlParams.get('assignee');

    let url = `/rub/reclass/index.html?tb=${tb}&id=${id}&Rubr_Sqm=${document.getElementById('Rubr_Sqm').value}`;
    if (id_from && id_to && assignee) {
        url += `&id_from=${id_from}&id_to=${id_to}&assignee=${encodeURIComponent(assignee)}`;
    }

    fetch(`/rub/api/create_reclass_feature/${tb}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    }).then(response => response.json())
        .then(data => {
            if (data.success) {
                window.open(url, '_self');
            } else {
                alert('Failed to create reclassification layer');
            }
        }).catch(error => {
            console.error('Error creating reclassification layer:', error);
            alert('Failed to create reclassification layer');
        });
});


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




