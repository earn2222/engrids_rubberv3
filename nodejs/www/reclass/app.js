const map = L.map('map').setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();

// Custom Rubber Tree Icon
const rubberTreeIcon = L.icon({
    iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
            <defs>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="15" />
                    <feOffset dx="0" dy="10" result="offsetblur" />
                    <feComponentTransfer><feFuncA type="linear" slope="0.3" /></feComponentTransfer>
                    <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
            </defs>
            <circle cx="256" cy="256" r="230" fill="#FFF9C4" stroke="#FBC02D" stroke-width="20" filter="url(#shadow)" />
            <path fill="#5D4037" d="M236 340h40v120h-40z"/>
            <path fill="#2E7D32" d="M256 80s-140 70-140 180c0 50 140 100 140 100s140-50 140-100c0-110-140-180-140-180z"/>
            <path fill="#4CAF50" d="M256 110s-110 50-110 150c0 40 110 80 110 80s110-40 110-80c0-100-110-150-110-150z"/>
            <path fill="#81C784" d="M256 140s-80 30-80 120c0 30 80 60 80 60s80-30 80-60c0-90-80-120-80-120z"/>
            <circle cx="190" cy="200" r="30" fill="white" fill-opacity="0.2" />
        </svg>
    `),
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
});

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
    drawPolyline: true,
    drawRectangle: false,
    drawPolygon: false,
    editMode: true,
    dragMode: false,
    cutPolygon: false,
    removalMode: false,
    rotateMode: false,
    drawText: false,
    drawCircleMarker: false,
});

// เรียก API /rub/api/area เพื่อคำนวณพื้นที่
async function calculateArea(geometry) {
    const res = await fetch('/rub/api/area', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry })
    });
    if (!res.ok) throw new Error('Failed to calculate area');
    const data = await res.json();
    return data.area;
}

async function updateAreaDisplay(layer) {
    const geometry = layer.toGeoJSON().geometry;
    try {
        const area = await calculateArea(geometry);
        const roundedArea = Math.round(area);
        shpsplit_sqm.value = roundedArea;

        const sqm_yang_val = parseFloat(document.getElementById('sqm_yang').value);
        const checkArea = document.getElementById('checkarea');
        checkArea.innerHTML = '';

        if (Math.abs(sqm_yang_val - area) <= 800) {
            checkArea.innerHTML = '<span style="color: green;">* พื้นที่ตรงกับข้อมูลเป้าหมาย</span>';
        } else {
            checkArea.innerHTML = '<span style="color: red;">* พื้นที่ไม่ตรงกับข้อมูลเป้าหมาย</span>';
        }



        // Save to layer properties
        layer.feature = layer.feature || { properties: {} };
        layer.feature.properties.shpsplit_sqm = area;

    } catch (err) {
        console.error('Error calculating area:', err);
    }
}


// ฟังก์ชันเพิ่ม Event ให้ polygon ที่แก้ไข
function addRealTimeAreaCalculation(layer) {
    layer.pm.enable({ allowSelfIntersection: true });

    // อัปเดตระหว่างการลากจุด (real-time จริง)
    layer.on('pm:change', async () => {
        await updateAreaDisplay(layer);
    });

    // เผื่อ fallback หลังลากเสร็จ
    layer.on('pm:edit', async () => {
        await updateAreaDisplay(layer);
    });
}


const sub_id = document.getElementById('sub_id');
const xls_id_farmer = document.getElementById('xls_id_farmer');
const sqm_yang_el = document.getElementById('sqm_yang');
const shpsplit_sqm = document.getElementById('shpsplit_sqm');
const classtype = document.getElementById('classtype');

// อัปเดตสีขอบซ้ายของ select ให้ตรงกับประเภทที่เลือก
const classtypeColorMap = {
    'rubber':          'ct-rubber',
    'not-rubber':      'ct-not-rubber',
    'Other':           'ct-Other',
    'ex-pond':         'ct-ex-pond',
    'ex-landcover':    'ct-ex-landcover',
    'ex-building':     'ct-ex-building',
    'ex-river':        'ct-ex-river',
    'ex-unreg-rubber': 'ct-ex-unreg-rubber',
};

function updateClasstypeColor(value) {
    const el = document.getElementById('classtype');
    // ลบ class ct-* ทั้งหมดออกก่อน
    el.classList.remove(...Object.values(classtypeColorMap));
    if (value && classtypeColorMap[value]) {
        el.classList.add(classtypeColorMap[value]);
    }
}

function showFeaturePanel(feature, layer) {
    sub_id.value = feature.properties.sub_id;
    xls_id_farmer.value = feature.properties.id_farmer;
    sqm_yang_el.value = feature.properties.sqm_yang || 0;
    shpsplit_sqm.value = Number(feature.properties.shpsplit_sqm).toFixed(0);
    classtype.value = feature.properties.classtype;
    updateClasstypeColor(feature.properties.classtype);
}

// 


const getFeatureStyle = (feature) => {
    let color, fillOpacity;

    switch (feature.properties.classtype) {
        case 'rubber':
            color = '#006d2c'; // ยางพาราที่ลงทะเบียน
            fillOpacity = 0.2;
            break;
        case 'Other':
            color = '#ff0004ff'; // ไม่ใช่ยางพารา
            fillOpacity = 0.2;
            break;
        case 'not-rubber':
            color = '#9900ffff'; // ยางพาราที่ไม่ได้ลงทะเบียน
            fillOpacity = 0.2;
            break;
        case 'ex-pond':
            color = '#00fff2ff'; // พื้นที่กันออก (บ่อน้ำ)
            fillOpacity = 0.2;
            break;
        case 'ex-landcover':
            color = '#ffe600ff'; // พื้นที่กันออก (สิ่งปกคลุมดินอื่นๆ)
            fillOpacity = 0.2;
            break;
        case 'ex-building':
            color = '#ff00d4ff'; // พื้นที่กันออก (สิ่งปลูกสร้าง)
            fillOpacity = 0.2;
            break;
        case 'ex-river':
            color = '#1100ffff'; // พื้นที่กันออก (ลำน้ำ)
            fillOpacity = 0.2;
            break;
        case 'ex-unreg-rubber':
            color = '#00ff0dff'; // พื้นที่กันออก (ยางพาราไม่ลงทะเบียน)
            fillOpacity = 0.2;
            break;
        default:
            color = '#fdae61'; // สี default
            fillOpacity = 0.2;
    }


    return {
        fillColor: color,
        weight: 2,
        opacity: 1,
        color: 'white',
        dashArray: '3',
        fillOpacity: fillOpacity
    };
};


var selectedPolygon = null;
let highlightedLayer = null; // Track the currently highlighted layer
let mergeMode = false; // Track merge mode state
let selectedPolygonsForMerge = []; // Track polygons selected for merge

function onEachFeature(feature, layer) {
    featureGroup.addLayer(layer);
    addRealTimeAreaCalculation(layer); // <-- เพิ่มบรรทัดนี้เพื่อให้ทุก polygon อัปเดตพื้นที่ได้แบบเรียลไทม์

    layer.on({
        click: function (e) {
            // ถ้าเข้าโหมด Merge ให้เพิ่ม/ลบจากรายการแทน
            if (mergeMode) {
                const subId = feature.properties.sub_id;
                const index = selectedPolygonsForMerge.findIndex(p => p.subId === subId);

                if (index === -1) {
                    // เพิ่มเข้ารายการ
                    selectedPolygonsForMerge.push({
                        layer: layer,
                        feature: feature,
                        subId: subId
                    });
                    layer.setStyle({
                        weight: 4,
                        color: '#ffff00',
                        dashArray: '5,5',
                        fillOpacity: 0.4
                    });
                } else {
                    // ลบออกจากรายการ
                    selectedPolygonsForMerge.splice(index, 1);
                    resetHighlight({ target: layer });
                }

                updateMergeList();
                return;
            }

            // Normal selection mode
            selectedPolygon = layer;
            showFeaturePanel(feature, layer);
            if (highlightedLayer === e.target) {
                resetHighlight(e);
                highlightedLayer = null;
            } else {
                if (highlightedLayer) {
                    resetHighlight({ target: highlightedLayer });
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

        // ✅ โหลด spatial พร้อม xls_sqm จาก geometry DB
        const response = await fetch('/rub/api/getfeatures/' + tb + '/' + id);
        const { data } = await response.json();
        console.log('Spatial data loaded:', data);

        // ✅ โหลด xls_sqm เป้าหมายจาก getfeaturesv3 (Excel)
        const responseTarget = await fetch(`/rub/api/getfeaturesv3/${tb}`);
        const jsonTarget = await responseTarget.json();
        console.log('Target data loaded:', jsonTarget);

        // ✅ แสดงบนแผนที่
        const geoJsonData = {
            type: 'FeatureCollection',
            features: data.map(item => ({
                type: 'Feature',
                geometry: JSON.parse(item.geom),
                properties: {
                    id: item.id,
                    sub_id: item.sub_id,
                    id_farmer: item.id_farmer,
                    sqm_yang: item.sqm_yang,
                    shpsplit_sqm: item.shpsplit_sqm,
                    classtype: item.classtype,
                }
            }))
        };

        geojson = L.geoJson(geoJsonData, {
            style: getFeatureStyle,
            onEachFeature: onEachFeature,
            pointToLayer: function (feature, latlng) {
                return L.marker(latlng, { icon: rubberTreeIcon });
            }
        }).addTo(map);

        // เพิ่มตรงนี้
        geojson.eachLayer(layer => {
            layer.pm.enable({ allowSelfIntersection: true });
            layer.on('pm:vertexdrag', async () => {
                await updateAreaDisplay(layer);
            });
            layer.on('pm:edit', async () => {
                await updateAreaDisplay(layer);
            });
        });




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
    addRealTimeAreaCalculation(layer); // <-- ใส่ให้ layer ที่เพิ่งสร้างใหม่ก็แสดงพื้นที่ real-time ได้

    selectedLine = layer;

    layer.on('click', () => {
        featureGroup.eachLayer(l => l.pm.disable());
        layer.pm.enable();
    });
};


// ฟังก์ชันอัพเดตรายการ polygon ที่เลือก
function updateMergeList() {
    const listDiv = document.getElementById('selectedPolygonsList');

    if (selectedPolygonsForMerge.length === 0) {
        listDiv.innerHTML = '<small class="text-muted">ยังไม่มี polygon ที่เลือก</small>';
        document.getElementById('collectedBtn').disabled = true;
    } else {
        let html = '<ul class="list-group">';
        selectedPolygonsForMerge.forEach((item, idx) => {
            html += `<li class="list-group-item d-flex justify-content-between align-items-center">
                <span>${item.subId} (${Number(item.feature.properties.shpsplit_sqm || 0).toFixed(0)} m²)</span>
                <button class="btn btn-sm btn-danger" onclick="removeFromMergeList(${idx})">ลบ</button>
            </li>`;
        });
        html += '</ul>';
        listDiv.innerHTML = html;

        // เปิด button Merge ถ้าเลือก 2 ตัวขึ้นไป
        document.getElementById('collectedBtn').disabled = selectedPolygonsForMerge.length < 2;
    }
}

// ฟังก์ชันลบ polygon ออกจากรายการ
function removeFromMergeList(index) {
    const item = selectedPolygonsForMerge[index];
    resetHighlight({ target: item.layer });
    selectedPolygonsForMerge.splice(index, 1);
    updateMergeList();
}




function enableEditAndListen(layer) {
    layer.pm.enable({ allowSelfIntersection: true });
    layer.on('pm:update', async () => {
        await updateAreaDisplay(layer);
    });
    layer.on('pm:dragend', async () => {
        await updateAreaDisplay(layer);
    });
}


map.on('pm:create', handleLayerCreate);
map.on('pm:edit', (e) => {
    const layer = e.layer;
    featureGroup.eachLayer(l => l.pm.disable());
    layer.pm.enable();
});
map.on('click', () => featureGroup.eachLayer(l => l.pm.disable()));

const legend = L.control({ position: 'bottomright' });

legend.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'legend'),
        categories = ['rubber', 'not-rubber', 'Other', 'ex-pond', 'ex-landcover', 'ex-building', 'ex-river', 'ex-unreg-rubber'],
        labels = [
            'ยางพาราที่ลงทะเบียน',
            'ยางพาราที่ไม่ได้ลงทะเบียน',
            'ไม่ใช่ยางพารา',
            'พื้นที่กันออก (บ่อน้ำ)',
            'พื้นที่กันออก (สิ่งปกคลุมดินอื่นๆ)',
            'พื้นที่กันออก (สิ่งปลูกสร้าง)',
            'พื้นที่กันออก (ลำน้ำ)',
            'พื้นที่กันออก (ยางพาราไม่ลงทะเบียน)'
        ];


    for (let i = 0; i < categories.length; i++) {
        const dummy = { properties: { classtype: categories[i] } },
            style = getFeatureStyle(dummy);

        div.innerHTML +=
            `<i style="background:${style.fillColor};"></i> ${labels[i]}<br>`;
    }
    return div;
};

legend.addTo(map);

document.getElementById('classtype').addEventListener('change', (e) => {
    const selectedValue = e.target.value;
    updateClasstypeColor(selectedValue);
    const id = document.getElementById('id').value
    const tb = document.getElementById('tb').value;
    const displayName = document.getElementById('displayName').value;

    fetch('/rub/api/update_landuse/' + tb, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: id,
            sub_id: sub_id.value,
            classtype: selectedValue,
            displayName: displayName,
        })
    }).then(response => response.json())
        .then(async (data) => {
            if (data.success) {
                const id = document.getElementById('id').value;
                featureGroup.clearLayers();
                await loadGeoData(id);

                console.log('Update successful 387');

            } else {
                alert('Update failed');
            }
        });
});

document.getElementById('clear').addEventListener('click', () => {
    if (highlightedLayer) {
        resetHighlight({ target: highlightedLayer });
        highlightedLayer = null;
    }

    selectedPolygon = null;
    selectedLine = null;
    sub_id.value = '';
    xls_id_farmer.value = '';
    sqm_yang_el.value = '';
    shpsplit_sqm.value = '';
    classtype.value = '';
})

document.getElementById('split').addEventListener('click', () => {
    if (!selectedPolygon) {
        alert('เลือก polygon ก่อน');
        return;
    }
    if (!selectedLine) {
        alert('สร้าง line ที่จะใช้แบ่ง polygon ก่อน');
        return;
    }

    const id = document.getElementById('id').value;
    const polygon = selectedPolygon.toGeoJSON();
    const line = selectedLine.toGeoJSON();
    const displayName = document.getElementById('displayName').value;

    const srid = 32647;
    const data = {
        polygon_fc: polygon,
        line_fc: line,
        srid: srid,
        displayName: displayName,
    }

    const tb = document.getElementById('tb').value;
    fetch('/rub/api/splitfeature/' + tb, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    }).then(response => response.json())
        .then(async (data) => {
            if (data.success) {
                featureGroup.clearLayers();
                await loadGeoData(id);
            } else {
                alert('Split failed');
            }
        })
});


document.getElementById('save').addEventListener('click', () => {
    if (!selectedPolygon) {
        alert('กรุณาเลือก polygon ที่ต้องการบันทึก');
        return;
    }

    const geom = selectedPolygon.toGeoJSON().geometry;
    const sub_id = document.getElementById('sub_id').value;
    const tb = document.getElementById('tb').value;
    const displayName = document.getElementById('displayName').value;

    fetch('/rub/api/update_geometry/' + tb, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            sub_id: sub_id,
            geometry: geom,
            displayName: displayName
        })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert("บันทึก polygon เรียบร้อยแล้ว");
                // รีโหลดแปลงใหม่
                //refresh 
                window.location.reload();

            } else {
                alert("เกิดข้อผิดพลาดขณะบันทึก");
            }
        });
});

document.getElementById('reshape').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reshape/index.html?tb=' + tb;
})

document.getElementById('reshapeBottom').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reshape/index.html?tb=' + tb;
})

document.getElementById('dashboard').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reclassdash/index.html?tb=' + tb;
});


// Event listener สำหรับ Merge Mode
document.getElementById('mergeModeBtn').addEventListener('click', () => {
    mergeMode = !mergeMode;

    if (mergeMode) {
        // เข้าโหมด Merge
        document.getElementById('mergePanel').style.display = 'block';
        document.getElementById('mergeModeBtn').textContent = 'เข้าโหมด Merge อยู่';
        document.getElementById('mergeModeBtn').classList.add('active');
        selectedPolygonsForMerge = [];
        updateMergeList();
    } else {
        // ออกจากโหมด Merge
        document.getElementById('mergePanel').style.display = 'none';
        document.getElementById('mergeModeBtn').textContent = 'เข้าโหมด Merge';
        document.getElementById('mergeModeBtn').classList.remove('active');

        // รีเซ็ต highlight
        selectedPolygonsForMerge.forEach(item => {
            resetHighlight({ target: item.layer });
        });
        selectedPolygonsForMerge = [];
    }
});

document.getElementById('exitMergeBtn').addEventListener('click', () => {
    document.getElementById('mergeModeBtn').click();
});

const initApp = async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const id = urlParams.get('id');
        const tb = urlParams.get('tb');
        const sqm_yang_param = urlParams.get('sqm_yang');

        if (!tb || tb === 'undefined') {
            alert('พื้นที่ไม่ถูกต้อง');
            window.location.href = './../index.html';
        }
        document.getElementById('sqm_yang').value = sqm_yang_param;
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

document.getElementById('collectedBtn').addEventListener('click', async () => {
    if (selectedPolygonsForMerge.length < 2) {
        alert('กรุณาเลือก polygon อย่างน้อย 2 ตัว');
        return;
    }

    const tb = document.getElementById('tb').value;
    const displayName = document.getElementById('displayName').value;
    const id_list = selectedPolygonsForMerge.map(p => p.subId);

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

        // ลบ polygon rubber เดิมทั้งหมด
        const layersToRemove = [];
        featureGroup.eachLayer(layer => {
            if (layer.feature?.properties?.classtype === 'rubber') {
                layersToRemove.push(layer);
            }
        });
        layersToRemove.forEach(layer => featureGroup.removeLayer(layer));

        // สร้าง polygon ใหม่
        const collectedFeature = {
            type: 'Feature',
            geometry: data.geom,
            properties: {
                sub_id: id_list[0],
                classtype: 'rubber',
                shpsplit_sqm: Number(data.shpsplit_sqm) || 0
            }
        };

        const newLayer = L.geoJson(collectedFeature, {
            style: getFeatureStyle,
            onEachFeature: onEachFeature
        }).addTo(featureGroup);

        // แสดงพื้นที่ในตาราง (pure JS)
        newLayer.eachLayer(layer => {
            const row = document.querySelector(`#row_${layer.feature.properties.sub_id}`);
            if (row) {
                const area = Number(layer.feature.properties.shpsplit_sqm) || 0;
                // td index 4
                const cells = row.getElementsByTagName('td');
                if (cells.length > 4) {
                    cells[4].textContent = area.toFixed(0);
                }
            }
        });

        // รีเซ็ต merge mode
        mergeMode = false;
        selectedPolygonsForMerge = [];
        document.getElementById('mergePanel').style.display = 'none';
        document.getElementById('mergeModeBtn').textContent = 'เข้าโหมด Merge';
        updateMergeList();

        // แสดง popup ยืนยัน
        L.popup()
            .setLatLng(map.getCenter())
            .setContent('รวม polygon rubber สำเร็จ!')
            .openOn(map);

    } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดขณะรวม polygon: ' + err.message);
    }
});

