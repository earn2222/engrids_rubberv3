// Initialize map and feature group
const map = L.map('map').setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();
const lddFeatureGroup = L.featureGroup();
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

// Add the custom tile layer
const longdoLayer = L.tileLayer('https://ms.longdo.com/mmmap/img.php?zoom={z}&x={x}&y={y}&mode=dol_hd', {
    attribution: '&copy; Longdo Map',
    tileSize: 256,
    maxZoom: 30,
    minZoom: 1
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

// const ldd_wms = L.tileLayer.wms("https://landsmaps.dol.go.th/geoserver/LANDSMAPS/wms?", {
//     layers: 'LANDSMAPS:V_PARCEL48,LANDSMAPS:V_PARCEL47',
//     // viewparams: 'utmmap:563821624',
//     viewparams: 'utmmap:482941458',
//     format: 'image/png',
//     transparent: true,
//     maxZoom: 24,
//     zIndex: 6
// });

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
    "landsmaps": lddFeatureGroup,
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

map.on('pm:create', (e) => {
    const layer = e.layer;
    featureGroup.addLayer(layer);
    layer.pm.enable();

    // If a point is selected, replace it with this new polygon
    if (selectedLayer && selectedLayer instanceof L.Marker) {
        const properties = selectedLayer.options.properties || (selectedLayer.feature && selectedLayer.feature.properties) || {};
        layer.feature = { type: 'Feature', properties: { ...properties } };

        featureGroup.removeLayer(selectedLayer);
        selectedLayer = layer;
        layerEdited = true;

        layer.bindPopup(`${properties.id}`);
        layer.on('click', (ev) => {
            showFeaturePanel(layer.feature, layer);
            featureGroup.eachLayer(l => l.pm.disable());
            layer.pm.enable();
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

const formatArea = (area) => {
    return area >= 1e6
        ? `${(area / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} km²`
        : `${area.toLocaleString(undefined, { maximumFractionDigits: 2 })} m²`;
};

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
            if (typeof turf !== 'undefined' && turf.lineToPolygon) {
                try {
                    geometry = turf.lineToPolygon(geojsonFeature).geometry;
                } catch (e) {
                    // Let it pass with warning if it's an incomplete line
                }
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
        const sqm_pacel = document.getElementById('xls_sqm').value;

        console.log(`Area result: ${area}, target: ${sqm_pacel}`);
        document.getElementById('shparea_sqm').value = area.toFixed(0);
        const diff = Math.abs(area - sqm_pacel);

        if (diff >= 100) {
            document.getElementById('message').innerHTML = '<h5><span class="badge bg-danger">เนื้อที่ยังไม่เท่ากัน</span></h5>';
        } else {
            document.getElementById('message').innerHTML = '<h5><span class="badge bg-success">เนื้อที่ใกล้เคียงกัน</span></h5>';
        }
    } catch (error) {
        console.error('Error updating label:', error);
    }
};

function showFeaturePanel(feature, layer) {
    const xls = Number(feature.properties.xls_sqm);
    const id = document.getElementById('id');
    const xls_app_no = document.getElementById('xls_app_no');
    const xls_sqm = document.getElementById('xls_sqm');
    const refinal = document.getElementById('refinal');

    id.value = feature.properties.id;
    xls_app_no.value = feature.properties.id_farmer || '';
    xls_sqm.value = feature.properties.sqm_pacel || 0;
    document.getElementById('shparea_sqm').value = Number(feature.properties.shparea_sq || 0).toFixed(0);
    refinal.value = feature.properties.refinal || '';

    // Only update area label if explicitly editing or needed,
    // but don't overwrite the initial database value shparea_sq immediately on click
    // if the user wants to see the column value.
    const currentMsg = document.getElementById('message');
    const target = Number(feature.properties.sqm_pacel || 0);
    const current = Number(feature.properties.shparea_sq || 0);
    const diff = Math.abs(target - current);

    if (diff <= 100) {
        currentMsg.innerHTML = '<h5><span class="badge bg-success">เนื้อที่ใกล้เคียงกัน</span></h5>';
    } else {
        currentMsg.innerHTML = '<h5><span class="badge bg-danger">เนื้อที่ยังไม่เท่ากัน</span></h5>';
    }
}

const getFeatureStyle = (feature) => {
    const target = Number(feature.properties.sqm_pacel || 0);
    const shp = Number(feature.properties.shparea_sq || 0);
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

const onEachFeature = (feature, layer) => {
    layer.bindPopup(`${feature.properties.id}`);

    layer.on('click', (e) => {
        showFeaturePanel(feature, layer);
        featureGroup.eachLayer(l => l.pm.disable());
        layer.pm.enable();
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
        const tb = document.getElementById('tb').value;
        const response = await fetch(`/rub/api/getfeatures/${tb}`);
        const { data } = await response.json();

        const tableData = data.map(item => {
            let geom = null;
            if (item.geom) {
                geom = JSON.parse(item.geom);
            } else if (item.geom_point) {
                geom = JSON.parse(item.geom_point);
            }
            return {
                id: item.id,
                refinal: item.refinal,
                farm_name: `${item.f_name || ''} ${item.l_name || ''}`.trim(),
                f_name: item.f_name,
                l_name: item.l_name,
                age: item.age,
                geom: geom,
                id_farmer: item.id_farmer,
                sqm_pacel: item.sqm_pacel,
                shparea_sq: item.shparea_sq,
                classified: item.classified,
            };
        }).filter(item => item.geom !== null); // Filter out items without geometry

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
                { data: 'farm_name', title: 'farm_name' },
                { data: 'f_name', title: 'f_name' },
                { data: 'l_name', title: 'l_name' },
                { data: 'age', title: 'age' },
                { data: 'id_farmer', title: 'Application No' },
                { data: 'sqm_pacel', title: 'เนื้อที่เป้าหมาย (m²)' },
                {
                    data: 'shparea_sq',
                    title: 'เนื้อที่ขณะนี้ (m²)',
                    render: (data, type, row) => Number(data || 0).toFixed(0)
                },
                {
                    data: null,
                    title: 'ตรวจสอบ (m²)',
                    render: (data, type, row) => {
                        const target = Number(row.sqm_pacel || 0);
                        const current = Number(row.shparea_sq || 0);
                        const diff = target - current;
                        const color = Math.abs(diff) <= 100 ? 'green' : 'red';
                        const diffStyle = `color: ${color}; font-weight: bold;`;
                        return `<span style="${diffStyle}">
                                    ${Math.abs(diff) <= 100 ? "เนื้อที่ถูกต้อง" : "เนื้อที่ไม่ถูกต้อง"}
                                    (${diff.toLocaleString(undefined, { maximumFractionDigits: 1 })})
                                </span>`;
                    }
                },
                {
                    data: 'classified',
                    title: 'Classified',
                    render: (data, type, row) => {
                        const color = data ? 'green' : 'red';
                        const diffStyle = `color: ${color}; font-weight: bold;`;
                        return `<span style="${diffStyle}">${data ? "classify แล้ว" : "ยังไม่ classify"}</span>`;
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
                        sqm_pacel: row.sqm_pacel,
                        shparea_sq: row.shparea_sq
                    }
                }

                if (row.geom.type === 'Point') {
                    // For Point geometries, add a marker
                    const [lng, lat] = row.geom.coordinates;
                    const marker = L.marker([lat, lng], {
                        properties: geoJsonData.properties
                    }).addTo(featureGroup);
                    marker.bindPopup(`${row.id}`);
                    marker.on('click', (e) => {
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
    const currentShpareaSq = document.getElementById('shparea_sqm').value;

    const features = [];
    const geojson = selectedLayer.toGeoJSON();
    let finalGeojson = geojson;
    if (geojson.geometry.type === 'LineString' || geojson.geometry.type === 'MultiLineString') {
        if (typeof turf !== 'undefined' && turf.lineToPolygon) {
            try {
                // Try to auto-close the line if it was drawn as Polyline
                finalGeojson = turf.lineToPolygon(geojson);
                finalGeojson.properties = geojson.properties;
            } catch (e) {
                alert('กรุณาวาดเส้นให้บรรจบกันเป็นรูปปิด (Polygon)');
                return;
            }
        } else {
            alert('กรุณาวาดรูปปิด (Polygon) แทนการวาดเส้น');
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
                    layer.pm.enable();
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
        alert(`อัพเดท features ${result.updated} เรียบร้อย`);

        if (result.success) {
            featureGroup.eachLayer(layer => {
                layer.pm.disable();
                layer.areaLabel?.remove();
            });

            featureGroup.clearLayers();
            loadGeoData();
            document.getElementById('restoreId').value = "";
            const modal = document.getElementById("restoreModal");
            if (modal) {
                const bsModal = bootstrap.Modal.getInstance(modal);
                bsModal.hide();
            } else {
                console.error(`Modal with ID ${modalId} not found.`);
            }
        } else {
            alert('Failed to update features');
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
    fetch(`/rub/api/create_reclass_feature/${tb}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    }).then(response => response.json())
        .then(data => {
            if (data.success) {
                const xls_sqm = document.getElementById('xls_sqm').value;
                window.open(`/rub/reclass/index.html?tb=${tb}&id=${id}&xls_sqm=${xls_sqm}`, '_self');
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
    window.location.href = './../reclassdash/index.html?tb=' + tb;
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

document.getElementById('dashboard').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reclassdash/index.html?tb=' + tb;
});



