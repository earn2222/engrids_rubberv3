// Initialize map and feature group
const map = L.map('map', { maxZoom: 22 }).setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();
const reshapeFeatureGroup = L.featureGroup();

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
    zIndex: 6
});

const rubber_parcel = L.tileLayer.wms("https://engrids.soc.cmu.ac.th/geoserver/rubber/wms?", {
    layers: 'rubber:rubber_pacel',
    format: 'image/png',
    transparent: true,
    maxZoom: 22,
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

        const truecolor = L.tileLayer(data.truecolor.urlFormat, {
            attribution: 'Google Earth Engine',
            maxZoom: 22,
            maxNativeZoom: 18,
            zIndex: 3
        });

        const ndwi = L.tileLayer(data.ndwi.urlFormat, {
            attribution: 'Google Earth Engine',
            maxZoom: 22,
            maxNativeZoom: 18,
            zIndex: 4
        });

        const ndvi = L.tileLayer(data.ndvi.urlFormat, {
            attribution: 'Google Earth Engine',
            maxZoom: 22,
            maxNativeZoom: 18,
            zIndex: 5
        });

        // Add layers to map
        truecolor.addTo(trueColorTile);
        ndvi.addTo(ndviTile);
        ndwi.addTo(ndwiTile);
    });

function showFeaturePanel(feature, layer) {
    const id = document.getElementById('id');
    const xls_id_farmer = document.getElementById('xls_id_farmer');
    const shpsplit_sqm = document.getElementById('shpsplit_sqm');

    if (id) id.value = feature.properties.id || '';
    if (xls_id_farmer) xls_id_farmer.value = feature.properties.id_farmer || '';
    if (shpsplit_sqm) shpsplit_sqm.value = Number(feature.properties.shparea_sqm || 0).toFixed(0);
}

const getFeatureStyle = (feature) => {
    const color = feature.properties.classtype === 'rubber'
        ? '#006d2c'
        : feature.properties.classtype === 'Other'
            ? '#ff0004ff'
            : feature.properties.classtype === 'not-rubber'
                ? '#9900ffff'
                : feature.properties.classtype === 'ex-pond'
                    ? '#00fff2ff'
                    : feature.properties.classtype === 'ex-landcover'
                        ? '#ffe600ff'
                        : feature.properties.classtype === 'ex-building'
                            ? '#ff00bfff'
                            : feature.properties.classtype === 'ex-river'
                                ? '#1100ffff'
                                : feature.properties.classtype === 'ex-unreg-rubber'
                                    ? '#00ff0dff'
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

        const urlParams = new URLSearchParams(window.location.search);
        const id_from = parseInt(urlParams.get('id_from'));
        const id_to = parseInt(urlParams.get('id_to'));
        const assignee = urlParams.get('assignee');

        let data = result.data;
        if (!isNaN(id_from) && !isNaN(id_to)) {
            data = result.data.filter(item => item.id >= id_from && item.id <= id_to);
            console.log(`Filtering for ${assignee}: IDs ${id_from} - ${id_to}. Found ${data.length} records.`);
            
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



        const tableData = data.map(item => ({
            id: item.id,
            sub_id: item.sub_id,
            refinal: item.refinal,
            geom: JSON.parse(item.geom),
            id_farmer: item.id_farmer || '',
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
            user_remark: item.user_remark || '',
            user_remark_ts: item.user_remark_ts || '',
            review_ts: item.review_ts || ''
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
                        const urlParams = new URLSearchParams(window.location.search);
                        const id_from = urlParams.get('id_from');
                        const id_to = urlParams.get('id_to');
                        const assignee = urlParams.get('assignee');
                        
                        let reclassUrl = `./../reclass/index.html?tb=${document.getElementById('tb').value}&id=${row.id}&sqm_yang=${row.sqm_yang}`;
                        if (id_from && id_to && assignee) {
                            reclassUrl += `&id_from=${id_from}&id_to=${id_to}&assignee=${encodeURIComponent(assignee)}`;
                        }

                        return `<a class="btn btn-success btn-sm map-btn" 
                                    data-refid="${row.id}" 
                                    data-geojson='${_geojson}'
                                    href="#"><i class="bi bi-zoom-in"></i> ซูม</a>
                                <a class="btn btn-warning btn-sm mt-1" 
                                    href="${reclassUrl}"
                                    ><i class="bi bi-pencil-square"></i> แก้ไข</a>`
                    }
                },
                { data: 'id', title: 'ID' },
                { data: 'id_farmer', title: 'เลขทะเบียนเกษตรกร' },
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
                    title: 'เนื้อที่โฉนดขณะนี้ (m²)',
                    render: (data) => `<span class="area-num">${Number(data).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>`
                },
                {
                    data: 'sqm_yang',
                    title: 'เนื้อที่เป้าหมายยางพารา (m²)',
                    render: (data) => `<span class="area-num area-yang">${Number(data).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>`
                },
                {
                    data: 'shpsplit_sqm',
                    title: 'เนื้อที่แยกประเภทขณะนี้ (m²)',
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
                            'rubber': '#006d2c',
                            'not-rubber': '#9900ff',
                            'Other': '#ff0004',
                            'ex-pond': '#00d9d0',
                            'ex-landcover': '#e6cc00',
                            'ex-building': '#ff00bf',
                            'ex-river': '#1100ff',
                            'ex-unreg-rubber': '#00cc0d'
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
                    title: 'ตรวจสอบการจำเเนกประเภท',
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
                    width: '250px',
                    render: (data, type, row) => {
                        let dateStr = '';
                        if (row.user_remark_ts) {
                            const date = new Date(row.user_remark_ts);
                            const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                            dateStr = `<div class="text-muted mt-1 user-remark-time" style="font-size: 0.75rem;"><i class="bi bi-clock"></i> ${date.toLocaleDateString('th-TH', options)}น.</div>`;
                        }
                        return `<div style="min-width: 250px;">
                                    <div class="input-group input-group-sm">
                                        <input type="text" class="form-control user-remark" 
                                            data-subid="${row.sub_id}" 
                                            value="${data || ''}" 
                                            placeholder="แก้ไขแล้ว / รายละเอียด...">
                                        <button class="btn btn-outline-primary btn-save-user-remark" type="button" data-subid="${row.sub_id}" title="บันทึกหมายเหตุผู้ใช้">
                                            <i class="bi bi-floppy"></i>
                                        </button>
                                        <button class="btn btn-outline-danger btn-clear-user-remark" type="button" data-subid="${row.sub_id}" title="ลบหมายเหตุผู้ใช้" ${!data && !row.user_remark_ts ? 'style="display:none;"' : ''}>
                                            <i class="bi bi-trash3-fill"></i>
                                        </button>
                                    </div>
                                    ${dateStr}
                                </div>`;
                    }
                },
                {
                    data: 'reviewer',
                    title: 'ผู้ตรวจสอบ',
                    width: '280px',
                    render: (data, type, row) => {
                        if (type === 'sort' || type === 'filter' || type === 'type') {
                            return data || '';
                        }
                        
                        let dateStr = '';
                        if (row.review_ts) {
                            const date = new Date(row.review_ts);
                            const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                            dateStr = `<div class="text-muted mt-1 reviewer-time" style="font-size: 0.75rem;"><i class="bi bi-clock"></i> ${date.toLocaleDateString('th-TH', options)}น.</div>`;
                        }
                        return `
                        <div class="d-flex justify-content-between align-items-start">
                            <div class="reviewer-input-container" style="flex-grow: 1;">
                                <input type="text" class="form-control form-control-sm review-reviewer" 
                                    data-subid="${row.sub_id}" 
                                    value="${data || ''}" 
                                    readonly
                                    placeholder="ชื่อผู้ตรวจ...">
                                ${dateStr}
                            </div>
                            <button class="btn btn-sm btn-link text-danger p-0 ms-2 btn-clear-review" data-subid="${row.sub_id}" title="ลบข้อมูลการตรวจแถวนี้">
                                <i class="bi bi-x-circle-fill"></i>
                            </button>
                        </div>`;
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

        // Auto-fill reviewer name when changing status
        $('#featureTable tbody').on('change', '.review-check-area, .review-check-shape', function() {
            const row = $(this).closest('tr');
            const reviewerInputEl = row.find('.review-reviewer');
            const displayName = document.getElementById('display-name')?.textContent || '';
            if (displayName && !reviewerInputEl.val()) {
                reviewerInputEl.val(displayName);
            }
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
                        id_farmer: row.id_farmer,
                        sqm_pacel: row.sqm_pacel,
                        shparea_sqm: row.shparea_sqm,
                        classtype: row.classtype
                    }
                }

                L.geoJson(geojson, {
                    style: getFeatureStyle,
                    onEachFeature: onEachFeature,
                    pointToLayer: function (feature, latlng) {
                        return L.marker(latlng, { icon: rubberTreeIcon });
                    }
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

        // Save user remark handler
        $('#featureTable tbody').on('click', '.btn-save-user-remark', async function () {
            const btn = $(this);
            const subId = btn.data('subid');
            const row = btn.closest('tr');
            const userRemark = row.find('.user-remark').val();
            const tb = document.getElementById('tb').value;

            btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i>');

            try {
                const res = await fetch(`/rub/api/update_user_remark/${tb}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sub_id: subId,
                        user_remark: userRemark
                    })
                });

                const data = await res.json();
                if (data.success) {
                    btn.html('<i class="bi bi-check-lg"></i>').removeClass('btn-outline-primary').addClass('btn-success');

                    const updatedTs = data.data && data.data[0] ? data.data[0].user_remark_ts : new Date().toISOString();

                    const dataTable = $('#featureTable').DataTable();
                    const rowData = dataTable.row(row).data();
                    rowData.user_remark = userRemark;
                    rowData.user_remark_ts = updatedTs;
                    dataTable.row(row).data(rowData);

                    let dateStr = '';
                    if (updatedTs) {
                        const date = new Date(updatedTs);
                        const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                        dateStr = `<div class="text-muted mt-1 user-remark-time" style="font-size: 0.75rem;"><i class="bi bi-clock"></i> ${date.toLocaleDateString('th-TH', options)}น.</div>`;
                    }
                    const cellDiv = btn.closest('div').parent();
                    cellDiv.find('.user-remark-time').remove();
                    cellDiv.append(dateStr);

                    if (updatedTs) {
                        cellDiv.find('.btn-clear-user-remark').show();
                    } else {
                        cellDiv.find('.btn-clear-user-remark').hide();
                    }

                    setTimeout(() => {
                        btn.html('<i class="bi bi-floppy"></i>').removeClass('btn-success').addClass('btn-outline-primary').prop('disabled', false);
                    }, 2000);
                } else {
                    alert('บันทึกไม่สำเร็จ: ' + (data.error || 'Unknown error'));
                    btn.html('<i class="bi bi-floppy"></i>').prop('disabled', false);
                }
            } catch (err) {
                console.error('Save user remark error:', err);
                alert('เกิดข้อผิดพลาด: ' + err.message);
                btn.html('<i class="bi bi-floppy"></i>').prop('disabled', false);
            }
        });

        // Clear user remark handler
        $('#featureTable tbody').on('click', '.btn-clear-user-remark', function () {
            const btn = $(this);
            const row = btn.closest('tr');
            if (confirm('ยืนยันลบหมายเหตุผู้ใช้ ใช่หรือไม่?')) {
                row.find('.user-remark').val('');
                row.find('.btn-save-user-remark').click();
            }
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
            const reviewerInput = row.find('.review-reviewer').val();
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

            // If login name is available, always use it and update UI
            let reviewerToSave = reviewerInput;
            if (displayName) {
                reviewerToSave = displayName;
                row.find('.review-reviewer').val(displayName);
            }
            
            // Fallback to current if still no name
            if (!reviewerToSave) {
                reviewerToSave = currentReviewer;
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
                    const updatedTs = data.data && data.data[0] ? data.data[0].review_ts : new Date().toISOString();

                    // Update reviewer input and timestamp in the row
                    if (reviewerToSave) {
                        let dateStr = '';
                        if (updatedTs) {
                            const date = new Date(updatedTs);
                            const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                            dateStr = `<div class="text-muted mt-1 reviewer-time" style="font-size: 0.75rem;"><i class="bi bi-clock"></i> ${date.toLocaleDateString('th-TH', options)}น.</div>`;
                        }
                        
                        const container = row.find('.reviewer-input-container');
                        if (container.length) {
                            container.find('.review-reviewer').val(reviewerToSave);
                            container.find('.reviewer-time').remove();
                            container.append(dateStr);
                        }
                    }

                    // Update internal DataTable data so next save compares correctly against these new values
                    rowData.check_area = checkArea;
                    rowData.check_shape = checkShape;
                    rowData.remark = remark;
                    rowData.user_remark = userRemark;
                    rowData.reviewer = reviewerToSave;
                    rowData.review_ts = updatedTs;
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

        // Clear review handler
        $('#featureTable tbody').on('click', '.btn-clear-review', async function () {
            const btn = $(this);
            const subId = btn.data('subid');
            const row = btn.closest('tr');
            const tb = document.getElementById('tb').value;

            if (!confirm('ยืนยันลบข้อมูลผู้ตรวจสอบแถวนี้ใช่หรือไม่?')) return;

            btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i>');

            try {
                const res = await fetch(`/rub/api/clear_review/${tb}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sub_id: subId })
                });

                const data = await res.json();
                if (data.success) {
                    const dataTable = $('#featureTable').DataTable();
                    const rowData = dataTable.row(row).data();

                    rowData.check_area = '';
                    rowData.check_shape = '';
                    rowData.remark = '';
                    rowData.reviewer = '';
                    rowData.review_ts = '';
                    dataTable.row(row).data(rowData);

                    row.find('.review-check-area').val('');
                    row.find('.review-check-shape').val('');
                    row.find('.review-remark').val('');
                    
                    row.find('.review-reviewer').val('');
                    row.find('.reviewer-time').remove();
                } else {
                    alert('ลบไม่สำเร็จ: ' + (data.error || 'Unknown error'));
                    btn.html('<i class="bi bi-x-circle-fill"></i>').prop('disabled', false);
                }
            } catch (err) {
                console.error('Clear review error:', err);
                alert('เกิดข้อผิดพลาด: ' + err.message);
                btn.html('<i class="bi bi-x-circle-fill"></i>').prop('disabled', false);
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
    const urlParams = new URLSearchParams(window.location.search);
    const id_from = urlParams.get('id_from');
    const id_to = urlParams.get('id_to');
    const assignee = urlParams.get('assignee');
    
    let url = `./../reshape/index.html?tb=${tb}`;
    if (id_from && id_to) {
        url += `&id_from=${id_from}&id_to=${id_to}&assignee=${encodeURIComponent(assignee)}`;
    }
    window.location.href = url;
});


/* ══════════════════════════════════════════════════════════
   Task Assignment Progress Card
══════════════════════════════════════════════════════════ */
async function loadTaskProgress(tb, currentUser) {
    const card = document.getElementById('taskProgressCard');
    const listEl = document.getElementById('taskProgressList');
    if (!card || !listEl) return;

    try {
        const res = await fetch(`/rub/api/task-progress/${tb}`);
        const { data } = await res.json();

        if (!data || data.length === 0) {
            card.style.display = 'none';
            return;
        }

        card.style.display = '';

        const palette = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4', '#FF5722', '#795548'];
        const colorMap = {};
        let ci = 0;
        data.forEach(d => {
            if (!colorMap[d.assignee_name]) { colorMap[d.assignee_name] = palette[ci++ % palette.length]; }
        });

        // Filter to show only current user's progress if specified
        let displayData = data;
        if (currentUser) {
            displayData = data.filter(d => 
                d.assignee_name.toLowerCase().includes(currentUser.toLowerCase())
            );
        }

        let overallHtml = '';
        if (!currentUser && data.length > 0) {
            const totalDone = data.reduce((acc, item) => acc + (item.done || 0), 0);
            const totalTotal = data.reduce((acc, item) => acc + (item.total || 0), 0);
            const totalPct = totalTotal > 0 ? Math.round((totalDone / totalTotal) * 100) : 0;

            overallHtml = `
                <div class="tp-overall mb-3 p-3 shadow-sm" style="border-radius: 12px; background: linear-gradient(135deg, #f1f8e9, #ffffff); border: 1px solid #c8e6c9;">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <div class="fw-bold" style="color: #2e7d32;"><i class="bi bi-people-fill me-2"></i>ความคืบหน้าภาพรวม</div>
                        <div class="fw-bold" style="color: #2e7d32;">${totalPct}%</div>
                    </div>
                    <div class="progress" style="height: 10px; border-radius: 10px; background-color: rgba(76, 175, 80, 0.1);">
                        <div class="progress-bar" role="progressbar" style="width: ${totalPct}%; background: linear-gradient(90deg, #66bb6a, #43a047); border-radius: 10px;" 
                             aria-valuenow="${totalPct}" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                    <div class="text-muted small mt-2" style="font-size: 0.75rem;">
                        ทำเสร็จแล้ว <b>${totalDone}</b> จากทั้งหมด <b>${totalTotal}</b> แปลงในโครงการนี้
                    </div>
                </div>
            `;
        }

        listEl.innerHTML = overallHtml + displayData.map(d => {
            const c = colorMap[d.assignee_name];
            const pct = d.pct || 0;
            const isMe = currentUser && d.assignee_name.toLowerCase().includes(currentUser.toLowerCase());
            const meBadge = isMe ? `<span class="tp-me-badge">คุณ</span>` : '';

            let tsStr = '';
            if (d.last_ts) {
                const dt = new Date(d.last_ts);
                tsStr = `<div class="tp-ts"><i class="bi bi-clock"></i> ${dt.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}น.</div>`;
            }

            let editorStr = '';
            if (d.last_editor) {
                editorStr = `<div class="tp-editor"><i class="bi bi-pencil-fill"></i> แก้ล่าสุดโดย <b>${d.last_editor}</b></div>`;
            }

            return `
            <div class="tp-block ${isMe ? 'tp-block-me' : ''}" style="--tp-color:${c};">
                <div class="tp-header">
                    ${d.assignee_photo ? `<img src="${d.assignee_photo}" class="tp-avatar" onerror="this.style.display='none'">` : `<div class="tp-avatar-placeholder" style="background:${c};">${d.assignee_name.charAt(0).toUpperCase()}</div>`}
                    <div class="tp-info">
                        <div class="tp-name">${d.assignee_name} ${meBadge}</div>
                        <div class="tp-range" style="color:${c};">ID ${d.id_from} – ${d.id_to} <span class="tp-total">(${d.total} รายการ)</span></div>
                    </div>
                    <div class="tp-pct" style="color:${c};">${pct}%</div>
                </div>
                <div class="tp-bar-bg">
                    <div class="tp-bar-fill" style="width:${pct}%; background:${c};"></div>
                </div>
                <div class="tp-sub">
                    <span class="tp-done-count">${d.done}/<b>${d.total}</b> แปลงเสร็จแล้ว</span>
                    ${editorStr}
                    ${tsStr}
                </div>
                ${d.note ? `<div class="tp-note"><i class="bi bi-info-circle"></i> ${d.note}</div>` : ''}
            </div>`;
        }).join('');
    } catch (e) {
        console.error('loadTaskProgress error:', e);
    }
}







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
                            id_farmer: item.id_farmer,
                            sqm_pacel: item.sqm_pacel || item.xls_sqm,
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
                            layer.bindPopup(`<b>Reshape</b><br>ID: ${feature.properties.id}<br>เลขลงทะเบียนเกษตรกร: ${feature.properties.id_farmer}`);
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

        // ── Load task assignment progress ──
        const view = urlParams.get('view');
        const assignee = urlParams.get('assignee');
        const loginUser = document.getElementById('display-name')?.textContent || '';
        const currentUser = (view === 'all') ? null : (assignee || loginUser);
        await loadTaskProgress(tb, currentUser);

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

            // Re-load progress with correct user identity after login
            const urlParams = new URLSearchParams(window.location.search);
            const tb = urlParams.get('tb');
            const view = urlParams.get('view');
            const assignee = urlParams.get('assignee');
            if (tb) {
                // If view=all, show everyone's progress. Otherwise prioritize assignee then own name.
                const currentUser = (view === 'all') ? null : (assignee || user.displayName);
                await loadTaskProgress(tb, currentUser);
            }

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

