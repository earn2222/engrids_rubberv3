
// Initialize map and feature group
const map = L.map('map').setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();
const lddFeatureGroup = L.featureGroup();
// Configure base layer
const gmap_road = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    maxZoom: 50,
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
    position: 'topleft',
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

function showFeaturePanel(feature, layer) {
    const xls = Number(feature.properties.xls_sqm);
    const id = document.getElementById('id');
    const app_no = document.getElementById('app_no');
    ('xls_sqm'); const xls_sqm = document.getElementById
    const refinal = document.getElementById('refinal');

    id.value = feature.properties.id;
    app_no.value = feature.properties.app_no;
    xls_sqm.value = feature.properties.xls_sqm;
    refinal.value = feature.properties.refinal;

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

const onEachFeature = (feature, layer) => {
    layer.bindPopup(`${feature.properties.id}`);

    layer.on('click', (e) => {
        // map.fitBounds(layer.getBounds());
        showFeaturePanel(feature, layer);
        featureGroup.eachLayer(l => l.pm.disable());
        layer.pm.enable();

        selectedLayer = layer;
    });

    layer.on('pm:edit pm:dragend pm:update pm:change', () => updateAreaLabel(layer));
}

let selectedFeature = null; // เก็บข้อมูลจากตาราง (app_no, xls_sqm ฯลฯ)
let selectedLayer = null;   // เก็บ layer ที่กำลังถูกวาดหรือแก้ไข

const loadGeoData = async () => {
    try {
        const tb = document.getElementById('tb').value;
        // console.log('โหลดข้อมูลจากตาราง:', tb);
        const response = await fetch(`/rub/api/getfeaturesv3/${tb}`);
        const { data } = await response.json();
        // console.log('Loaded data:', data);

        const tableData = data.map(item => ({
            id: item.id,
            refinal: item.refinal,
            farm_name: item.farm_name,
            f_name: item.f_name,
            l_name: item.l_name,
            age: item.age,
            geom_point: item.geom_point,
            geom: item.geom,
            app_no: item.app_no,
            xls_sqm: item.xls_sqm,
            shparea_sqm: item.shparea_sqm,
            classified: item.classified,
        }));

        // console.log('tableData', tableData);

        // สร้างตารางหน้า ui
        const dataTable = $('#featureTable').DataTable({
            data: tableData,
            columns: [
                {
                    data: null,
                    title: 'Zoom',
                    render: (data, type, row) => {
                        const _geojson = row.geom_point;
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
                { data: 'app_no', title: 'Application No' },
                { data: 'xls_sqm', title: 'เนื้อที่เป้าหมาย (m²)' },
                {
                    data: 'shparea_sqm',
                    title: 'เนื้อที่ขณะนี้ (m²)',
                    render: (data, type, row) => Number(data).toFixed(0)
                },
                {
                    data: null,
                    title: 'ตรวจสอบ (m²)',
                    render: (data, type, row) => {
                        const xls = Number(data.xls_sqm);
                        const shp = Number(data.shparea_sqm);
                        const diff = xls - shp;
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
            featureGroup.clearLayers();
            const visibleRows = dataTable.rows({ search: 'applied' }).data().toArray();

            visibleRows.forEach(row => {
                // ✅ 1. แสดง Polygon (ถ้ามี)
                if (row.geom) {
                    let geom = row.geom;
                    if (typeof geom === 'string') {
                        try {
                            geom = JSON.parse(geom);
                        } catch (e) {
                            console.warn(`Invalid Polygon JSON for row ${row.id}`);
                            geom = null;
                        }
                    }

                    if (geom && geom.type && geom.coordinates) {
                        const geoJsonData = {
                            type: 'Feature',
                            geometry: geom,
                            properties: {
                                id: row.id,
                                refinal: row.refinal,
                                app_no: row.app_no,
                                xls_sqm: row.xls_sqm,
                                shparea_sqm: row.shparea_sqm
                            }
                        };

                        L.geoJson(geoJsonData, {
                            style: getFeatureStyle,
                            onEachFeature: onEachFeature,
                        }).addTo(featureGroup);
                    }
                }

                // ✅ 2. แสดง Point (แน่นอน)
                if (row.geom_point) {
                    let point = row.geom_point;

                    // 👇 แปลงเป็น object ถ้าเป็น string
                    if (typeof point === 'string') {
                        try {
                            point = JSON.parse(point);
                        } catch (e) {
                            console.warn(`Invalid point JSON for row ${row.id}:`, point);
                            return;
                        }
                    }

                    if (point && point.type === 'Point' && Array.isArray(point.coordinates)) {
                        const [lng, lat] = point.coordinates;
                        const circleMarker = L.circleMarker([lat, lng], {
                            radius: 5,
                            color: 'white',
                            fillColor: 'red',
                            fillOpacity: 1
                        }).addTo(featureGroup);

                        circleMarker.bindPopup(`
                    <b>Point ID:</b> ${row.id}<br>
                    <b>App No:</b> ${row.app_no}
                `);
                    } else {
                        console.warn(`Invalid point format for row ${row.id}:`, point);
                    }
                }
            });
        };


        updateMap();

        dataTable.on('draw', () => {
            updateMap();
        });

        //  ปุ่ม Zoom ในตาราง
        $('#featureTable tbody').on('click', '.map-btn', function (e) {
            try {
                e.stopPropagation();
                const geojson = $(this).data('geojson'); // จุด point
                const zoomLevel = 20;
                map.setView([geojson.coordinates[1], geojson.coordinates[0]], zoomLevel);

                // ✅ เก็บข้อมูล row เพื่อใช้ตอนวาด polygon
                const row = dataTable.row($(this).closest('tr')).data();
                selectedFeature = {
                    id: row.id,
                    app_no: row.app_no,
                    xls_sqm: row.xls_sqm,
                    refinal: row.refinal
                };

                // ✅ แสดงค่าลง input ด้านขวา
                document.getElementById('id').value = selectedFeature.id;
                document.getElementById('app_no').value = selectedFeature.app_no;
                document.getElementById('xls_sqm').value = selectedFeature.xls_sqm;
                document.getElementById('refinal').value = selectedFeature.refinal;
                document.getElementById('shparea_sqm').value = ""; // reset ก่อนวาดใหม่
                document.getElementById('message').innerHTML = "";

            } catch (error) {
                console.error('Failed to handle zoom click:', error);
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
                window.open(`/rub/reclass/index.html?tb=${tb}&id=${id}`, '_self');
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
            // map.fitBounds(featureGroup.getBounds());
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


//testv3 ฟังก์ชัน save 
document.getElementById('save').addEventListener('click', async () => {
    if (!selectedLayer) {
        alert('กรุณาเลือกแปลงที่ต้องการบันทึกก่อน');
        return;
    }

    const id = document.getElementById('id').value;
    const refinal = document.getElementById('refinal').value;
    const editor = document.getElementById('displayName').value;
    const tb = document.getElementById('tb').value;

    // ✅ ดึง geometry จาก feature
    const feature = selectedLayer.toGeoJSON();
    const geom = JSON.stringify(feature.geometry);  // เก็บเฉพาะ geometry

    try {
        const response = await fetch(`/rub/api/updatefeaturesv3/${tb}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, refinal, editor, geom })
        });

        const resultText = await response.text();
        if (response.ok) {
            alert(`อัปเดตข้อมูล ID: ${id} สำเร็จแล้ว`);

            featureGroup.eachLayer(layer => {
                layer.pm.disable();
                layer.areaLabel?.remove();
            });

            featureGroup.clearLayers();
            loadGeoData(); // โหลดข้อมูลใหม่
        } else {
            alert('บันทึกไม่สำเร็จ: ' + resultText);
        }
    } catch (error) {
        console.error('Error saving data:', error);
        alert('เกิดข้อผิดพลาดขณะบันทึกข้อมูล');
    }
});


// document.getElementById('digitize').addEventListener('click', function () {
//     const tb = document.getElementById('tb').value;
//     const id = document.getElementById('id').value;
//     window.location.href = `./../digitize/index.html?tb=${tb}&id=${id}`;
// });

