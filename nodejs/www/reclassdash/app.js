// Initialize map and feature group
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
    "แปลงยาง": featureGroup.addTo(map),
    "แปลงยาง(เดิม)": rubber_parcel,
    "NDVI": ndvi,
    "NDVI gee": ndviTile,
    "NDWI gee": ndwiTile,
    "S2 gee": trueColorTile
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
        : feature.properties.classtype === 'non-rubber'
            ? '#d7191c'
            : feature.properties.classtype === 'other'
                ? '#ff00ff'
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
        const { data } = await response.json();

        const tableData = data.map(item => ({
            id: item.id,
            refinal: item.refinal,
            geom: JSON.parse(item.geom),
            app_no: item.app_no,
            shparea_sqm: item.shparea_sqm,
            shpsplit_sqm: item.shpsplit_sqm,
            classtype: item.classtype
        }));

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
                { data: 'app_no', title: 'Application No' },
                { data: 'id', title: 'id' },
                {
                    data: 'shparea_sqm',
                    title: 'เนื้อที่รวมของแปลงนี้ (m²)',
                    render: (data) => {
                        return Number(data).toFixed(0);
                    }
                },
                {
                    data: 'shpsplit_sqm',
                    title: 'เนื้อที่ส่วนนี้ (m²)',
                    render: (data) => {
                        return Number(data).toFixed(0);
                    }
                },
                {
                    data: 'classtype',
                    title: 'ประเภท',
                    render: (data) => {
                        return data === 'rubber' ? 'แปลงยาง' : data === 'building' ? 'อาคาร' : data === 'agriculture' ? 'เกษตรกรรม' : data === 'water' ? 'น้ำ' : 'อื่นๆ';
                    }
                },
            ],
            pageLength: 10,
            responsive: true,
            select: true,
            destroy: true,
            scrollX: true,
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

    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load spatial data');
    }
};

const legend = L.control({ position: 'bottomright' });

legend.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'legend'),
        categories = ['rubber', 'non-rubber', 'other'],
        labels = ['ยางพาราที่ลงทะเบียน', 'ไม่ใช่ยางพารา', 'ยางพาราที่ไม่ได้ลงทะเบียน'];

    for (let i = 0; i < categories.length; i++) {
        const dummy = { properties: { classtype: categories[i] } },
            style = getFeatureStyle(dummy);

        div.innerHTML +=
            `<i style="background:${style.fillColor};"></i> ${labels[i]}<br>`;
    }
    return div;
};

legend.addTo(map);

document.getElementById('reshape').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reshape/index.html?tb=' + tb;
})

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
        map.fitBounds(featureGroup.getBounds());

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
        const categories = raiData.map(r => {
            if (r.classtype == 'rubber') { return 'ยางพาราที่ลงทะเบียน'; }
            if (r.classtype == 'non-rubber') { return 'ไม่ใช่ยางพารา'; }
            if (r.classtype == 'other') { return 'ยางพาราที่ไม่ได้ลงทะเบียน'; }
            return 'ไม่ระบุ';
        });
        const dataRai = raiData.map(r => parseFloat(r.area_rai));
        Highcharts.chart('count-rai', {
            chart: { type: 'bar', height: 150, style: { fontFamily: 'Noto Sans Thai' } },
            title: { text: null },
            xAxis: { categories: categories, },
            yAxis: { min: 0, title: { text: 'เนื้อที่ (ไร่)' } },
            tooltip: { pointFormat: '<b>{point.y:.0f} ไร่</b>' },
            series: [{
                name: 'Area',
                data: dataRai,
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

