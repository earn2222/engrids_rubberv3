// ============================================================
//  app.js — Reclass page (OpenLayers version)
//  Features:
//    - OpenLayers map with Google / WMS / GEE layers
//    - Click polygon to select → show info panel
//    - "วาดเส้นตัด" button → draw split line interactively
//    - "Split แปลง" button → call API, zero-gap guarantee
//    - Merge mode (multi-select polygons)
//    - Save edited geometry
// ============================================================

// ── 1. Projection helpers ─────────────────────────────────
const EPSG4326 = 'EPSG:4326';
const EPSG3857 = 'EPSG:3857';

// ── 2. Base tile sources ──────────────────────────────────
function googleSource(lyrs) {
    return new ol.source.XYZ({
        url: `https://mt0.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}`,
        maxZoom: 18
    });
}

const gmapSatLayer = new ol.layer.Tile({ source: googleSource('s'), title: 'Google Satellite' });
const gmapRoadLayer = new ol.layer.Tile({ source: googleSource('m'), title: 'Google Road', visible: false });
const gmapHybrid = new ol.layer.Tile({ source: googleSource('y'), title: 'Google Hybrid', visible: false });
const gmapTerrain = new ol.layer.Tile({ source: googleSource('p'), title: 'Google Terrain', visible: false });
const longdoLayer = new ol.layer.Tile({
    source: new ol.source.XYZ({
        url: 'https://ms.longdo.com/mmmap/img.php?zoom={z}&x={x}&y={y}&mode=dol_hd',
        maxZoom: 18
    }),
    title: 'Longdo Map'
});

const ndviWms = new ol.layer.Tile({
    source: new ol.source.TileWMS({
        url: 'https://engrids.soc.cmu.ac.th/geoserver/gwc/service/wms?',
        params: { LAYERS: 'rubber:rubber4326', FORMAT: 'image/png', TRANSPARENT: true },
        serverType: 'geoserver'
    }),
    title: 'NDVI WMS',
    visible: false,
    zIndex: 5
});

const rubberParcelWms = new ol.layer.Tile({
    source: new ol.source.TileWMS({
        url: 'https://engrids.soc.cmu.ac.th/geoserver/rubber/wms?',
        params: { LAYERS: 'rubber:rubber_pacel', FORMAT: 'image/png', TRANSPARENT: true },
        serverType: 'geoserver'
    }),
    title: 'แปลงยาง (เดิม)',
    visible: false,
    zIndex: 6
});

const tcLayer = new ol.layer.Tile({
    visible: false,
    zIndex: 3
});

const ndviGeeLayer = new ol.layer.Tile({
    visible: false,
    zIndex: 4
});

// ── 3. Vector layers ──────────────────────────────────────
const vectorSource = new ol.source.Vector();
const vectorLayer = new ol.layer.Vector({
    source: vectorSource,
    style: featureStyleFn,
    zIndex: 10
});

// Layer for the split-line being drawn
const splitLineSource = new ol.source.Vector();
const splitLineLayer = new ol.layer.Vector({
    source: splitLineSource,
    style: function(f) {
        return [
            // Line
            new ol.style.Style({
                stroke: new ol.style.Stroke({ color: '#ff4400', width: 2, lineDash: [6, 4] })
            }),
            // Faint midpoints (ลางๆ)
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 4.5,
                    fill: new ol.style.Fill({ color: 'rgba(255, 68, 0, 0.25)' }),
                    stroke: new ol.style.Stroke({ color: 'rgba(255, 255, 255, 0.5)', width: 1.5 })
                }),
                geometry: function(feature) {
                    const geom = feature.getGeometry();
                    if (!geom) return null;
                    if (geom.getType() === 'LineString') {
                        const coords = geom.getCoordinates();
                        let midpoints = [];
                        for (let i = 0; i < coords.length - 1; i++) {
                            midpoints.push([
                                (coords[i][0] + coords[i + 1][0]) / 2,
                                (coords[i][1] + coords[i + 1][1]) / 2
                            ]);
                        }
                        return midpoints.length > 0 ? new ol.geom.MultiPoint(midpoints) : null;
                    }
                    return null;
                }
            }),
            // Vertices
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 5,
                    fill: new ol.style.Fill({ color: '#ff4400' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 })
                }),
                geometry: function(feature) {
                    const geom = feature.getGeometry();
                    if (!geom) return null;
                    if (geom.getType() === 'LineString') {
                        return new ol.geom.MultiPoint(geom.getCoordinates());
                    }
                    return null;
                }
            })
        ];
    },
    zIndex: 20
});

// ── 4. Map ────────────────────────────────────────────────
const map = new ol.Map({
    target: 'map',
    layers: [gmapSatLayer, gmapRoadLayer, gmapHybrid, gmapTerrain, longdoLayer,
        tcLayer, ndviGeeLayer, ndviWms, rubberParcelWms, vectorLayer, splitLineLayer],
    view: new ol.View({
        center: ol.proj.fromLonLat([100.8784385963758, 18.819620993471577]),
        zoom: 13,
        maxZoom: 22
    })
});

// Disable double-click zoom to prevent unwanted zooming while drawing split line
map.getInteractions().forEach(interaction => {
    if (interaction instanceof ol.interaction.DoubleClickZoom) {
        map.removeInteraction(interaction);
    }
});

// Simple layer switcher (top-right)
buildLayerSwitcher();

// ── 5. Colour map ─────────────────────────────────────────
const CLASS_COLORS = {
    'rubber': '#006d2c',
    'Other': '#ff0004',
    'not-rubber': '#9900ff',
    'ex-pond': '#00fff2',
    'ex-landcover': '#ffe600',
    'ex-building': '#ff00d4',
    'ex-river': '#1100ff',
    'ex-unreg-rubber': '#00ff0d',
};
const DEFAULT_COLOR = '#fdae61';

function getColor(classtype) {
    return CLASS_COLORS[classtype] || DEFAULT_COLOR;
}

function featureStyleFn(feature, _resolution) {
    const ct = feature.get('classtype');
    const sel = feature.get('selected');
    const merge = feature.get('mergeSelected');
    const color = getColor(ct);
    
    const styles = [];
    
    // Polygon base style
    styles.push(new ol.style.Style({
        fill: new ol.style.Fill({ color: hexToRgba(color, merge ? 0.45 : sel ? 0.35 : 0.2) }),
        stroke: new ol.style.Stroke({
            color: merge ? '#ffff00' : sel ? '#0ccbf0' : '#ffffff',
            width: merge ? 4 : sel ? 5 : 2,
            lineDash: (merge || sel) ? undefined : [4, 3]
        })
    }));

    // Node (vertex) style
    styles.push(new ol.style.Style({
        image: new ol.style.Circle({
            radius: (sel || merge) ? 4 : 3,
            fill: new ol.style.Fill({ color: (sel || merge) ? '#ffffff' : color }),
            stroke: new ol.style.Stroke({ 
                color: merge ? '#ffff00' : sel ? '#0ccbf0' : '#ffffff', 
                width: (sel || merge) ? 2 : 1.5 
            })
        }),
        geometry: function(f) {
            const geom = f.getGeometry();
            if (!geom) return null;
            let coords = [];
            if (geom.getType() === 'Polygon') {
                coords = geom.getCoordinates()[0]; // Only external ring for simplicity, or we could include holes if needed
            } else if (geom.getType() === 'MultiPolygon') {
                geom.getCoordinates().forEach(poly => {
                    coords.push(...poly[0]);
                });
            }
            return coords.length > 0 ? new ol.geom.MultiPoint(coords) : null;
        }
    }));

    // Faint Midpoints for selected feature in Edit Mode
    if (sel && editMode) {
        styles.push(new ol.style.Style({
            image: new ol.style.Circle({
                radius: 4,
                fill: new ol.style.Fill({ color: 'rgba(12, 203, 240, 0.25)' }),
                stroke: new ol.style.Stroke({ color: 'rgba(255, 255, 255, 0.6)', width: 1.5 })
            }),
            geometry: function(f) {
                const geom = f.getGeometry();
                if (!geom) return null;
                let midpoints = [];
                if (geom.getType() === 'Polygon') {
                    const coords = geom.getCoordinates()[0];
                    for (let i = 0; i < coords.length - 1; i++) {
                        midpoints.push([
                            (coords[i][0] + coords[i + 1][0]) / 2,
                            (coords[i][1] + coords[i + 1][1]) / 2
                        ]);
                    }
                } else if (geom.getType() === 'MultiPolygon') {
                    geom.getCoordinates().forEach(poly => {
                        const coords = poly[0];
                        for (let i = 0; i < coords.length - 1; i++) {
                            midpoints.push([
                                (coords[i][0] + coords[i + 1][0]) / 2,
                                (coords[i][1] + coords[i + 1][1]) / 2
                            ]);
                        }
                    });
                }
                return midpoints.length > 0 ? new ol.geom.MultiPoint(midpoints) : null;
            }
        }));
    }

    return styles;
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ── 6. State ─────────────────────────────────────────────
let selectedFeature = null;   // OL Feature currently selected
let splitLineCoords = null;   // GeoJSON coords of the drawn split line
let drawInteraction = null;   // ol.interaction.Draw instance
let modifyInteraction = null;   // ol.interaction.Modify instance
let snapInteraction = null;   // ol.interaction.Snap instance
let editMode = false;  // polygon edit mode flag
let editSource = new ol.source.Vector(); // temp source for editing
let mergeMode = false;
let selectedForMerge = [];     // array of OL Features
let skipNextClick = false;    // prevent click handler from deselecting after drawend

// ── 7. Area helpers ──────────────────────────────────────
async function calculateArea(geometry) {
    const res = await fetch('/rub/api/area', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry })
    });
    if (!res.ok) throw new Error('Failed to calculate area');
    return (await res.json()).area;
}

async function updateAreaDisplay(feature) {
    try {
        const geomGeoJSON = featureToGeoJSON(feature);
        const area = await calculateArea(geomGeoJSON.geometry);
        const round = Math.round(area);
        document.getElementById('shpsplit_sqm').value = round;

        const sqmYang = parseFloat(document.getElementById('sqm_yang').value);
        const el = document.getElementById('checkarea');
        if (Math.abs(sqmYang - area) <= 800) {
            el.innerHTML = '<span style="color:green">* พื้นที่ตรงกับข้อมูลเป้าหมาย</span>';
        } else {
            el.innerHTML = '<span style="color:red">* พื้นที่ไม่ตรงกับข้อมูลเป้าหมาย</span>';
        }
        feature.set('shpsplit_sqm', area);
    } catch (err) {
        console.error('Area calc error:', err);
    }
}

// ── 8. GeoJSON conversion  ────────────────────────────────
const gjFormat = new ol.format.GeoJSON();

function featureToGeoJSON(olFeature) {
    return JSON.parse(gjFormat.writeFeature(olFeature, {
        dataProjection: EPSG4326,
        featureProjection: EPSG3857
    }));
}

function featureCollectionToGeoJSON(olFeatures) {
    return JSON.parse(gjFormat.writeFeatures(olFeatures, {
        dataProjection: EPSG4326,
        featureProjection: EPSG3857
    }));
}

// ── 9. Load GeoData ──────────────────────────────────────
const loadGeoData = async (id, shouldFit = true) => {
    try {
        const tb = document.getElementById('tb').value;

        const [spatialRes, targetRes] = await Promise.all([
            fetch('/rub/api/getfeatures/' + tb + '/' + id),
            fetch(`/rub/api/getfeaturesv3/${tb}`)
        ]);
        const { data } = await spatialRes.json();
        const jsonTarget = await targetRes.json();
        console.log('Spatial:', data, 'Target:', jsonTarget);

        const features = data.map(item => {
            const f = new ol.Feature({
                geometry: new ol.geom.Polygon(
                    JSON.parse(item.geom).type === 'Polygon'
                        ? JSON.parse(item.geom).coordinates
                        : JSON.parse(item.geom).coordinates[0]
                ).transform(EPSG4326, EPSG3857)
            });
            // handle MultiPolygon
            const geomParsed = JSON.parse(item.geom);
            let olGeom;
            if (geomParsed.type === 'Polygon') {
                olGeom = new ol.geom.Polygon(geomParsed.coordinates).transform(EPSG4326, EPSG3857);
            } else if (geomParsed.type === 'MultiPolygon') {
                olGeom = new ol.geom.MultiPolygon(geomParsed.coordinates).transform(EPSG4326, EPSG3857);
            } else {
                return null;
            }
            const feat = new ol.Feature({ geometry: olGeom });
            feat.setProperties({
                id: item.id,
                sub_id: item.sub_id,
                id_farmer: item.id_farmer,
                sqm_yang: item.sqm_yang,
                shpsplit_sqm: item.shpsplit_sqm,
                classtype: item.classtype,
                selected: false,
                mergeSelected: false
            });
            return feat;
        }).filter(Boolean);

        vectorSource.clear();
        vectorSource.addFeatures(features);

        // Fit view
        if (shouldFit) {
            const extent = vectorSource.getExtent();
            if (!ol.extent.isEmpty(extent)) {
                map.getView().fit(extent, { padding: [40, 40, 40, 40], duration: 600 });
            }
        }
    } catch (err) {
        console.error('Error loading data:', err);
        alert('Failed to load spatial data');
    }
};

// ── 10. Feature panel ────────────────────────────────────
const classtypeColorMap = {
    'rubber': 'ct-rubber',
    'not-rubber': 'ct-not-rubber',
    'Other': 'ct-Other',
    'ex-pond': 'ct-ex-pond',
    'ex-landcover': 'ct-ex-landcover',
    'ex-building': 'ct-ex-building',
    'ex-river': 'ct-ex-river',
    'ex-unreg-rubber': 'ct-ex-unreg-rubber',
};

function updateClasstypeColor(value) {
    const el = document.getElementById('classtype');
    el.classList.remove(...Object.values(classtypeColorMap));
    if (value && classtypeColorMap[value]) el.classList.add(classtypeColorMap[value]);
}

function showFeaturePanel(feature) {
    document.getElementById('sub_id').value = feature.get('sub_id') || '';
    document.getElementById('xls_id_farmer').value = feature.get('id_farmer') || '';
    document.getElementById('sqm_yang').value = feature.get('sqm_yang') || 0;
    document.getElementById('shpsplit_sqm').value = Number(feature.get('shpsplit_sqm')).toFixed(0);
    const ct = feature.get('classtype');
    document.getElementById('classtype').value = ct ? ct : '';
    updateClasstypeColor(ct);
}

// ── 11. Map click → select polygon ───────────────────────
map.on('click', (evt) => {
    // Don't intercept during draw or modify
    if (drawInteraction) return;
    if (editMode) return;
    // Skip the click(s) that follow immediately after finishing a split draw
    if (skipNextClick) { skipNextClick = false; return; }

    const pixel = map.getEventPixel(evt.originalEvent);
    let hit = null;
    map.forEachFeatureAtPixel(pixel, (feature) => {
        if (!hit) hit = feature;
    }, { layerFilter: l => l === vectorLayer });

    if (mergeMode) {
        if (!hit) return;
        const already = hit.get('mergeSelected');
        if (already) {
            hit.set('mergeSelected', false);
            selectedForMerge = selectedForMerge.filter(f => f !== hit);
        } else {
            hit.set('mergeSelected', true);
            selectedForMerge.push(hit);
        }
        updateMergeList();
        return;
    }

    // Normal selection
    if (selectedFeature) {
        selectedFeature.set('selected', false);
    }
    selectedFeature = hit || null;
    if (selectedFeature) {
        selectedFeature.set('selected', true);
        showFeaturePanel(selectedFeature);
        // Show edit and split buttons when something is selected
        const tbEdit = document.getElementById('mapTool-edit');
        if (tbEdit) {
            tbEdit.classList.remove('map-tool-disabled');
            tbEdit.disabled = false;
        }
        const tbSplit = document.getElementById('mapTool-split');
        if (tbSplit) {
            tbSplit.classList.remove('map-tool-disabled');
            tbSplit.disabled = false;
        }
    } else {
        const tbEdit = document.getElementById('mapTool-edit');
        if (tbEdit) {
            tbEdit.classList.add('map-tool-disabled');
            tbEdit.disabled = true;
        }
        const tbSplit = document.getElementById('mapTool-split');
        if (tbSplit) {
            tbSplit.classList.add('map-tool-disabled');
            tbSplit.disabled = true;
        }
        stopEditMode();
    }
});

// ── 12. Map Tool Toolbar (floating icon buttons on map) ──────────
// Tools: Edit polygon | Draw split line
function buildMapToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'map-toolbar ol-unselectable';
    toolbar.id = 'mapToolbar';

    const tools = [
        {
            id: 'mapTool-edit',
            icon: 'bi-pencil-square',
            label: 'แก้ไขแปลง',
            tooltip: 'แก้ไขรูปแปลง',
            click: () => {
                if (!selectedFeature) { alert('กรุณาเลือก polygon ที่จะแก้ไขก่อน'); return; }
                if (editMode) stopEditMode();
                else startEditMode();
            }
        },
        {
            id: 'mapTool-split',
            icon: 'bi-scissors',
            label: 'วาดเส้นตัด',
            tooltip: 'วาดเส้นตัดแปลง',
            click: () => {
                if (!selectedFeature) { alert('กรุณาเลือก polygon ที่จะตัดก่อน'); return; }
                if (drawInteraction) {
                    cancelSplitDrawInternal();
                } else {
                    startSplitDraw();
                }
            }
        },
    ];

    tools.forEach(t => {
        const btn = document.createElement('button');
        btn.id = t.id;
        btn.className = 'map-tool-btn map-tool-disabled';
        btn.title = t.tooltip;
        btn.innerHTML = `<i class="bi ${t.icon}"></i><span class="map-tool-label">${t.label}</span>`;
        btn.addEventListener('click', t.click);
        toolbar.appendChild(btn);
    });

    document.getElementById('map').appendChild(toolbar);
}

// ── 12b. Split workflow ───────────────────────────────────────

let splitModifyInteraction = new ol.interaction.Modify({
    source: splitLineSource,
    style: new ol.style.Style({
        image: new ol.style.Circle({
            radius: 6,
            fill: new ol.style.Fill({ color: '#ff4400' }),
            stroke: new ol.style.Stroke({ color: '#fff', width: 2 })
        })
    })
});

splitModifyInteraction.on('modifyend', (evt) => {
    const features = splitLineSource.getFeatures();
    if (features.length > 0) {
        const lineFeature = features[0];
        const gj = JSON.parse(gjFormat.writeFeature(lineFeature, {
            dataProjection: EPSG4326,
            featureProjection: EPSG3857
        }));
        splitLineCoords = gj;
    }
});

map.addInteraction(splitModifyInteraction);

function startSplitDraw() {
    // Remove any existing split line
    splitLineSource.clear();
    splitLineCoords = null;

    // Map toolbar active state
    const tbBtn = document.getElementById('mapTool-split');
    if (tbBtn) { tbBtn.classList.add('map-tool-active'); tbBtn.classList.remove('map-tool-disabled'); }

    // Show hint bar
    document.getElementById('splitHint').style.display = 'flex';
    document.getElementById('splitHintText').textContent = 'กำลังวาดเส้นตัด — คลิกเพิ่มจุด, ดับเบิลคลิกเพื่อจบ';
    // document.getElementById('confirmSplitSidebarBtn').style.display = 'none';

    drawInteraction = new ol.interaction.Draw({
        source: splitLineSource,
        type: 'LineString',
        style: function(feature) {
            const type = feature.getGeometry() ? feature.getGeometry().getType() : null;
            if (type === 'Point') {
                return new ol.style.Style({
                    image: new ol.style.Circle({
                        radius: 5,
                        fill: new ol.style.Fill({ color: '#ff4400' }),
                        stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 })
                    })
                });
            } else if (type === 'LineString') {
                const geom = feature.getGeometry();
                const coords = geom.getCoordinates();
                let midpoints = [];
                for (let i = 0; i < coords.length - 1; i++) {
                    midpoints.push([
                        (coords[i][0] + coords[i + 1][0]) / 2,
                        (coords[i][1] + coords[i + 1][1]) / 2
                    ]);
                }
                return [
                    new ol.style.Style({
                        stroke: new ol.style.Stroke({ color: '#ff4400', width: 2, lineDash: [6, 4] })
                    }),
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 4.5,
                            fill: new ol.style.Fill({ color: 'rgba(255, 68, 0, 0.25)' }),
                            stroke: new ol.style.Stroke({ color: 'rgba(255, 255, 255, 0.5)', width: 1.5 })
                        }),
                        geometry: midpoints.length > 0 ? new ol.geom.MultiPoint(midpoints) : null
                    }),
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 5,
                            fill: new ol.style.Fill({ color: '#ff4400' }),
                            stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 })
                        }),
                        geometry: new ol.geom.MultiPoint(coords)
                    })
                ];
            }
            return null;
        }
    });

    map.addInteraction(drawInteraction);
    map.getViewport().style.cursor = 'crosshair';

    if (snapInteraction) map.removeInteraction(snapInteraction);
    snapInteraction = new ol.interaction.Snap({ source: vectorSource, pixelTolerance: 15 });
    map.addInteraction(snapInteraction);

    drawInteraction.on('drawend', async (evt) => {
        const lineFeature = evt.feature;
        // Convert to GeoJSON in 4326
        const gj = JSON.parse(gjFormat.writeFeature(lineFeature, {
            dataProjection: EPSG4326,
            featureProjection: EPSG3857
        }));
        splitLineCoords = gj;

        // Cleanup draw
        map.removeInteraction(drawInteraction);
        drawInteraction = null;
        map.getViewport().style.cursor = '';

        // Prevent the double-click's trailing click from deselecting the polygon
        skipNextClick = true;
        setTimeout(() => { skipNextClick = false; }, 400);

        // Restore selection highlight & panel so user doesn't need to re-click
        if (selectedFeature) {
            selectedFeature.set('selected', true);
            showFeaturePanel(selectedFeature);
            const tbSplit = document.getElementById('mapTool-split');
            if (tbSplit) { tbSplit.classList.remove('map-tool-disabled'); tbSplit.disabled = false; }
        }

        // Update hint to allow editing and show confirm button
        document.getElementById('splitHintText').textContent = 'วาดเส้นตัดเสร็จแล้ว — กดปุ่ม "ยืนยันตัดแปลง" เพื่อตัด หรือเลื่อนจุดเพื่อปรับ';

        // Toolbar: deactivate draw icon
        const tbBtn = document.getElementById('mapTool-split');
        if (tbBtn) tbBtn.classList.remove('map-tool-active');
    });
}

// Internal cancel (used by toolbar button when draw is in progress)
function cancelSplitDrawInternal() {
    if (drawInteraction) {
        map.removeInteraction(drawInteraction);
        drawInteraction = null;
    }
    if (snapInteraction) {
        map.removeInteraction(snapInteraction);
        snapInteraction = null;
    }
    splitLineSource.clear();
    splitLineCoords = null;
    map.getViewport().style.cursor = '';
    document.getElementById('splitHint').style.display = 'none';
    // document.getElementById('confirmSplitSidebarBtn').style.display = 'none';
    const tbBtn = document.getElementById('mapTool-split');
    if (tbBtn) tbBtn.classList.remove('map-tool-active');
}

// Cancel draw
document.getElementById('cancelSplitDraw').addEventListener('click', () => {
    if (drawInteraction) {
        map.removeInteraction(drawInteraction);
        drawInteraction = null;
    }
    if (snapInteraction) {
        map.removeInteraction(snapInteraction);
        snapInteraction = null;
    }
    splitLineSource.clear();
    splitLineCoords = null;
    map.getViewport().style.cursor = '';
    document.getElementById('splitHint').style.display = 'none';
    // document.getElementById('confirmSplitSidebarBtn').style.display = 'none';
});

document.getElementById('confirmSplitSidebarBtn').addEventListener('click', async () => {
    document.getElementById('splitHint').style.display = 'none';
    // document.getElementById('confirmSplitSidebarBtn').style.display = 'none';
    await executeSplit();
});

document.getElementById('unsplitBtn').addEventListener('click', () => {
    executeUnsplit();
});

// Step 2: Execute Split Automatically
async function executeSplit() {
    if (!selectedFeature) {
        alert('กรุณาเลือกแปลงก่อน');
        return;
    }
    if (!splitLineCoords) {
        alert('กรุณาวาดเส้นตัดก่อน');
        return;
    }

    const id = document.getElementById('id').value;
    const tb = document.getElementById('tb').value;
    const displayName = document.getElementById('displayName').value;

    const polygon = featureToGeoJSON(selectedFeature);
    const line_fc = splitLineCoords;

    const payload = {
        polygon_fc: polygon,
        line_fc: line_fc,
        srid: 32647,
        displayName: displayName,
    };

    try {
        const res = await fetch('/rub/api/splitfeature/' + tb, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            splitLineSource.clear();
            splitLineCoords = null;
            if (snapInteraction) {
                map.removeInteraction(snapInteraction);
                snapInteraction = null;
            }
            // Clear selection first
            if (selectedFeature) {
                selectedFeature.set('selected', false);
                selectedFeature = null;
            }
            vectorSource.clear();
            await loadGeoData(id, false);

            // Auto-select first feature after split and update area panel
            const allFeatures = vectorSource.getFeatures();
            if (allFeatures.length > 0) {
                selectedFeature = allFeatures[0];
                selectedFeature.set('selected', true);
                showFeaturePanel(selectedFeature);
                await updateAreaDisplay(selectedFeature);
                const tbSplit = document.getElementById('mapTool-split');
                if (tbSplit) { tbSplit.classList.remove('map-tool-disabled'); tbSplit.disabled = false; }
                const tbEdit = document.getElementById('mapTool-edit');
                if (tbEdit) { tbEdit.classList.remove('map-tool-disabled'); tbEdit.disabled = false; }
            }
            showToast('ตัดแปลงสำเร็จ!', 'success');
        } else {
            alert('Split failed: ' + (data.error || ''));
        }
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

// ── 12c. Unsplit (คืนแปลงเดิม) ──────────────────────────────
async function executeUnsplit() {
    const id = document.getElementById('id').value;
    const tb = document.getElementById('tb').value;
    const displayName = document.getElementById('displayName').value;

    if (!id || !tb) {
        alert('ไม่พบข้อมูลแปลง');
        return;
    }

    if (!confirm('ต้องการคืนแปลงเดิมหรือไม่?\nการกระทำนี้จะลบการ Split ทั้งหมดของแปลงนี้และคืนเป็นแปลงเดิม')) {
        return;
    }

    try {
        const res = await fetch('/rub/api/unsplit_feature/' + tb, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, displayName })
        });
        const data = await res.json();

        if (data.success) {
            // Clear selection
            if (selectedFeature) {
                selectedFeature.set('selected', false);
                selectedFeature = null;
            }
            splitLineSource.clear();
            splitLineCoords = null;
            vectorSource.clear();
            await loadGeoData(id, false);

            // Auto-select the restored single feature
            const allFeatures = vectorSource.getFeatures();
            if (allFeatures.length > 0) {
                selectedFeature = allFeatures[0];
                selectedFeature.set('selected', true);
                showFeaturePanel(selectedFeature);
                await updateAreaDisplay(selectedFeature);
                const tbSplit = document.getElementById('mapTool-split');
                if (tbSplit) { tbSplit.classList.remove('map-tool-disabled'); tbSplit.disabled = false; }
                const tbEdit = document.getElementById('mapTool-edit');
                if (tbEdit) { tbEdit.classList.remove('map-tool-disabled'); tbEdit.disabled = false; }
            }
            showToast('คืนแปลงเดิมสำเร็จ!', 'success');
        } else {
            alert('เกิดข้อผิดพลาด: ' + (data.error || ''));
        }
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

// ── 13. Clear selection ───────────────────────────────────
document.getElementById('clear').addEventListener('click', () => {
    stopEditMode();
    if (selectedFeature) {
        selectedFeature.set('selected', false);
        selectedFeature = null;
    }
    splitLineSource.clear();
    splitLineCoords = null;

    if (drawInteraction) {
        map.removeInteraction(drawInteraction);
        drawInteraction = null;
    }
    if (snapInteraction) {
        map.removeInteraction(snapInteraction);
        snapInteraction = null;
    }

    // Clear hint and hide confirm button
    document.getElementById('splitHint').style.display = 'none';
    // if(document.getElementById('confirmSplitSidebarBtn')) {
    //     document.getElementById('confirmSplitSidebarBtn').style.display = 'none';
    // }

    // Disable map toolbar edit button
    const tbEdit = document.getElementById('mapTool-edit');
    const tbSplit = document.getElementById('mapTool-split');
    if (tbEdit) tbEdit.classList.add('map-tool-disabled');
    if (tbSplit) tbSplit.classList.remove('map-tool-active');
    document.getElementById('sub_id').value = '';
    document.getElementById('xls_id_farmer').value = '';
    document.getElementById('sqm_yang').value = '';
    document.getElementById('shpsplit_sqm').value = '';
    document.getElementById('classtype').value = '';
});

// ── 13b. Edit polygon mode ────────────────────────────────
function startEditMode() {
    if (!selectedFeature) return;
    if (editMode) { stopEditMode(); return; }

    editMode = true;
    if (selectedFeature) selectedFeature.changed(); // update styles to show midpoints!
    
    // Update map toolbar button state
    const tbBtn = document.getElementById('mapTool-edit');
    if (tbBtn) { tbBtn.classList.add('map-tool-active'); tbBtn.classList.remove('map-tool-disabled'); }

    // Show edit hint
    document.getElementById('editHint').style.display = 'flex';
    map.getViewport().style.cursor = 'grab';

    // Build a temp collection with just the selected feature for Modify
    editSource.clear();
    editSource.addFeature(selectedFeature);

    modifyInteraction = new ol.interaction.Modify({
        source: editSource,
        style: new ol.style.Style({
            image: new ol.style.Circle({
                radius: 7,
                fill: new ol.style.Fill({ color: '#ff7043' }),
                stroke: new ol.style.Stroke({ color: '#fff', width: 2 })
            }),
            stroke: new ol.style.Stroke({ color: '#ff7043', width: 2, lineDash: [4, 4] })
        })
    });

    let geomChangeListener;
    modifyInteraction.on('modifystart', (evt) => {
        const feature = evt.features.getArray()[0];
        if (feature) {
            geomChangeListener = () => {
                const geom = feature.getGeometry();
                const area = ol.sphere.getArea(geom, { projection: 'EPSG:3857' });
                document.getElementById('shpsplit_sqm').value = Math.round(area);
                
                const sqmYang = parseFloat(document.getElementById('sqm_yang').value) || 0;
                const el = document.getElementById('checkarea');
                if (Math.abs(sqmYang - area) <= 800) {
                    el.innerHTML = '<span style="color:green">* พื้นที่ตรงกับข้อมูลเป้าหมาย</span>';
                } else {
                    el.innerHTML = '<span style="color:red">* พื้นที่ไม่ตรงกับข้อมูลเป้าหมาย</span>';
                }
            };
            feature.getGeometry().on('change', geomChangeListener);
        }
    });

    modifyInteraction.on('modifyend', async (evt) => {
        const feature = evt.features.getArray()[0];
        if (feature && geomChangeListener) {
            feature.getGeometry().un('change', geomChangeListener);
            geomChangeListener = null;
        }
        await updateAreaDisplay(selectedFeature);
    });

    map.addInteraction(modifyInteraction);

    if (snapInteraction) map.removeInteraction(snapInteraction);
    snapInteraction = new ol.interaction.Snap({ source: vectorSource, pixelTolerance: 15 });
    map.addInteraction(snapInteraction);
}

function stopEditMode() {
    if (!editMode) return;
    editMode = false;
    if (selectedFeature) selectedFeature.changed(); // remove midpoints

    if (modifyInteraction) {
        map.removeInteraction(modifyInteraction);
        modifyInteraction = null;
    }
    if (snapInteraction) {
        map.removeInteraction(snapInteraction);
        snapInteraction = null;
    }
    editSource.clear();
    map.getViewport().style.cursor = '';
    document.getElementById('editHint').style.display = 'none';

    const tbBtn = document.getElementById('mapTool-edit');
    if (tbBtn) { tbBtn.classList.remove('map-tool-active'); }
}

// ── Right-click to delete node ─────────────────────────────
// helper: find nearest vertex index within pixelTolerance
function findNearestVertexIndex(coords, clickCoord, pixelTolerance) {
    const clickPx = map.getPixelFromCoordinate(clickCoord);
    let bestIdx = -1;
    let bestDist = pixelTolerance;
    coords.forEach((c, i) => {
        const px = map.getPixelFromCoordinate(c);
        if (!px) return;
        const dx = px[0] - clickPx[0];
        const dy = px[1] - clickPx[1];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    return bestIdx;
}

map.getViewport().addEventListener('contextmenu', (evt) => {
    evt.preventDefault();
    const pixel = map.getEventPixel(evt);
    const coord = map.getCoordinateFromPixel(pixel);
    const TOLERANCE = 14; // pixels

    // ── Case 1: editMode — delete vertex from polygon ──────
    if (editMode && selectedFeature) {
        const geom = selectedFeature.getGeometry();
        const geomType = geom.getType();

        if (geomType === 'Polygon') {
            const rings = geom.getCoordinates();
            const outerRing = rings[0];
            // polygon ring is closed (first == last), ignore last duplicate
            const open = outerRing.slice(0, outerRing.length - 1);
            const idx = findNearestVertexIndex(open, coord, TOLERANCE);
            if (idx === -1) return;
            if (open.length <= 3) {
                showToast('ไม่สามารถลบได้ — polygon ต้องมีอย่างน้อย 3 จุด', 'error');
                return;
            }
            open.splice(idx, 1);
            open.push([...open[0]]); // re-close
            rings[0] = open;
            geom.setCoordinates(rings);
            selectedFeature.changed();
            updateAreaDisplay(selectedFeature);
            showToast('ลบจุดแล้ว', 'info');

        } else if (geomType === 'MultiPolygon') {
            const mpCoords = geom.getCoordinates();
            let deleted = false;
            for (let pi = 0; pi < mpCoords.length && !deleted; pi++) {
                const outerRing = mpCoords[pi][0];
                const open = outerRing.slice(0, outerRing.length - 1);
                const idx = findNearestVertexIndex(open, coord, TOLERANCE);
                if (idx === -1) continue;
                if (open.length <= 3) {
                    showToast('ไม่สามารถลบได้ — polygon ต้องมีอย่างน้อย 3 จุด', 'error');
                    return;
                }
                open.splice(idx, 1);
                open.push([...open[0]]);
                mpCoords[pi][0] = open;
                deleted = true;
            }
            if (!deleted) return;
            geom.setCoordinates(mpCoords);
            selectedFeature.changed();
            updateAreaDisplay(selectedFeature);
            showToast('ลบจุดแล้ว', 'info');
        }
        return;
    }

    // ── Case 2: split line drawn (not in active draw) — delete vertex from split line ──
    if (!drawInteraction && splitLineSource.getFeatures().length > 0) {
        const features = splitLineSource.getFeatures();
        const lineFeature = features[0];
        const geom = lineFeature.getGeometry();
        if (geom.getType() !== 'LineString') return;
        const coords = geom.getCoordinates();
        const idx = findNearestVertexIndex(coords, coord, TOLERANCE);
        if (idx === -1) return;
        if (coords.length <= 2) {
            showToast('ไม่สามารถลบได้ — เส้นตัดต้องมีอย่างน้อย 2 จุด', 'error');
            return;
        }
        coords.splice(idx, 1);
        geom.setCoordinates(coords);
        // update splitLineCoords
        const gj = JSON.parse(gjFormat.writeFeature(lineFeature, {
            dataProjection: EPSG4326,
            featureProjection: EPSG3857
        }));
        splitLineCoords = gj;
        showToast('ลบจุดเส้นตัดแล้ว', 'info');
    }
});

document.getElementById('cancelEdit').addEventListener('click', () => {
    stopEditMode();
    const id = document.getElementById('id').value;
    vectorSource.clear();
    loadGeoData(id, false);
});

// ── 14. Save geometry ────────────────────────────────────
document.getElementById('save').addEventListener('click', async () => {
    if (!selectedFeature) {
        alert('กรุณาเลือก polygon ที่ต้องการบันทึก');
        return;
    }

    // Finalize any in-progress vertex edits
    stopEditMode();

    const gj = featureToGeoJSON(selectedFeature);
    const geom = gj.geometry;
    const sub_id = document.getElementById('sub_id').value;
    const tb = document.getElementById('tb').value;
    const displayName = document.getElementById('displayName').value;

    try {
        const res = await fetch('/rub/api/update_geometry/' + tb, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sub_id, geometry: geom, displayName })
        });
        const data = await res.json();
        if (data.success) {
            alert('บันทึก polygon เรียบร้อยแล้ว');
            window.location.reload();
        } else {
            alert('เกิดข้อผิดพลาดขณะบันทึก');
        }
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
});

// ── 15. Classtype change → update DB ─────────────────────
document.getElementById('classtype').addEventListener('change', async (e) => {
    const selectedValue = e.target.value;
    updateClasstypeColor(selectedValue);
    const id = document.getElementById('id').value;
    const tb = document.getElementById('tb').value;
    const displayName = document.getElementById('displayName').value;

    const res = await fetch('/rub/api/update_landuse/' + tb, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id,
            sub_id: document.getElementById('sub_id').value,
            classtype: selectedValue,
            displayName,
        })
    });
    const data = await res.json();
    if (data.success) {
        vectorSource.clear();
        await loadGeoData(id, false);
    } else {
        alert('Update failed');
    }
});

// ── 16. Navigation buttons ────────────────────────────────
document.getElementById('reshape').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    const urlParams = new URLSearchParams(window.location.search);
    const id_from = urlParams.get('id_from');
    const id_to = urlParams.get('id_to');
    const assignee = urlParams.get('assignee');

    let url = './../reshape/index.html?tb=' + tb;
    if (id_from && id_to && assignee) {
        url += `&id_from=${id_from}&id_to=${id_to}&assignee=${encodeURIComponent(assignee)}`;
    }
    window.location.href = url;
});
document.getElementById('reshapeBottom').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    const urlParams = new URLSearchParams(window.location.search);
    const id_from = urlParams.get('id_from');
    const id_to = urlParams.get('id_to');
    const assignee = urlParams.get('assignee');

    let url = './../reshape/index.html?tb=' + tb;
    if (id_from && id_to && assignee) {
        url += `&id_from=${id_from}&id_to=${id_to}&assignee=${encodeURIComponent(assignee)}`;
    }
    window.location.href = url;
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

// ── 17. Merge mode ────────────────────────────────────────
document.getElementById('mergeModeBtn').addEventListener('click', () => {
    mergeMode = !mergeMode;
    if (mergeMode) {
        document.getElementById('mergePanel').style.display = 'block';
        document.getElementById('mergeModeBtn').textContent = 'เข้าโหมด Merge อยู่';
        document.getElementById('mergeModeBtn').classList.add('active');
        selectedForMerge = [];
        updateMergeList();
    } else {
        exitMergeMode();
    }
});

document.getElementById('exitMergeBtn').addEventListener('click', () => {
    document.getElementById('mergeModeBtn').click();
});

function exitMergeMode() {
    mergeMode = false;
    selectedForMerge.forEach(f => f.set('mergeSelected', false));
    selectedForMerge = [];
    document.getElementById('mergePanel').style.display = 'none';
    document.getElementById('mergeModeBtn').textContent = 'เข้าโหมด Merge';
    document.getElementById('mergeModeBtn').classList.remove('active');
    updateMergeList();
}

function updateMergeList() {
    const listDiv = document.getElementById('selectedPolygonsList');
    if (selectedForMerge.length === 0) {
        listDiv.innerHTML = '<small class="text-muted">ยังไม่มี polygon ที่เลือก</small>';
        document.getElementById('collectedBtn').disabled = true;
    } else {
        let html = '<ul class="list-group">';
        selectedForMerge.forEach((feat, idx) => {
            const sid = feat.get('sub_id');
            const sqm = Number(feat.get('shpsplit_sqm') || 0).toFixed(0);
            html += `<li class="list-group-item d-flex justify-content-between align-items-center">
                <span>${sid} (${sqm} m²)</span>
                <button class="btn btn-sm btn-danger" onclick="removeFromMergeList(${idx})">ลบ</button>
            </li>`;
        });
        html += '</ul>';
        listDiv.innerHTML = html;
        document.getElementById('collectedBtn').disabled = selectedForMerge.length < 2;
    }
}

function removeFromMergeList(index) {
    selectedForMerge[index].set('mergeSelected', false);
    selectedForMerge.splice(index, 1);
    updateMergeList();
}

document.getElementById('collectedBtn').addEventListener('click', async () => {
    if (selectedForMerge.length < 2) {
        alert('กรุณาเลือก polygon อย่างน้อย 2 ตัว');
        return;
    }

    const tb = document.getElementById('tb').value;
    const displayName = document.getElementById('displayName').value;
    const id_list = selectedForMerge.map(f => f.get('sub_id'));

    try {
        const res = await fetch('/rub/api/collected_feat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_list, tb, displayName })
        });
        const data = await res.json();

        if (!data.success) {
            alert('Merge failed: ' + data.error);
            return;
        }

        // Reload map
        vectorSource.clear();
        const id = document.getElementById('id').value;
        await loadGeoData(id, false);
        exitMergeMode();

        // Show success toast
        showToast('รวม polygon สำเร็จ!', 'success');
    } catch (err) {
        alert('เกิดข้อผิดพลาดขณะรวม polygon: ' + err.message);
    }
});

// ── 18. Legend ────────────────────────────────────────────
function buildLegend() {
    const entries = [
        { ct: 'rubber', label: 'ยางพาราที่ลงทะเบียน' },
        { ct: 'not-rubber', label: 'ยางพาราที่ไม่ได้ลงทะเบียน' },
        { ct: 'Other', label: 'ไม่ใช่ยางพารา' },
        { ct: 'ex-pond', label: 'พื้นที่กันออก (บ่อน้ำ)' },
        { ct: 'ex-landcover', label: 'พื้นที่กันออก (สิ่งปกคลุมดินอื่นๆ)' },
        { ct: 'ex-building', label: 'พื้นที่กันออก (สิ่งปลูกสร้าง)' },
        { ct: 'ex-river', label: 'พื้นที่กันออก (ลำน้ำ)' },
        { ct: 'ex-unreg-rubber', label: 'พื้นที่กันออก (ยางพาราไม่ลงทะเบียน)' },
    ];
    const div = document.createElement('div');
    div.className = 'legend ol-unselectable';
    div.innerHTML = entries.map(e =>
        `<div class="legend-item"><i style="background:${getColor(e.ct)}; opacity:0.85"></i>${e.label}</div>`
    ).join('');
    document.getElementById('map').appendChild(div);
}

// ── 19. Layer switcher (base=radio, overlay=checkbox) ────
const BASE_LAYERS = [gmapSatLayer, gmapRoadLayer, gmapHybrid, gmapTerrain, longdoLayer];
const OVERLAY_LAYERS = [ndviWms, rubberParcelWms, tcLayer, ndviGeeLayer];

function buildLayerSwitcher() {
    const ctrl = document.createElement('div');
    ctrl.className = 'ol-layer-switcher ol-unselectable';
    ctrl.id = 'layerSwitcher';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'ls-toggle-btn';
    toggleBtn.innerHTML = '<i class="bi bi-layers"></i>';
    toggleBtn.title = 'เปิด/ปิด ชั้นข้อมูล';
    ctrl.appendChild(toggleBtn);

    const panel = document.createElement('div');
    panel.className = 'ls-panel';
    ctrl.appendChild(panel);

    let isOpen = false;
    toggleBtn.addEventListener('click', () => {
        isOpen = !isOpen;
        if (isOpen) {
            panel.classList.add('show');
            toggleBtn.classList.add('active');
        } else {
            panel.classList.remove('show');
            toggleBtn.classList.remove('active');
        }
    });

    // ── Base layers (checkboxes to allow multiple) ───────────────
    const baseItems = [
        { layer: gmapSatLayer, label: 'Satellite' },
        { layer: gmapRoadLayer, label: 'Road' },
        { layer: gmapHybrid, label: 'Hybrid' },
        { layer: gmapTerrain, label: 'Terrain' },
        { layer: longdoLayer, label: 'Longdo' },
    ];

    const baseGroup = document.createElement('div');
    baseGroup.innerHTML = '<div class="ls-group-title"><i class="bi bi-map"></i> แผนที่พื้น</div>';

    baseItems.forEach(({ layer, label }) => {
        const row = document.createElement('label');
        row.className = 'ls-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = layer.getVisible();
        cb.addEventListener('change', () => {
            layer.setVisible(cb.checked);
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' ' + label));
        baseGroup.appendChild(row);
    });
    panel.appendChild(baseGroup);

    // ── Overlay layers (checkbox, multiple) ───────────────
    const overlayItems = [
        { layer: ndviGeeLayer, label: 'NDVI GEE' },
        { layer: tcLayer, label: 'S2 GEE' },
        { layer: rubberParcelWms, label: 'แปลง (เดิม)' },
    ];

    const sep = document.createElement('div');
    sep.className = 'ls-sep';
    panel.appendChild(sep);

    const overlayGroup = document.createElement('div');
    overlayGroup.innerHTML = '<div class="ls-group-title"><i class="bi bi-stack"></i> ชั้นซ้อน</div>';

    overlayItems.forEach(({ layer, label }) => {
        const row = document.createElement('label');
        row.className = 'ls-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = layer.getVisible();
        cb.addEventListener('change', () => {
            layer.setVisible(cb.checked);
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' ' + label));
        overlayGroup.appendChild(row);
    });
    panel.appendChild(overlayGroup);

    document.getElementById('map').appendChild(ctrl);
}

// ── 20. GEE layers (async load) ──────────────────────────
fetch('/rub/api/gee')
    .then(r => r.json())
    .then(data => {
        if (data.truecolor) {
            tcLayer.setSource(new ol.source.XYZ({ url: data.truecolor.urlFormat, maxZoom: 18 }));
        }
        if (data.ndvi) {
            ndviGeeLayer.setSource(new ol.source.XYZ({ url: data.ndvi.urlFormat, maxZoom: 18 }));
        }
    })
    .catch(() => { });

// ── 21. Toast helper ─────────────────────────────────────
function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `map-toast map-toast-${type}`;
    t.textContent = msg;
    document.getElementById('map').appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2800);
}

// ── 22. App init ─────────────────────────────────────────
const initApp = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    const tb = urlParams.get('tb');
    const sqm_yang_param = urlParams.get('sqm_yang');

    if (!tb || tb === 'undefined') {
        alert('พื้นที่ไม่ถูกต้อง');
        window.location.href = './../index.html';
        return;
    }

    document.getElementById('sqm_yang').value = sqm_yang_param;
    document.getElementById('id').value = id;
    document.getElementById('tb').value = tb;

    await loadGeoData(id);
    buildMapToolbar();
    buildLegend();
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
            await checkMyAssignment(user.displayName);

            document.getElementById('logout-link').addEventListener('click', async (e) => {
                e.preventDefault();
                const r = await fetch('/rub/auth/logout');
                const { success } = await r.json();
                if (success) window.location.href = '/rub/index.html';
                else alert('Logout failed');
            });
        } else {
            window.location.href = '/rub/index.html';
        }
    } catch (err) {
        console.error('Init error:', err);
    }
});

async function checkMyAssignment(displayName) {
    const tb = document.getElementById('tb').value;
    const alertEl = document.getElementById('myAssignmentAlert');
    const rangeText = document.getElementById('myAssignmentRange');
    if (!alertEl || !rangeText || !tb) return;

    try {
        const res = await fetch(`/rub/api/task-assignments/${tb}`);
        const { data } = await res.json();
        
        if (!data || data.length === 0) return;

        // Find assignment for current user
        const mine = data.find(a => a.assignee_name && a.assignee_name.toLowerCase().includes(displayName.toLowerCase()));
        
        if (mine) {
            rangeText.textContent = `ID ${mine.id_from} – ${mine.id_to}`;
            alertEl.style.display = 'block';
        }
    } catch (e) {
        console.error('checkMyAssignment error:', e);
    }
}
