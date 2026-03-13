// Initialize map and feature group
const map = L.map('map').setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();
const reshapeFeatureGroup = L.featureGroup();
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
    zIndex: 6
});

const rubber_parcel = L.tileLayer.wms("https://engrids.soc.cmu.ac.th/geoserver/rubber/wms?", {
    layers: 'rubber:rubber_pacel',
    format: 'image/png',
    transparent: true,
    maxZoom: 24,
    zIndex: 7
});

const baseLayers = {
    "Google Road": gmap_road,
    "Google Satellite": gmap_sat.addTo(map),
    "Google Terrain": gmap_terrain,
    "Google Hybrid": gmap_hybrid,
    "Stadia Light": light
};

const ndviTile = L.featureGroup();
const ndwiTile = L.featureGroup();
const trueColorTile = L.featureGroup();

const overlayMaps = {
    "แปลงยาง (reclass)": featureGroup.addTo(map),
    "แปลงยาง (reshape)": reshapeFeatureGroup,
    "แปลงยาง(เดิม)": rubber_parcel,
    "NDVI": ndvi,
    "NDVI gee": ndviTile,
    "NDWI gee": ndwiTile,
    "S2 gee": trueColorTile,
    "Longdo Map": longdoLayer.addTo(map)
};

L.control.layers(baseLayers, overlayMaps).addTo(map);

fetch('/rub/api/gee')
    .then(res => res.json())
    .then((data) => {
        console.log(data);

        const truecolor = L.tileLayer(data.truecolor.urlFormat, {
            attribution: 'Google Earth Engine',
            maxZoom: 24,
            zIndex: 3
        });

        const ndwi = L.tileLayer(data.ndwi.urlFormat, {
            attribution: 'Google Earth Engine',
            maxZoom: 24,
            zIndex: 4
        });

        const ndvi = L.tileLayer(data.ndvi.urlFormat, {
            attribution: 'Google Earth Engine',
            maxZoom: 24,
            zIndex: 5
        });

        // Add layers to map
        truecolor.addTo(trueColorTile);
        ndvi.addTo(ndviTile);
        ndwi.addTo(ndwiTile);
    });

function showFeaturePanel(feature, layer) {
    const id = document.getElementById('id');
    const xls_app_no = document.getElementById('xls_app_no');
    const shpsplit_sqm = document.getElementById('shpsplit_sqm');

    id.value = feature.properties.id;
    xls_app_no.value = feature.properties.app_no;
    shpsplit_sqm.value = Number(feature.properties.shparea_sqm).toFixed(0);
}

const getFeatureStyle = (feature) => {
    const color = feature.properties.classtype === 'rubber'
        ? '#006d2c'
        : feature.properties.classtype === 'Other'
            ? '#d7191c'
            : feature.properties.classtype === 'not-rubber'
                ? '#ff00ff'
                : feature.properties.classtype === 'ex-pond'
                    ? '#7d61fdff'
                    : feature.properties.classtype === 'ex-landcover'
                        ? '#ffbb00ff'
                        : feature.properties.classtype === 'ex-building'
                            ? '#00ffddff'
                            : feature.properties.classtype === 'ex-river'
                                ? '#ff009dff'
                                : feature.properties.classtype === 'ex-unreg-rubber'
                                    ? '#003cffff'
                                    : '#fdae61';
    return {
        fillColor: color,
        weight: 2,
        opacity: 1,
        color: 'white',
        dashArray: '3',
        fillOpacity: 0.5
    };
};


const onEachFeature = (feature, layer) => {
    layer.bindPopup(`${feature.properties.id}`);

    layer.on('click', () => {
        map.fitBounds(layer.getBounds());
        showFeaturePanel(feature, layer);
        selectedLayer = layer;
    });
}

const loadGeoData = async () => {
    try {
        const tb = document.getElementById('tb').value;
        const response = await fetch(`/rub/api/getreclassfeatures/${tb}`);
        const result = await response.json();

        if (!result.success || !result.data) {
            console.error('API error:', result.error || 'No data returned');
            alert('ไม่สามารถโหลดข้อมูลได้: ' + (result.error || 'ไม่พบข้อมูล'));
            return;
        }

        const data = result.data;

        const tableData = data.map(item => ({
            id: item.id,
            sub_id: item.sub_id,
            refinal: item.refinal,
            geom: JSON.parse(item.geom),
            app_no: item.id_farmer || '',
            farm_name: item.farm_name || '',
            age: item.age || '',
            sqm_pacel: item.sqm_pacel || 0,
            sqm_yang: item.sqm_yang || 0,
            shparea_sqm: item.shparea_sqm,
            shpsplit_sqm: item.shpsplit_sqm,
            classtype: item.classtype,
            check_area: item.check_area || '',
            check_shape: item.check_shape || '',
            remark: item.remark || '',
            reviewer: item.reviewer || '',
            user_remark: item.user_remark || ''
        }));

        const dataTable = $('#featureTable').DataTable({
            data: tableData,
            scrollX: true,
            columns: [
                {
                    data: null,
                    title: 'Zoom',
                    orderable: false,
                    render: (data, type, row) => {
                        const _geojson = JSON.stringify(row.geom);
                        return `<a class="btn btn-success btn-sm map-btn" 
                                    data-refid="${row.id}" 
                                    data-geojson='${_geojson}'
                                    href="#"><i class="bi bi-zoom-in"></i> ซูม</a>`
                    }
                },
                { data: 'app_no', title: 'App No' },
                { data: 'id', title: 'ID' },
                {
                    data: 'farm_name',
                    title: 'ชื่อเกษตรกร',
                    render: (data) => data ? `<span title="${data}">${data}</span>` : '<span class="text-muted">-</span>'
                },
                {
                    data: 'age',
                    title: 'อายุ (ปี)',
                    render: (data) => data ? `<b>${Number(data).toFixed(0)}</b>` : '<span class="text-muted">-</span>'
                },
                {
                    data: 'sqm_pacel',
                    title: 'เนื้อที่เป้าหมายโฉนด (m²)',
                    render: (data) => `<span class="area-num area-target">${Number(data).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>`
                },
                {
                    data: 'shparea_sqm',
                    title: 'เนื้อที่ขณะนี้โฉนด (m²)',
                    render: (data) => `<span class="area-num">${Number(data).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>`
                },
                {
                    data: 'sqm_yang',
                    title: 'เนื้อที่ยางพารา (m²)',
                    render: (data) => `<span class="area-num area-yang">${Number(data).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>`
                },
                {
                    data: 'shpsplit_sqm',
                    title: 'เนื้อที่ขณะนี้แยกประเภท (m²)',
                    render: (data) => `<span class="area-num">${Number(data).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>`
                },
                {
                    data: 'classtype',
                    title: 'ประเภท',
                    render: (data) => {
                        const labelMap = {
                            'rubber': 'ยางพาราที่ลงทะเบียน', 'not-rubber': 'ยางพาราที่ไม่ได้ลงทะเบียน',
                            'Other': 'ไม่ใช่ยางพารา', 'ex-pond': 'พื้นที่กันออก (บ่อน้ำ)',
                            'ex-landcover': 'พื้นที่กันออก (สิ่งปกคลุมดินอื่นๆ)',
                            'ex-building': 'พื้นที่กันออก (สิ่งปลูกสร้าง)', 'ex-river': 'พื้นที่กันออก (ลำน้ำ)',
                            'ex-unreg-rubber': 'พื้นที่กันออก (ยางพาราไม่ลงทะเบียน)'
                        };
                        const colorMap = {
                            'rubber': '#2e7d32', 'not-rubber': '#e91e63', 'Other': '#d32f2f',
                            'ex-pond': '#7d61fd', 'ex-landcover': '#f9a825',
                            'ex-building': '#00838f', 'ex-river': '#1565c0', 'ex-unreg-rubber': '#6a1b9a'
                        };
                        const label = labelMap[data] || 'อื่นๆ';
                        const c = colorMap[data] || '#90a4ae';
                        return `<span class="classtype-badge" style="background:${c}18;color:${c};border:1px solid ${c}55;padding:2px 7px;border-radius:999px;font-size:0.78rem;font-weight:600;white-space:nowrap">${label}</span>`;
                    }
                },
                {
                    data: 'check_area',
                    title: 'ตรวจสอบโฉนด',
                    render: (data, type, row) => {
                        // Return plain value for sorting/filtering
                        if (type === 'sort' || type === 'type' || type === 'filter') {
                            return data || '';
                        }
                        const passSelected = data === 'ผ่าน' ? 'selected' : '';
                        const failSelected = data === 'ไม่ผ่าน' ? 'selected' : '';
                        return `<select class="form-select form-select-sm review-check-area" data-subid="${row.sub_id}">
                                    <option value="">-- เลือก --</option>
                                    <option value="ผ่าน" ${passSelected}>✅ ผ่าน</option>
                                    <option value="ไม่ผ่าน" ${failSelected}>❌ ไม่ผ่าน</option>
                                </select>`;
                    }
                },
                {
                    data: 'check_shape',
                    title: 'ตรวจสอบยางพารา',
                    render: (data, type, row) => {
                        // Return plain value for sorting/filtering
                        if (type === 'sort' || type === 'type' || type === 'filter') {
                            return data || '';
                        }
                        const passSelected = data === 'ผ่าน' ? 'selected' : '';
                        const failSelected = data === 'ไม่ผ่าน' ? 'selected' : '';
                        return `<select class="form-select form-select-sm review-check-shape" data-subid="${row.sub_id}">
                                    <option value="">-- เลือก --</option>
                                    <option value="ผ่าน" ${passSelected}>✅ ผ่าน</option>
                                    <option value="ไม่ผ่าน" ${failSelected}>❌ ไม่ผ่าน</option>
                                </select>`;
                    }
                },
                {
                    data: 'remark',
                    title: 'หมายเหตุผู้เช็ค',
                    render: (data, type, row) => {
                        return `<input type="text" class="form-control form-control-sm review-remark" 
                                    data-subid="${row.sub_id}" 
                                    value="${data || ''}" 
                                    placeholder="พิมพ์หมายเหตุ...">`;
                    }
                },
                {
                    data: 'user_remark',
                    title: 'หมายเหตุผู้ใช้',
                    render: (data, type, row) => {
                        return `<input type="text" class="form-control form-control-sm user-remark" 
                                    data-subid="${row.sub_id}" 
                                    value="${data || ''}" 
                                    placeholder="แก้ไขแล้ว / รายละเอียด...">`;
                    }
                },
                {
                    data: 'reviewer',
                    title: 'ผู้ตรวจสอบ',
                    render: (data) => {
                        if (!data) return '<span class="text-muted">-</span>';
                        return `<span class="badge bg-success bg-opacity-75">${data}</span>`;
                    }
                },
                {
                    data: null,
                    title: 'บันทึก',
                    orderable: false,
                    render: (data, type, row) => {
                        return `<button class="btn btn-sm btn-save-review" data-subid="${row.sub_id}">
                                    <i class="bi bi-floppy"></i> บันทึก
                                </button>`;
                    }
                },
                {
                    data: null,
                    title: 'ลบ',
                    orderable: false,
                    render: (data, type, row) => {
                        return `<button class="btn btn-sm btn-delete-row" data-subid="${row.sub_id}" data-parentid="${row.id}" title="ลบแถวนี้">
                                    <i class="bi bi-trash3-fill"></i>
                                </button>`;
                    }
                },
            ],
            pageLength: 10,
            select: true,
            destroy: true,
        });

        // แก้ปัญหาตารางไม่ตรงช่องเมื่อวาดเสร็จ
        setTimeout(() => {
            if ($.fn.DataTable.isDataTable('#featureTable')) {
                $('#featureTable').DataTable().columns.adjust().draw();
            }
        }, 500);
        
        // แก้ปัญหาเวลาขยายลากจอ
        $(window).on('resize', function () {
            if ($.fn.DataTable.isDataTable('#featureTable')) {
                $('#featureTable').DataTable().columns.adjust();
            }
        });


        const updateMap = () => {
            featureGroup.clearLayers(); // Clear existing layers
            const visibleRows = dataTable.rows({ search: 'applied' }).data().toArray();

            visibleRows.forEach(row => {
                const geojson = {
                    type: 'Feature',
                    geometry: row.geom,
                    properties: {
                        id: row.id,
                        refinal: row.refinal,
                        app_no: row.app_no,
                        xls_sqm: row.xls_sqm,
                        shparea_sqm: row.shparea_sqm,
                        classtype: row.classtype
                    }
                }

                L.geoJson(geojson, {
                    style: getFeatureStyle,
                    onEachFeature: onEachFeature
                }).addTo(featureGroup);
            });
        };

        updateMap();

        $('#featureTable tbody').on('click', '.map-btn', function (e) {
            try {
                e.stopPropagation();
                const geojson = $(this).data('geojson');
                const layer = L.geoJSON(geojson)

                const bounds = layer.getBounds();
                map.fitBounds(bounds, {
                    padding: [20, 20],
                    // maxZoom: 16         
                });
                selectedLayer = layer;
            } catch (error) {
                console.error('Failed to parse GeoJSON:', error);
            }
        });

        dataTable.rows().every(function () {
            const rowData = this.data();
            $(this.node()).attr('id', `row_${rowData.id}`);
        });

        // Save review handler
        $('#featureTable tbody').on('click', '.btn-save-review', async function () {
            const btn = $(this);
            const subId = btn.data('subid');
            const row = btn.closest('tr');
            const checkArea = row.find('.review-check-area').val();
            const checkShape = row.find('.review-check-shape').val();
            const remark = row.find('.review-remark').val();
            const userRemark = row.find('.user-remark').val();
            const tb = document.getElementById('tb').value;

            // Get reviewer name from profile
            const displayName = document.getElementById('display-name')?.textContent || '';


            // Determine if review-related fields have changed
            const dataTable = $('#featureTable').DataTable();
            const rowData = dataTable.row(row).data();

            const currentReviewer = rowData.reviewer || '';
            const originalCheckArea = rowData.check_area || '';
            const originalCheckShape = rowData.check_shape || '';
            const originalRemark = rowData.remark || '';

            const isReviewChanged = (checkArea !== originalCheckArea) ||
                (checkShape !== originalCheckShape) ||
                (remark !== originalRemark);

            // If Review fields changed -> Update Reviewer to current user (displayName)
            // If ONLY User Remark changed (or no review change) -> Keep existing Reviewer
            let reviewerToSave = currentReviewer;
            if (isReviewChanged) {
                reviewerToSave = displayName;
            }

            btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i>');

            try {
                const res = await fetch(`/rub/api/update_review/${tb}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sub_id: subId,
                        check_area: checkArea,
                        check_shape: checkShape,
                        remark: remark,
                        user_remark: userRemark,
                        reviewer: reviewerToSave
                    })
                });

                const data = await res.json();
                if (data.success) {
                    btn.html('<i class="bi bi-check-lg"></i> สำเร็จ').addClass('btn-review-saved');
                    // Update reviewer badge in the row
                    const reviewerCell = row.find('td').eq(-2); // reviewer column
                    if (reviewerToSave) {
                        reviewerCell.html(`<span class="badge bg-success bg-opacity-75">${reviewerToSave}</span>`);
                    }

                    // Update internal DataTable data so next save compares correctly against these new values
                    rowData.check_area = checkArea;
                    rowData.check_shape = checkShape;
                    rowData.remark = remark;
                    rowData.user_remark = userRemark;
                    rowData.reviewer = reviewerToSave;
                    dataTable.row(row).data(rowData);
                    setTimeout(() => {
                        btn.html('<i class="bi bi-floppy"></i> บันทึก').removeClass('btn-review-saved').prop('disabled', false);
                    }, 2000);
                } else {
                    alert('บันทึกไม่สำเร็จ: ' + (data.error || 'Unknown error'));
                    btn.html('<i class="bi bi-floppy"></i> บันทึก').prop('disabled', false);
                }
            } catch (err) {
                console.error('Save review error:', err);
                alert('เกิดข้อผิดพลาด: ' + err.message);
                btn.html('<i class="bi bi-floppy"></i> บันทึก').prop('disabled', false);
            }
        });

        // Delete row handler
        $('#featureTable tbody').on('click', '.btn-delete-row', async function () {
            const btn = $(this);
            const subId = btn.data('subid');
            const tb = document.getElementById('tb').value;
            if (!confirm(`ยืนยันลบรายการ sub_id: ${subId} ใช่หรือไม่?`)) return;
            btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i>');
            try {
                const res = await fetch(`/rub/api/delete_reclass_feature/${tb}/${subId}`, {
                    method: 'DELETE'
                });
                const result = await res.json();
                if (result.success) {
                    const row = btn.closest('tr');
                    dataTable.row(row).remove().draw();
                } else {
                    alert('ลบไม่สำเร็จ: ' + (result.error || 'Unknown error'));
                    btn.prop('disabled', false).html('<i class="bi bi-trash3-fill"></i>');
                }
            } catch (err) {
                alert('เกิดข้อผิดพลาด: ' + err.message);
                btn.prop('disabled', false).html('<i class="bi bi-trash3-fill"></i>');
            }
        });

    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load spatial data');
    }
};

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
            'พื้นที่กันออก (ยางพาราไม่ลงทะเบียน)',
            'ขอบเขต Reshape'
        ];

    // Add Reshape legend item first
    div.innerHTML += `<i style="background:#2196F3; width:14px; height:14px; display:inline-block; margin-right:6px; opacity:0.8; border:1px solid #1565C0"></i> ขอบเขต Reshape<br>`;


    for (let i = 0; i < categories.length; i++) {
        const dummy = { properties: { classtype: categories[i] } },
            style = getFeatureStyle(dummy);

        div.innerHTML +=
            `<i style="background:${style.fillColor}; width:14px; height:14px; display:inline-block; margin-right:6px;"></i> ${labels[i]}<br>`;
    }
    return div;
};


legend.addTo(map);

document.getElementById('reshape').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reshape/index.html?tb=' + tb;
});



document.addEventListener('DOMContentLoaded', async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const tb = urlParams.get('tb');
        if (!tb || tb === 'undefined') {
            alert('พื้นที่ไม่ถูกต้อง');
            window.location.href = './../index.html';
        }

        document.getElementById('tb').value = tb;
        await loadGeoData();
        if (featureGroup.getLayers().length > 0) {
            map.fitBounds(featureGroup.getBounds());
        }

        // Invalidate map size so it fills its container
        setTimeout(() => {
            map.invalidateSize();
            if ($.fn.DataTable.isDataTable('#featureTable')) {
                $('#featureTable').DataTable().columns.adjust();
            }
        }, 200);


        // Load reshape polygon data as overlay layer
        try {
            const reshapeRes = await fetch('/rub/api/getreshapefeatures/' + tb);
            const reshapeResult = await reshapeRes.json();
            if (reshapeResult.success && reshapeResult.data) {
                reshapeFeatureGroup.clearLayers();
                reshapeResult.data.forEach(item => {
                    if (!item.geom) return;
                    const geom = JSON.parse(item.geom);
                    const geojson = {
                        type: 'Feature',
                        geometry: geom,
                        properties: {
                            id: item.id,
                            app_no: item.id_farmer,
                            xls_sqm: item.xls_sqm,
                            shparea_sqm: item.shparea_sqm
                        }
                    };
                    L.geoJson(geojson, {
                        style: () => ({
                            fillColor: '#2196F3',
                            weight: 2,
                            opacity: 0.8,
                            color: '#1565C0',
                            dashArray: '5,5',
                            fillOpacity: 0.12
                        }),
                        onEachFeature: (feature, layer) => {
                            layer.bindPopup(`<b>Reshape</b><br>ID: ${feature.properties.id}<br>เลขบัตรประชาชน: ${feature.properties.app_no}`);
                        }
                    }).addTo(reshapeFeatureGroup);
                });
            }
        } catch (reshapeErr) {
            console.error('Error loading reshape data:', reshapeErr);
        }

        const response = await fetch('/rub/api/countsfeatures/' + tb);
        const data = await response.json();

        const chartData = [
            { name: 'จำนวนทั้งหมด', y: parseInt(data.total), color: '#7cb5ec' },
            { name: 'ปรับแก้เนื้อที่แล้ว', y: parseInt(data.reshp), color: '#434348' },
            { name: 'classified แล้ว', y: parseInt(data.reclass), color: '#90ed7d' }
        ];

        Highcharts.chart('container', {
            chart: { type: 'bar', height: 150, style: { fontFamily: 'Noto Sans Thai' } },
            title: { text: null },
            xAxis: { type: 'category', },
            yAxis: { min: 0, title: { text: 'จำนวน (แปลง)', style: { fontFamily: 'Noto Sans Thai' } } },
            series: [{
                name: 'Counts',
                data: chartData,
                dataLabels: { enabled: true, format: '{y}' }
            }],
            tooltip: { pointFormat: '<b>{point.y}</b> แปลง' },
            credits: { enabled: false },
            legend: { enabled: false }
        });

        const raiFetch = await fetch('/rub/api/countsrai/reclass_' + tb);
        const raiData = await raiFetch.json();

        // จัดกลุ่มประเภทต่างๆ ก่อนแสดงผล เพื่อป้องกันแถวซ้ำกัน (เช่น มี "ไม่ระบุ" หลายอัน)
        const groupedData = {};
        raiData.forEach(r => {
            let cat = 'ไม่ระบุ';
            if (r.classtype === 'rubber') cat = 'ยางพาราที่ลงทะเบียน';
            else if (r.classtype === 'not-rubber') cat = 'ยางพาราที่ไม่ได้ลงทะเบียน';
            else if (r.classtype === 'Other') cat = 'ไม่ใช่ยางพารา';
            else if (r.classtype === 'ex-pond') cat = 'พื้นที่กันออก (บ่อน้ำ)';
            else if (r.classtype === 'ex-landcover') cat = 'พื้นที่กันออก (สิ่งปกคลุมดินอื่นๆ)';
            else if (r.classtype === 'ex-building') cat = 'พื้นที่กันออก (สิ่งปลูกสร้าง)';
            else if (r.classtype === 'ex-river') cat = 'พื้นที่กันออก (ลำน้ำ)';
            else if (r.classtype === 'ex-unreg-rubber') cat = 'พื้นที่กันออก (ยางพาราไม่ลงทะเบียน)';

            groupedData[cat] = (groupedData[cat] || 0) + parseFloat(r.area_rai);
        });

        const categories = Object.keys(groupedData);
        const dataRai = Object.values(groupedData).map(val => Number(val.toFixed(2)));

        // คำนวณความสูงให้สมดุลกับจำนวนแท่งกราฟ (ขั้นต่ำ 150px)
        const dynamicHeight = Math.max(150, categories.length * 45 + 50);

        Highcharts.chart('count-rai', {
            chart: { type: 'bar', height: dynamicHeight, style: { fontFamily: 'Noto Sans Thai' } },
            title: { text: null },
            xAxis: { categories: categories, },
            yAxis: { min: 0, title: { text: 'เนื้อที่ (ไร่)' } },
            tooltip: { pointFormat: '<b>{point.y:.2f} ไร่</b>' },
            series: [{
                name: 'Area',
                data: dataRai,
                color: '#29b6f6',
                dataLabels: { enabled: true, format: '{y}' }
            }],
            credits: { enabled: false },
            legend: { enabled: false }
        });

    } catch (err) {
        console.error('Error fetching data:', err);
    }
});

document.addEventListener('DOMContentLoaded', () => {

});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/rub/auth/me');
        const { user } = await res.json();
        // console.log(user);

        if (user) {
            // Show profile section
            document.getElementById('google-login-link').style.display = 'none';
            document.getElementById('profile-section').style.display = 'flex';
            document.getElementById('profile-image').src = user.photo;
            document.getElementById('display-name').textContent = user.displayName;

            // Logout handler
            document.getElementById('logout-link').addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    await fetch('/rub/auth/logout');
                    window.location.reload();
                } catch (err) {
                    console.error('Logout failed:', err);
                }
            });
        }
    } catch (err) {
        console.error('Failed to fetch user:', err);
    }
});

