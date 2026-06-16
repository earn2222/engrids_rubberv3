// ── Global state ──
let _panelUserDirty = false;
let _autoSavingUserRemark = false;
let _activeFilter = '';
let _panelCheckerDirty = false;
const _checkerDraft = {};   // { [sub_id]: { check_shape, remark } }
let _userRole = null;
let _workerStatusFilter = 'all';
let _adminNavFilter = 'all';
let _highlightedLayers = [];
let _currentReviewId = null;
let _focusedLayer = null;      // { layer, originalStyle } — currently zoomed-to polygon
let _focusedSubId = null;

const _workerClassTypes = ['rubber', 'Other'];

const _getWorkerNavIds = (allRows) => {
    const allUniqueIds = [...new Set(allRows.map(r => String(r.id)))];
    return allUniqueIds.filter(id => {
        const subs = allRows.filter(r => String(r.id) === id && _workerClassTypes.includes(r.Classtype));
        if (subs.length === 0) return false;
        if (_workerStatusFilter === 'all') return true;
        const hasUnchecked = subs.some(r => !r.check_shape);
        const hasFail = subs.some(r => r.check_shape === 'ไม่ผ่าน');
        const hasPass = subs.some(r => r.check_shape === 'ผ่าน');

        if (_workerStatusFilter === 'remark') return subs.some(r => !!(r.remark || r.user_remark));
        if (_workerStatusFilter === 'unchecked') return hasUnchecked;
        if (_workerStatusFilter === 'fail') return !hasUnchecked && hasFail;
        if (_workerStatusFilter === 'pass') return !hasUnchecked && !hasFail && hasPass;
        return true;
    });
};

const _getAdminNavIds = (allRows) => {
    const allUniqueIds = [...new Set(allRows.map(r => String(r.id)))];
    return allUniqueIds.filter(id => {
        const subs = allRows.filter(r => String(r.id) === id && _workerClassTypes.includes(r.Classtype));
        if (subs.length === 0) return false;
        if (_adminNavFilter === 'all') return true;
        const hasUnchecked = subs.some(r => !r.check_shape);
        const hasFail = subs.some(r => r.check_shape === 'ไม่ผ่าน');
        const hasPass = subs.some(r => r.check_shape === 'ผ่าน');

        if (_adminNavFilter === 'remark') return subs.some(r => !!(r.remark || r.user_remark));
        if (_adminNavFilter === 'none') return hasUnchecked;
        if (_adminNavFilter === 'fail') return !hasUnchecked && hasFail;
        if (_adminNavFilter === 'pass') return !hasUnchecked && !hasFail && hasPass;
        return true;
    });
};

const _resetHighlights = () => {
    _highlightedLayers.forEach(({ layer, style }) => {
        try { layer.setStyle(style); } catch (_) { }
    });
    _highlightedLayers = [];
};

const _applyWorkerVisibility = () => {
    if (_userRole !== 'worker') return;
    document.querySelector('.checker-box')?.style.setProperty('display', 'none', 'important');
    // Hide the complex info panel (area cards, checker review, search nav)
    $('#featurePanelCollapse').closest('.card').hide();
    // Show the compact worker quick-access card instead
    $('#workerQuickCard').show();
    if ($.fn.DataTable.isDataTable('#featureTable')) {
        const dt = $('#featureTable').DataTable();
        dt.columns().every(function () {
            const title = this.header().textContent.trim();
            if (title === 'บันทึก' || title === 'ลบ') this.visible(false);
        });
        // Start with first parent ID so the list isn't overwhelmingly long
        const allRows = dt.rows().data().toArray();
        const firstId = allRows.length ? String(allRows[0].id) : null;
        buildWorkerPlotList(firstId);
        if (firstId) _currentReviewId = firstId;
    }
};

const _applyAdminVisibility = () => {
    if (_userRole !== 'admin') return;
    document.querySelector('.user-box')?.style.setProperty('display', 'none', 'important');
};

// Custom DataTable search filter for status buttons
$.fn.dataTable.ext.search.push(function (settings, data, dataIndex) {
    if (settings.nTable.id !== 'featureTable') return true;
    try {
        const rowData = settings.aoData[dataIndex]._aData;
        if (!rowData) return true;

        // Admin cannot see unclassified parcels at all
        if (_userRole === 'admin' && (!rowData.Classtype || rowData.Classtype.trim() === '')) {
            return false;
        }

        if (!_activeFilter) return true;

        switch (_activeFilter) {
            case 'none': return !rowData.check_shape;
            case 'pass': return rowData.check_shape === 'ผ่าน';
            case 'fail': return rowData.check_shape === 'ไม่ผ่าน';
            case 'remark': return !!(rowData.remark || rowData.user_remark);
            default: return true;
        }
    } catch (e) { return true; }
});

// Format remark text for popup: detect "1.xxx\n2.xxx" pattern → <ol>
function formatRemarkPopup(text) {
    if (!text || !text.trim()) return '<span class="text-muted">ไม่มีข้อมูล</span>';
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    // Multi-line numbered list: every line starts with "1." "2." etc.
    if (lines.length >= 2 && lines.every(l => /^\d+\./.test(l))) {
        const items = lines.map(l => `<li>${esc(l.replace(/^\d+\.\s*/, ''))}</li>`).join('');
        return `<ol class="mb-0 ps-4">${items}</ol>`;
    }
    // Single line with embedded numbers: split on "N." boundaries
    if (lines.length === 1 && /\d+\./.test(text)) {
        const parts = text.split(/(?=\d+\.)/).map(s => s.trim()).filter(s => /^\d+\./.test(s));
        if (parts.length >= 2) {
            const items = parts.map(s => `<li>${esc(s.replace(/^\d+\.\s*/, ''))}</li>`).join('');
            return `<ol class="mb-0 ps-4">${items}</ol>`;
        }
    }
    return lines.map(l => esc(l)).join('<br>');
}

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
    "แปลงยาง (reclass)": featureGroup.addTo(map),
    "แปลงยาง (reshape)": reshapeFeatureGroup,
    "Longdo Map": longdoLayer.addTo(map)
};

L.control.layers(baseLayers, overlayMaps).addTo(map);

// Helper to find layer on map
const findLayerBySubId = (subId) => {
    let found = null;
    featureGroup.eachLayer(layer => {
        // Handle GeoJson group structure
        if (typeof layer.eachLayer === 'function') {
            layer.eachLayer(subLayer => {
                if (subLayer.feature && subLayer.feature.properties && subLayer.feature.properties.sub_id == subId) {
                    found = subLayer;
                }
            });
        } else if (layer.feature && layer.feature.properties && layer.feature.properties.sub_id == subId) {
            found = layer;
        }
    });
    return found;
};

// Helper function to focus on a specific plot (Map + Panel + Table)
const focusPlot = (rowData) => {
    if (!rowData) return;

    const dt = $('#featureTable').DataTable();
    const subId = rowData.sub_id;

    // 1. Map: Zoom and Open Popup
    if (rowData.geom) {
        try {
            const tempLayer = L.geoJSON(rowData.geom);
            const bounds = tempLayer.getBounds();
            if (bounds.isValid()) {
                // Use flyToBounds for a smoother, more noticeable transition
                map.flyToBounds(bounds, {
                    padding: [50, 50],
                    maxZoom: 22,
                    duration: 1.0
                });

                // Ensure map is properly sized
                setTimeout(() => map.invalidateSize(), 500);
            }
        } catch (e) {
            console.error('Zoom error:', e);
        }
    }

    // Restore previous focused polygon (re-apply group dashed if it's still a sibling)
    if (_focusedLayer) {
        try {
            const prevLayer = _focusedLayer.layer;
            const prevOrigStyle = _focusedLayer.originalStyle;
            const inGroup = _highlightedLayers.some(h => h.layer === prevLayer);
            if (inGroup) {
                prevLayer.setStyle({ color: '#FF6600', fillColor: prevOrigStyle.fillColor, weight: 3, opacity: 1, fillOpacity: 0.45, dashArray: '5,3' });
            } else {
                prevLayer.setStyle(prevOrigStyle);
            }
        } catch (_) { }
        _focusedLayer = null;
        _focusedSubId = null;
    }

    // 2. Info Panel: Populate data (admin: triggers group-highlight for all subs of same parent)
    showFeaturePanel({ properties: rowData });

    // Apply solid focused highlight ON TOP of group-highlight — must come after showFeaturePanel
    const layer = findLayerBySubId(subId);
    if (layer && typeof layer.setStyle === 'function') {
        const originalStyle = getFeatureStyle({ properties: rowData });
        _focusedLayer = { layer, originalStyle };
        _focusedSubId = subId;
        layer.setStyle({
            color: '#FF6600',
            fillColor: originalStyle.fillColor,
            weight: 6,
            opacity: 1,
            fillOpacity: 0.75,
            dashArray: null
        });
    }

    // 3. DataTable: Highlight selected row
    const rowNode = dt.row((idx, d) => String(d.sub_id) === String(subId)).node();
    if (rowNode) {
        $(rowNode).addClass('selected').siblings().removeClass('selected');
    }

    // 4. Worker quick list: show only this parent ID's items
    if (_userRole === 'worker') {
        buildWorkerPlotList(rowData.id);
        $('.worker-plot-item').removeClass('active');
        const $item = $(`.worker-plot-item[data-subid="${subId}"]`);
        $item.addClass('active');
        $item[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        _updateWorkerSelectedBanner(rowData);
    }
};

// ── Shared color/label maps for worker panel ──
const _workerColorMap = {
    'rubber': '#006d2c', 'Other': '#ff0004'
};
const _workerLabelMap = {
    'rubber': 'ยางพาราที่ลงทะเบียน',
    'Other': 'ไม่ใช่ยางพารา'
};

// Update the selected-plot banner in the worker quick panel
const _updateWorkerSelectedBanner = (rowData) => {
    const color = _workerColorMap[rowData.Classtype] || '#90a4ae';
    const label = _workerLabelMap[rowData.Classtype] || 'อื่นๆ';
    $('#worker-sel-dot').css('background', color);
    $('#worker-sel-subid').text(`#${rowData.sub_id}`);
    $('#worker-sel-id').text(`ID: ${rowData.id}`);
    $('#worker-sel-Classtype').html(`<span style="color:${color}; font-weight:700;">${label}</span>`);
    $('#worker-sel-remark').val(rowData.user_remark || '');
    $('#worker-sel-save').data('subid', String(rowData.sub_id));
    $('#worker-selected-info').show();

    // Track current parent ID for prev/next navigation
    _currentReviewId = String(rowData.id || '');

    // Update nav counter (filtered by current status filter)
    if ($.fn.DataTable.isDataTable('#featureTable')) {
        const dt = $('#featureTable').DataTable();
        const uniqueIds = _getWorkerNavIds(dt.rows().data().toArray());
        const idx = uniqueIds.indexOf(_currentReviewId);
        $('#worker-nav-count').text(`${idx >= 0 ? idx + 1 : '-'} / ${uniqueIds.length}`);
    }
};

// Update only the area info cards (left + right) without rebuilding the checker box
const _updateAreaCards = (rowData) => {
    if (!rowData) return;

    const labelMapFull = {
        'rubber': 'ยางพาราที่ลงทะเบียน',
        'Other': 'ไม่ใช่ยางพารา'
    };
    const colorMapFull = {
        'rubber': '#006d2c', 'Other': '#ff0004'
    };
    const rdLabel = labelMapFull[rowData.Classtype] || 'อื่นๆ';
    const rdColor = colorMapFull[rowData.Classtype] || '#6c757d';



    // Classtype badge
    $('#display-Classtype').html(`<span class="Classtype-badge w-100 text-center" style="background:${rdColor}15; color:#000; border:1px solid ${rdColor}40; font-weight: 500;">${rdLabel}</span>`);
};

// Build compact scrollable plot list for workers (called after DataTable init + auth)
// filterId: if provided, only show sub-plots belonging to that parent ID
const buildWorkerPlotList = (filterId = null) => {
    if (!$.fn.DataTable.isDataTable('#featureTable')) return;
    const dt = $('#featureTable').DataTable();
    const allRows = dt.rows().data().toArray();
    if (!allRows.length) {
        $('#workerPlotList').html('<div class="text-muted small text-center py-3"><i class="bi bi-inbox"></i> ไม่พบแปลง</div>');
        return;
    }
    // Counts = number of unique parent IDs in each status (always global, not per-ID)
    const allUniqueIds = [...new Set(allRows.map(r => String(r.id)))];
    const getSubsOf = id => allRows.filter(r => String(r.id) === id);
    
    let cntUnchecked = 0, cntPass = 0, cntFail = 0, cntRemark = 0;
    allUniqueIds.forEach(id => {
        const subs = getSubsOf(id).filter(r => _workerClassTypes.includes(r.Classtype));
        if (subs.length === 0) return;
        if (subs.some(r => r.remark || r.user_remark)) cntRemark++;

        const hasUnchecked = subs.some(r => !r.check_shape);
        if (hasUnchecked) {
            cntUnchecked++;
        } else if (subs.some(r => r.check_shape === 'ไม่ผ่าน')) {
            cntFail++;
        } else {
            cntPass++;
        }
    });

    $('#wfc-pass').text(cntPass);
    $('#wfc-fail').text(cntFail);
    $('#wfc-remark').text(cntRemark);
    $('#wfc-unchecked').text(cntUnchecked);

    // 1. Get filtered parent IDs based on _workerStatusFilter
    const filteredParentIds = _getWorkerNavIds(allRows);

    // 2. We want to show ALL sub-plots for any valid parent ID
    const validRows = allRows.filter(r => filteredParentIds.includes(String(r.id)));

    // 3. If `filterId` is provided (slider is locked), only show rows for that parent ID
    const displayRows = filterId ? validRows.filter(r => String(r.id) === String(filterId)) : validRows;

    // 4. Apply ID search filter from input
    const idSearch = ($('#worker-id-search').val() || '').trim();
    const finalRows = idSearch ? displayRows.filter(r => String(r.id).includes(idSearch)) : displayRows;

    // Build single item HTML
    const buildItem = row => {
        const color = _workerColorMap[row.Classtype] || '#90a4ae';
        const label = _workerLabelMap[row.Classtype] || 'อื่นๆ';
        const cs = row.check_shape || '';
        let verdictHtml;
        if (cs === 'ผ่าน') {
            verdictHtml = `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;background:#d1fae5;color:#065f46;font-size:0.72rem;font-weight:700;border:1.5px solid #6ee7b7;white-space:nowrap;"><i class="bi bi-check-circle-fill"></i> ผ่าน</span>`;
        } else if (cs === 'ไม่ผ่าน') {
            verdictHtml = `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:0.72rem;font-weight:700;border:1.5px solid #fca5a5;white-space:nowrap;"><i class="bi bi-x-circle-fill"></i> ไม่ผ่าน</span>`;
        } else {
            verdictHtml = `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;background:#fef9c3;color:#854d0e;font-size:0.72rem;font-weight:700;border:1.5px solid #fde047;white-space:nowrap;"><i class="bi bi-hourglass-split"></i> รอตรวจ</span>`;
        }
        const noteTag = row.user_remark ? `<span style="font-size:0.65rem;color:#1d4ed8;"><i class="bi bi-chat-dots-fill"></i></span>` : '';
        const notePreview = row.user_remark
            ? `<div class="worker-plot-note"><i class="bi bi-chat-dots-fill" style="font-size:0.65rem;"></i> ${row.user_remark.substring(0, 20)}${row.user_remark.length > 20 ? '…' : ''}</div>`
            : '';
        return `<div class="worker-plot-item" data-subid="${row.sub_id}" data-id="${row.id}">
            <div class="worker-class-dot" style="background:${color};"></div>
            <div class="worker-plot-info">
                <div class="worker-plot-ids"><span class="text-primary fw-bold">#${row.sub_id}</span> ${noteTag}</div>
                <div class="worker-plot-class">${label}</div>
                ${notePreview}
            </div>
            <div class="ms-auto ps-2">${verdictHtml}</div>
        </div>`;
    };

    // Always group by parent ID so headers are visible in all filter modes
    const showGrouped = true;
    let html;
    if (showGrouped) {
        const groups = {};
        finalRows.forEach(row => {
            const key = String(row.id);
            if (!groups[key]) groups[key] = [];
            groups[key].push(row);
        });
        html = Object.entries(groups).map(([id, rows]) => {
            const status = getIdStatus(allRows, id);
            let badgeHtml = '';
            if (status === 'fail') badgeHtml = '<span class="badge bg-danger ms-auto" style="font-size:0.65rem;"><i class="bi bi-x-circle"></i> ไม่ผ่าน</span>';
            else if (status === 'pass') badgeHtml = '<span class="badge bg-success ms-auto" style="font-size:0.65rem;"><i class="bi bi-check-circle"></i> ผ่าน</span>';
            else badgeHtml = '<span class="badge bg-secondary ms-auto" style="font-size:0.65rem;"><i class="bi bi-hourglass-split"></i> ยังไม่ตรวจ</span>';
            
            return `<div class="worker-id-group">
                <div class="worker-id-group-header d-flex align-items-center">
                    <div>
                        <i class="bi bi-folder2-open me-1"></i>ID: ${id}
                        <span class="ms-1" style="font-size:0.68rem;opacity:0.75;">(${rows.length} แปลง)</span>
                    </div>
                    ${badgeHtml}
                </div>
                ${rows.map(buildItem).join('')}
            </div>`;
        }).join('');
    } else {
        html = finalRows.map(buildItem).join('');
    }

    const emptyMsg = _workerStatusFilter === 'unchecked'
        ? (filterId && cntUnchecked > 0
            ? '<div class="text-muted small text-center py-3"><i class="bi bi-inbox"></i> ไม่มีรายการรอตรวจใน ID นี้</div>'
            : '<div class="text-muted small text-center py-3"><i class="bi bi-check2-all text-success"></i> ตรวจครบแล้ว!</div>')
        : _workerStatusFilter === 'pass'
            ? '<div class="text-muted small text-center py-3"><i class="bi bi-inbox"></i> ยังไม่มีที่ผ่าน</div>'
            : _workerStatusFilter === 'fail'
                ? '<div class="text-muted small text-center py-3"><i class="bi bi-emoji-smile text-success"></i> ไม่มีรายการไม่ผ่าน!</div>'
                : '<div class="text-muted small text-center py-3">ไม่พบแปลงใน ID นี้</div>';

    $('#workerPlotList').html(html || emptyMsg);

    // Update nav counter: filtered unique IDs based on current status filter
    const uniqueIds = _getWorkerNavIds(allRows);
    const countId = filterId || _currentReviewId;
    if (countId) {
        const idx = uniqueIds.indexOf(String(countId));
        $('#worker-nav-count').text(`${idx >= 0 ? idx + 1 : '-'} / ${uniqueIds.length}`);
    } else {
        $('#worker-nav-count').text(`- / ${uniqueIds.length}`);
    }
    $('#workerNavBar').css('display', 'flex');
};

// Auto-save user remark before navigating away (prevents text disappearing)
const autoSaveUserRemark = async () => {
    const subId = $('#panel-sub-id').val();
    const tb = $('#tb').val();
    if (!subId || !_panelUserDirty || _autoSavingUserRemark) return;

    const userRemark = $('#panel-user-remark').val();
    const displayName = document.getElementById('display-name')?.textContent || '';

    _autoSavingUserRemark = true;
    try {
        const res = await fetch(`/rub3/api/update_user_remark/${tb}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sub_id: subId, user_remark: userRemark })
        });
        const data = await res.json();
        if (data.success) {
            const updatedTs = data.data && data.data[0] ? data.data[0].user_remark_ts : new Date().toISOString();
            const dt = $('#featureTable').DataTable();
            const tableRow = dt.row((idx, d) => d.sub_id == subId);
            if (tableRow.any()) {
                const rowData = tableRow.data();
                rowData.user_remark = userRemark;
                rowData.user_remark_ts = updatedTs;
                tableRow.data(rowData).draw(false);
            }
            _panelUserDirty = false;
            $('#user-dirty-badge').hide();
        }
    } catch (e) {
        console.error('Auto-save user remark error:', e);
    } finally {
        _autoSavingUserRemark = false;
    }
};

// ── Admin status helpers ──
const getIdStatus = (allRows, id) => {
    const subs = allRows.filter(r => String(r.id) === String(id));
    if (!subs.length) return 'none';
    const hasUnchecked = subs.some(r => !r.check_shape);
    if (hasUnchecked) return 'none';
    const hasFail = subs.some(r => r.check_shape === 'ไม่ผ่าน');
    if (hasFail) return 'fail';
    return 'pass';
};

const updateAdminStatusCounts = () => {
    if (!$.fn.DataTable.isDataTable('#featureTable')) return;
    const allRows = $('#featureTable').DataTable().rows().data().toArray();
    
    // Group rows by unique ID
    const uniqueIds = [...new Set(allRows.map(r => String(r.id)))];
    
    let cntNone = 0, cntPass = 0, cntFail = 0, cntRemark = 0;
    
    const workerTypes = ['rubber', 'Other'];
    uniqueIds.forEach(id => {
        const subs = allRows.filter(r => String(r.id) === id && workerTypes.includes(r.Classtype));
        if (subs.length === 0) return; // No worker-classified subs yet, skip admin count
        
        if (subs.some(r => r.remark || r.user_remark)) cntRemark++;
        
        const hasUnchecked = subs.some(r => !r.check_shape);
        if (hasUnchecked) {
            cntNone++;
        } else if (subs.some(r => r.check_shape === 'ไม่ผ่าน')) {
            cntFail++;
        } else {
            cntPass++;
        }
    });
    
    $('#asc-none').text(cntNone);
    $('#asc-pass').text(cntPass);
    $('#asc-fail').text(cntFail);
    $('#asc-remark').text(cntRemark);
};

// Helper to navigate between plots (Prev/Next) — by unique parent ID
const navigatePlots = async (direction) => {
    if (_panelUserDirty) await autoSaveUserRemark();

    const dt = $('#featureTable').DataTable();
    const allRows = dt.rows({ search: 'applied' }).data().toArray();
    const allUniqueIds = [...new Set(allRows.map(r => String(r.id)))];

    // Apply nav filter: worker uses _workerStatusFilter, admin uses _adminNavFilter
    const uniqueIds = _userRole === 'worker'
        ? _getWorkerNavIds(allRows)
        : _getAdminNavIds(allRows);

    const currentIdIdx = _currentReviewId
        ? uniqueIds.indexOf(String(_currentReviewId))
        : -1;

    const nextIdx = currentIdIdx + direction;
    if (nextIdx >= 0 && nextIdx < uniqueIds.length) {
        const nextId = uniqueIds[nextIdx];
        const firstRow = allRows.find(r => String(r.id) === nextId);
        if (firstRow) {
            _currentReviewId = null;
            focusPlot(firstRow);
        }
    }
};


const showFeaturePanel = (feature, layer) => {
    const props = feature.properties;

    // Basic Info
    $('#display-id-num').text(props.id || '-');
    $('#display-id').text(`ID: ${props.id || '-'}`);
    $('#id').val(props.id || '');
    $('#display-farmer-id').text(props.id_farmer || '-');
    $('#panel-sub-id').val(props.sub_id || '');

    // Overall Status Badge
    if ($.fn.DataTable.isDataTable('#featureTable')) {
        const allRows = $('#featureTable').DataTable().rows().data().toArray();
        const status = getIdStatus(allRows, props.id);
        const $statusBadge = $('#display-id-status');
        $statusBadge.removeClass('d-none bg-success bg-danger bg-warning bg-secondary');
        if (status === 'fail') {
            $statusBadge.addClass('bg-danger').html('<i class="bi bi-x-circle"></i> ไม่ผ่าน');
        } else if (status === 'pass') {
            $statusBadge.addClass('bg-success').html('<i class="bi bi-check-circle"></i> ผ่าน');
        } else {
            $statusBadge.addClass('bg-secondary').html('<i class="bi bi-hourglass-split"></i> ยังไม่ตรวจ');
        }
    }

    // Area land (sqm_rechac = current area)
    const currLandSqm = Number(props.current_sqm || 0);
    $('#curr-land-sqm').text(currLandSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 }));

    // Area class (shpsplit_sqm = current class area)
    const currAreaSqm = Number(props.shpsplit_sqm || 0);
    $('#curr-area-sqm').text(currAreaSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 }));
    $('#rubber-current-row').removeClass('d-none');

    // Classtype Label & Color
    const labelMap = {
        'rubber': 'ยางพาราที่ลงทะเบียน',
        'Other': 'ไม่ใช่ยางพารา'
    };
    const colorMap = {
        'rubber': '#006d2c', 'Other': '#ff0004'
    };
    const label = labelMap[props.Classtype] || 'อื่นๆ';
    const color = colorMap[props.Classtype] || '#6c757d';

    if (props.Classtype !== 'rubber' && props.Classtype) {
        $('#display-other-type').text(label).removeClass('outline-muted');
        // If it's something excluded, we might want a different style but let's keep it simple
    } else {
        $('#display-other-type').text('N/A').addClass('outline-muted');
    }

    // Classtype Badge
    $('#display-Classtype').html(`<span class="Classtype-badge w-100 text-center" style="background:${color}15; color:#000; border:1px solid ${color}40; font-weight: 500;">${label}</span>`);


    // ── User remark ──
    $('#panel-user-remark').val(props.user_remark || '');
    _panelUserDirty = false;
    $('#user-dirty-badge').hide();

    // ── Checker: ID-grouped review panel ──
    if (_userRole !== 'worker') {
        const parentId = String(props.id || '');
        if (parentId && parentId !== _currentReviewId) {
            _currentReviewId = parentId;
            _resetHighlights();

            const dt = $('#featureTable').DataTable();
            const allSubs = dt.rows().data().toArray().filter(r => String(r.id) === parentId);

            // Highlight all sub_ids of this parent ID (no auto-zoom when clicking polygon on map)
            allSubs.forEach(r => {
                const lyr = findLayerBySubId(r.sub_id);
                if (lyr && typeof lyr.setStyle === 'function') {
                    const orig = getFeatureStyle({ properties: r });
                    _highlightedLayers.push({ layer: lyr, style: orig });
                    // Yellow dashed border for group highlight (all subs of same parent ID)
                    lyr.setStyle({ color: '#FFD600', fillColor: orig.fillColor, weight: 3, opacity: 1, fillOpacity: 0.45, dashArray: '5,3' });
                }
            });

            // Build sub_id rows
            const labelMap = {
                'rubber': 'ยางพารา', 'Other': 'ไม่ใช่ยาง'
            };
            const colorMap = {
                'rubber': '#006d2c', 'Other': '#ff0004'
            };

            const mkOpts = (val) => ['', 'ผ่าน', 'ไม่ผ่าน'].map(v =>
                `<option value="${v}" ${val === v ? 'selected' : ''}>${v === '' ? '-- เลือก --' : v === 'ผ่าน' ? '✅ ผ่าน' : '❌ ไม่ผ่าน'}</option>`
            ).join('');

            // Per-sub check_shape rows
            const shapeRowsHtml = allSubs.map(r => {
                const label = labelMap[r.Classtype] || r.Classtype || '?';
                const color = colorMap[r.Classtype] || '#666';
                const cs = r.check_shape || '';
                const rowClass = cs === 'ผ่าน' ? 'is-pass' : cs === 'ไม่ผ่าน' ? 'is-fail' : '';
                return `<div class="sub-review-row ${rowClass}" data-subid="${r.sub_id}">
                    <div class="sub-row-header">
                        <span class="sub-id-tag">#${r.sub_id}</span>
                        <span class="sub-class-pill" style="background:${color}18;color:${color};border:1px solid ${color}40;">${label}</span>
                    </div>
                    <select class="form-select form-select-sm sub-check-shape mt-1">${mkOpts(cs)}</select>
                </div>`;
            }).join('');

            $('#id-sub-list').html(allSubs.length ? `
                <div class="check-section">
                    <div class="check-section-title">ตรวจสอบประเภท</div>
                    <div class="shape-sub-list">${shapeRowsHtml}</div>
                </div>
            ` : '<div class="text-muted small text-center py-2">ไม่พบ sub_id</div>');


            // Last saved info
            const lastReviewer = allSubs.find(r => r.reviewer)?.reviewer || null;
            const lastTs = allSubs.map(r => r.review_ts).filter(Boolean).sort().reverse()[0] || null;
            if (lastReviewer || lastTs) {
                $('#id-reviewer-name').text(lastReviewer || '-');
                if (lastTs) {
                    const d = new Date(lastTs);
                    $('#id-review-time').text(d.toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.');
                } else {
                    $('#id-review-time').text('');
                }
            } else {
                $('#id-reviewer-name').text('ยังไม่มีการบันทึก');
                $('#id-review-time').text('');
            }

            // Keep remark from clicked sub (shared field)
            $('#id-checker-remark').val(props.remark || '');

            $('#id-batch-actions').css('display', 'flex');
            $('#id-remark-section').show();
            $('#btn-save-id-review').show();
        }
    }

    // ── User: "บันทึกล่าสุด" footer ──
    if (props.user_remark || props.user_remark_ts) {
        $('#panel-user-info').show();
        $('#panel-user-name').hide();
        if (props.user_remark_ts) {
            const d = new Date(props.user_remark_ts);
            $('#panel-user-time').text(d.toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.');
        } else {
            $('#panel-user-time').text('');
        }
    } else {
        $('#panel-user-info').show();
        $('#panel-user-name').hide();
        $('#panel-user-time').text('');
    }

    // ── Status summary badge ──
    const cs = props.check_shape || '';
    let statusHtml = '';
    if (!cs) {
        statusHtml = '<span class="badge bg-secondary" style="font-size:0.7rem;">⏳ ยังไม่ตรวจ</span>';
    } else if (cs === 'ผ่าน') {
        statusHtml = '<span class="badge bg-success" style="font-size:0.7rem;">✅ ผ่าน</span>';
    } else {
        statusHtml = '<span class="badge bg-danger" style="font-size:0.7rem;">❌ ไม่ผ่าน</span>';
    }

    // ✅ Navigation Update (Counter)
    try {
        const dt = $('#featureTable').DataTable();
        const allRows = dt.rows({ search: 'applied' }).data().toArray();
        const uniqueIds = _userRole === 'worker' ? _getWorkerNavIds(allRows) : _getAdminNavIds(allRows);
        const currentIdIdx = uniqueIds.indexOf(String(props.id));
        if (currentIdIdx !== -1) {
            $('#plot-nav-count').text(`${currentIdIdx + 1} / ${uniqueIds.length}`);
        } else {
            $('#plot-nav-count').text(`- / ${uniqueIds.length}`);
        }
    } catch (e) {
        console.warn('DataTable not ready for counter');
    }
}

const getFeatureStyle = (feature) => {
    const color = feature.properties.Classtype === 'rubber'
        ? '#006d2c'
        : feature.properties.Classtype === 'Other'
            ? '#ff0004ff'
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
    layer.on('click', () => {
        // Restore previous focused polygon style
        if (_focusedLayer) {
            try { _focusedLayer.layer.setStyle(_focusedLayer.originalStyle); } catch (_) { }
            _focusedLayer = null;
            _focusedSubId = null;
        }

        _currentReviewId = null;

        // Use full rowData from DataTable so deed_sqm / current_sqm / rubr_sqm are populated
        const _clickedSubId = feature.properties.sub_id;
        let _fullFeature = feature;
        if ($.fn.DataTable.isDataTable('#featureTable')) {
            const _dtRow = $('#featureTable').DataTable().rows().data().toArray()
                .find(r => String(r.sub_id) === String(_clickedSubId));
            if (_dtRow) _fullFeature = { properties: _dtRow };
        }
        showFeaturePanel(_fullFeature, layer);
        selectedLayer = layer;

        // Highlight the matching sub-review-row in checker box
        $('#id-sub-list .sub-review-row').removeClass('active-sub');
        const $activeSubRow = $(`#id-sub-list .sub-review-row[data-subid="${_clickedSubId}"]`);
        $activeSubRow.addClass('active-sub');
        $activeSubRow[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Highlight clicked polygon with bright border + stronger fill
        if (typeof layer.setStyle === 'function') {
            const originalStyle = getFeatureStyle(feature);
            _focusedLayer = { layer, originalStyle };
            _focusedSubId = feature.properties.sub_id;
            layer.setStyle({
                color: '#FFD600',
                fillColor: originalStyle.fillColor,
                weight: 5,
                opacity: 1,
                fillOpacity: 0.75,
                dashArray: null
            });
        }

        // Sync worker quick list: filter to this ID, highlight item, load banner
        if (_userRole === 'worker') {
            const subId = feature.properties.sub_id;
            const dt = $('#featureTable').DataTable();
            const rowData = dt.rows().data().toArray().find(r => String(r.sub_id) === String(subId));
            if (rowData) {
                buildWorkerPlotList(rowData.id);
                $('.worker-plot-item').removeClass('active');
                const $item = $(`.worker-plot-item[data-subid="${subId}"]`);
                $item.addClass('active');
                $item[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                _updateWorkerSelectedBanner(rowData);
            }
        }
    });
};

const loadGeoData = async () => {
    try {
        const tb = document.getElementById('tb').value;
        const response = await fetch(`/rub3/api/getreclassfeatures/${tb}`);
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
            data = data.filter(item => item.id >= id_from && item.id <= id_to);
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
            geom: JSON.parse(item.geom),
            id_farmer: item.farmer_id || '',
            name: item.name || '',
            surname: item.surname || '',
            old_year: item.old_year || '',
            sqm_rechac: item.sqm_rechac || 0,
            rai_rechac: item.rai_rechac || 0,
            current_sqm: item.sqm_rechac || item.shpsplit_sqm || 0,
            shpsplit_sqm: item.shpsplit_sqm,
            Class_Area: item['Class_Area'] || (item.shpsplit_sqm / 1600),
            Classtype: item.Classtype,
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
            initComplete: function () { _applyWorkerVisibility(); _applyAdminVisibility(); updateAdminStatusCounts(); },
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

                        let reclassUrl = `./../reclass/index.html?tb=${document.getElementById('tb').value}&id=${row.id}`;
                        if (id_from && id_to && assignee) {
                            reclassUrl += `&id_from=${id_from}&id_to=${id_to}&assignee=${encodeURIComponent(assignee)}`;
                        }

                        return `<a class="btn btn-success btn-sm map-btn"
                                    data-refid="${row.id}"
                                    data-subid="${row.sub_id}"
                                    data-geojson='${_geojson}'
                                    href="#"><i class="bi bi-zoom-in"></i> ซูม</a>
                                <a class="btn btn-warning btn-sm mt-1" 
                                    href="${reclassUrl}"
                                    ><i class="bi bi-pencil-square"></i> แก้ไข</a>`
                    }
                },
                { data: 'id', title: 'ID' },
                {
                    data: 'name',
                    title: 'ชื่อ',
                    render: (data) => data ? `<span title="${data}">${data}</span>` : '<span class="text-muted">-</span>'
                },
                {
                    data: 'surname',
                    title: 'นามสกุล',
                    render: (data) => data ? `<span title="${data}">${data}</span>` : '<span class="text-muted">-</span>'
                },
                { data: 'id_farmer', title: 'เลขเกษตรกร' },
                {
                    data: 'old_year',
                    title: 'อายุ (ปี)',
                    render: (data) => data ? `<b>${data}</b>` : '<span class="text-muted">-</span>'
                },
                {
                    data: 'shpsplit_sqm',
                    title: 'เนื้อที่ขณะนี้ตารางเมตร',
                    render: (data) => `<span class="area-num">${Number(data || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}</span>`
                },
                {
                    data: 'Class_Area',
                    title: 'เนื้อที่ขณะนี้ไร่',
                    render: (data) => `<span class="area-num">${Number(data || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}</span>`
                },
                {
                    data: 'Classtype',
                    title: 'ประเภท',
                    render: (data) => {
                        const colorMap = {
                            'rubber': '#006d2c', 'Other': '#ff0004'
                        };
                        const labelMap = {
                            'rubber': 'ยางพารา', 'Other': 'ไม่ใช่ยาง'
                        };
                        if (!data) return '<span class="text-muted">-</span>';
                        const color = colorMap[data] || '#6c757d';
                        const label = labelMap[data] || data;
                        return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;background:${color}22;color:${color};border:1px solid ${color}55;font-size:0.8rem;font-weight:600;white-space:nowrap;">${label}</span>`;
                    }
                },
                {
                    data: 'check_shape',
                    title: 'ตรวจสอบคลาส',
                    render: (data, type, row) => {
                        const cs = data || '';
                        if (_userRole === 'admin') {
                            return `<select class="form-select form-select-sm check-shape" style="font-size:0.8rem;">
                                        <option value="" ${cs === '' ? 'selected' : ''}>-- เลือก --</option>
                                        <option value="ผ่าน" ${cs === 'ผ่าน' ? 'selected' : ''}>✅ ผ่าน</option>
                                        <option value="ไม่ผ่าน" ${cs === 'ไม่ผ่าน' ? 'selected' : ''}>❌ ไม่ผ่าน</option>
                                    </select>`;
                        } else {
                            if (!cs) return _workerClassTypes.includes(row.Classtype)
                                ? '<span class="text-muted" style="font-size:0.75rem;">⏳ รอตรวจ</span>'
                                : '<span class="text-muted" style="font-size:0.75rem;">-</span>';
                            const csIcon = cs === 'ผ่าน' ? '✅' : cs === 'ไม่ผ่าน' ? '❌' : '—';
                            return `<div style="font-size:0.78rem;line-height:1.7;white-space:nowrap;">ตรวจ: ${csIcon} ${cs}</div>`;
                        }
                    }
                },
                {
                    data: 'remark',
                    title: 'หมายเหตุผู้เช็ก',
                    render: (data, type, row) => {
                        const remarkVal = data || '';
                        if (_userRole === 'admin') {
                            return `
                                <div class="input-group input-group-sm">
                                    <input type="text" class="form-control review-remark" value="${remarkVal.replace(/"/g, '&quot;')}" placeholder="ระบุเหตุผล...">
                                    <button class="btn btn-outline-primary btn-save-review" type="button" data-subid="${row.sub_id}" title="บันทึกผลการตรวจ">
                                        <i class="bi bi-floppy"></i>
                                    </button>
                                </div>
                            `;
                        } else {
                            if (!remarkVal) return '<span class="text-muted">-</span>';
                            const preview = remarkVal.length > 22 ? remarkVal.substring(0, 22) + '…' : remarkVal;
                            return `<span class="btn-note-popup" data-subid="${row.sub_id}" data-type="checker" style="cursor:pointer;color:#1d4ed8;font-size:0.8rem;" title="คลิกเพื่อดูข้อความเต็ม"><i class="bi bi-chat-left-text-fill me-1"></i>${preview}</span>`;
                        }
                    }
                },
                {
                    data: 'reviewer',
                    title: 'ผู้ตรวจสอบ',
                    render: (data, type, row) => {
                        let dateStr = '';
                        if (row.review_ts) {
                            const date = new Date(row.review_ts);
                            const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                            dateStr = `<div class="text-muted mt-1" style="font-size: 0.75rem;"><i class="bi bi-clock"></i> ${date.toLocaleDateString('th-TH', options)}น.</div>`;
                        }
                        if (!data) return '<span class="text-muted">-</span>' + dateStr;
                        return `<span class="badge bg-success bg-opacity-75">${data}</span>` + dateStr;
                    }
                },
                {
                    data: 'user_remark',
                    title: 'หมายเหตุผู้ใช้',
                    width: '150px',
                    render: function (data, type, row) {
                        let dateStr = '';
                        if (row.user_remark_ts) {
                            const date = new Date(row.user_remark_ts);
                            const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                            dateStr = `<div class="text-muted mt-1 user-remark-time" style="font-size: 0.75rem;"><i class="bi bi-clock"></i> ${date.toLocaleDateString('th-TH', options)}น.</div>`;
                        }
                        const remarkVal = data || '';
                        return `
                            <div class="input-group input-group-sm">
                                <input type="text" class="form-control user-remark" value="${remarkVal.replace(/"/g, '&quot;')}" placeholder="ระบุหมายเหตุ...">
                                <button class="btn btn-outline-info btn-view-user-remark" type="button" data-subid="${row.sub_id}" title="ดูหมายเหตุเต็ม" ${!remarkVal ? 'style="display:none;"' : ''}>
                                    <i class="bi bi-chat-text"></i>
                                </button>
                                <button class="btn btn-outline-danger btn-clear-user-remark" type="button" data-subid="${row.sub_id}" title="ลบหมายเหตุ" ${!remarkVal ? 'style="display:none;"' : ''}>
                                    <i class="bi bi-trash3"></i>
                                </button>
                                <button class="btn btn-outline-success btn-save-user-remark" type="button" data-subid="${row.sub_id}" title="บันทึกหมายเหตุ">
                                    <i class="bi bi-floppy"></i>
                                </button>
                            </div>
                            ${dateStr}
                        `;
                    }
                },
                {
                    data: null,
                    title: 'ประวัติ',
                    orderable: false,
                    render: (data, type, row) => {
                        return `<button class="btn btn-sm btn-review-history" data-id="${row.id}" style="font-size:0.75rem;padding:3px 10px;background:linear-gradient(135deg,#26c6da,#00acc1);color:#fff;border:none;border-radius:8px;white-space:nowrap;"><i class="bi bi-clock-history me-1"></i>ประวัติ</button>`;
                    }
                },
            ],
            pageLength: 10,
            order: [[1, 'asc']],
            select: true,
            destroy: true,
            createdRow: function (row, data) {
                if (data.check_shape === 'ผ่าน') {
                    $(row).addClass('row-checked-pass');
                } else if (data.check_shape === 'ไม่ผ่าน') {
                    $(row).addClass('row-checked-fail');
                }
            }
        });

        // ── Filter status buttons ──
        $(document).off('click.filterBtn').on('click.filterBtn', '.btn-filter-status', function () {
            $('.btn-filter-status').removeClass('active');
            $(this).addClass('active');
            _activeFilter = $(this).data('filter');
            dataTable.draw();
        });

        // ── Dirty tracking for user remark textarea ──
        $('#panel-user-remark').off('input.dirty').on('input.dirty', function () {
            _panelUserDirty = true;
            $('#user-dirty-badge').show();
        });

        // ── Batch pass / fail all sub_ids of current ID ──
        $('#btn-batch-pass, #btn-batch-fail').on('click', function () {
            const val = $(this).is('#btn-batch-pass') ? 'ผ่าน' : 'ไม่ผ่าน';
            $('#id-sub-list .sub-review-row').each(function () {
                $(this).find('.sub-check-shape').val(val);
                $(this).removeClass('is-pass is-fail is-partial');
                $(this).addClass(val === 'ผ่าน' ? 'is-pass' : 'is-fail');
            });
        });

        // ── Click sub_id row → zoom to polygon + update area cards ──
        $('#id-sub-list').on('click', '.sub-review-row', function (e) {
            if ($(e.target).is('select')) return;
            const subId = String($(this).data('subid'));
            const dt = $('#featureTable').DataTable();
            const rowData = dt.rows().data().toArray().find(r => String(r.sub_id) === subId);
            if (!rowData) return;

            // Restore previous focused polygon (re-apply group dashed if still a sibling)
            if (_focusedLayer) {
                try {
                    const prevLayer = _focusedLayer.layer;
                    const prevOrigStyle = _focusedLayer.originalStyle;
                    const inGroup = _highlightedLayers.some(h => h.layer === prevLayer);
                    if (inGroup) {
                        prevLayer.setStyle({ color: '#FFD600', fillColor: prevOrigStyle.fillColor, weight: 3, opacity: 1, fillOpacity: 0.45, dashArray: '5,3' });
                    } else {
                        prevLayer.setStyle(prevOrigStyle);
                    }
                } catch (_) { }
                _focusedLayer = null;
                _focusedSubId = null;
            }

            // Zoom to this polygon
            if (rowData.geom) {
                try {
                    const b = L.geoJSON(rowData.geom).getBounds();
                    if (b.isValid()) map.flyToBounds(b, { padding: [50, 50], maxZoom: 22, duration: 0.6 });
                } catch (_) { }
            }

            // Apply solid focused highlight and track it
            const lyr = findLayerBySubId(subId);
            if (lyr && typeof lyr.setStyle === 'function') {
                const origStyle = getFeatureStyle({ properties: rowData });
                _focusedLayer = { layer: lyr, originalStyle: origStyle };
                _focusedSubId = subId;
                lyr.setStyle({ color: '#FF6600', fillColor: origStyle.fillColor, weight: 6, opacity: 1, fillOpacity: 0.75, dashArray: null });
            }

            // Update area info cards to reflect this sub_id's Classtype + area
            _updateAreaCards(rowData);

            // Mark active row
            $('#id-sub-list .sub-review-row').removeClass('active-sub');
            $(this).addClass('active-sub');
        });

        // ── Update row highlight when check_shape changes ──
        $('#id-sub-list').on('change', '.sub-check-shape', function () {
            const row = $(this).closest('.sub-review-row');
            const cs = $(this).val();
            row.removeClass('is-pass is-fail');
            if (cs === 'ผ่าน') row.addClass('is-pass');
            else if (cs === 'ไม่ผ่าน') row.addClass('is-fail');
        });

        // ── Save all sub_ids of current ID ──
        $('#btn-save-id-review').on('click', async function () {
            const tb = $('#tb').val();
            const remark = $('#id-checker-remark').val();
            const displayName = document.getElementById('display-name')?.textContent || '';
            const rows = $('#id-sub-list .sub-review-row');
            if (!rows.length) { alert('กรุณาเลือกแปลงก่อน'); return; }

            const btn = $(this);
            btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i> กำลังบันทึก...');

            const saves = [];
            rows.each(function () {
                const subId = $(this).data('subid');
                const checkShape = $(this).find('.sub-check-shape').val();
                saves.push(fetch(`/rub3/api/update_review/${tb}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sub_id: subId, check_shape: checkShape, remark, reviewer: displayName })
                }).then(r => r.json()).then(data => ({ subId, checkShape, data })));
            });

            try {
                const results = await Promise.all(saves);
                const dataTable = $('#featureTable').DataTable();
                let allOk = true;

                // For rejected sub_ids, also clear user_remark
                const clearSaves = [];
                results.forEach(({ subId, checkShape, data }) => {
                    if (!data.success) { allOk = false; return; }
                    const isRejected = checkShape === 'ไม่ผ่าน';
                    if (isRejected) {
                        clearSaves.push(
                            fetch(`/rub3/api/update_user_remark/${tb}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sub_id: subId, user_remark: '' })
                            }).then(r => r.json()).then(() => subId).catch(() => subId)
                        );
                    }
                });
                if (clearSaves.length) await Promise.all(clearSaves);

                results.forEach(({ subId, checkShape, data }) => {
                    if (!data.success) return;
                    const isRejected = checkShape === 'ไม่ผ่าน';
                    const tableRow = dataTable.row((idx, d) => String(d.sub_id) === String(subId));
                    if (tableRow.any()) {
                        const rd = tableRow.data();
                        rd.check_shape = checkShape;
                        rd.remark = remark; rd.reviewer = displayName;
                        rd.review_ts = data.data?.[0]?.review_ts || new Date().toISOString();
                        if (isRejected) {
                            rd.user_remark = '';
                            rd.user_remark_ts = '';
                        }
                        tableRow.data(rd).draw(false);
                        const node = tableRow.node();
                        if (node) {
                            $(node).removeClass('row-checked-pass row-checked-fail');
                            if (checkShape === 'ผ่าน') $(node).addClass('row-checked-pass');
                            else if (isRejected) $(node).addClass('row-checked-fail');
                        }
                    }
                });

                // Update saved-by footer
                const now = new Date();
                $('#id-reviewer-name').text(displayName || '-');
                $('#id-review-time').text(now.toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.');

                updateAdminStatusCounts();
                btn.html('<i class="bi bi-check-circle-fill"></i> บันทึกแล้ว').removeClass('btn-success').addClass('btn-primary');
                setTimeout(() => btn.html('<i class="bi bi-floppy-fill me-1"></i> บันทึกผลการตรวจ').removeClass('btn-primary').addClass('btn-success').prop('disabled', false), 2000);

                if (!allOk) alert('บางรายการบันทึกไม่สำเร็จ');
            } catch (err) {
                console.error('Save ID review error:', err);
                alert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
                btn.prop('disabled', false).html('<i class="bi bi-floppy-fill me-1"></i> บันทึกผลการตรวจ');
            }
        });

        // Panel Save User Remark Button Handler
        $('#panel-btn-save-user').on('click', async function () {
            const subId = $('#panel-sub-id').val();
            const tb = $('#tb').val();
            if (!subId) { alert('กรุณาเลือกข้อมูลก่อน'); return; }

            const btn = $(this);
            const userRemark = $('#panel-user-remark').val();
            const displayName = document.getElementById('display-name')?.textContent || '';

            btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i> กำลังบันทึก...');

            try {
                const res = await fetch(`/rub3/api/update_user_remark/${tb}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sub_id: subId,
                        user_remark: userRemark
                    })
                });

                const data = await res.json();
                if (data.success) {
                    btn.html('<i class="bi bi-check-circle-fill"></i> เรียบร้อย');
                    _panelUserDirty = false;
                    $('#user-dirty-badge').hide();

                    const dataTable = $('#featureTable').DataTable();
                    const tableRow = dataTable.row((idx, d) => d.sub_id == subId);

                    if (tableRow.any()) {
                        const rowData = tableRow.data();
                        rowData.user_remark = userRemark;
                        rowData.user_remark_ts = data.data && data.data[0] ? data.data[0].user_remark_ts : new Date().toISOString();
                        tableRow.data(rowData).draw(false);
                        // Re-populate panel but preserve dirty=false
                        showFeaturePanel({ properties: rowData });
                    }

                    setTimeout(() => {
                        btn.html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุผู้ใช้').prop('disabled', false);
                    }, 2000);
                } else {
                    alert('บันทึกไม่สำเร็จ: ' + (data.error || 'Unknown error'));
                    btn.prop('disabled', false).html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุผู้ใช้');
                }
            } catch (err) {
                console.error('User Remark Save Error:', err);
                alert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
                btn.prop('disabled', false).html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุผู้ใช้');
            }
        });



        // Panel Clear User Remark Button Handler
        $('#panel-btn-clear-user').on('click', function () {
            const subId = $('#panel-sub-id').val();
            if (!subId) { alert('กรุณาเลือกข้อมูลก่อน'); return; }
            if (confirm('ยืนยันลบหมายเหตุผู้ใช้ ใช่หรือไม่?')) {
                $('#panel-user-remark').val('');
                $('#panel-btn-save-user').click();
            }
        });

        // Sync Table Selection to Panel (auto-save user remark if dirty before switching)
        $('#featureTable tbody').on('click', 'tr', async function () {
            if (_panelUserDirty) await autoSaveUserRemark();
            const data = $('#featureTable').DataTable().row(this).data();
            if (data) {
                // Reset ID cache so new click always refreshes the panel
                _currentReviewId = null;
                showFeaturePanel({ properties: data });
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


        // ✅ Search Panel Plot
        $('#btn-panel-search').on('click', function () {
            const val = $('#search-plot-id').val().trim();
            if (!val) return;

            const dt = $('#featureTable').DataTable();
            // Try specific ID search
            let foundData = dt.rows().data().toArray().find(r => r.id == val || r.sub_id == val || r.id_farmer == val);

            if (foundData) {
                const layer = findLayerBySubId(foundData.sub_id);
                if (layer) {
                    if (typeof layer.getBounds === 'function' && layer.getBounds().isValid()) {
                        map.fitBounds(layer.getBounds(), { padding: [50, 50] });
                    } else if (typeof layer.getLatLng === 'function') {
                        map.setView(layer.getLatLng(), 19);
                    }
                    showFeaturePanel({ properties: foundData });
                }
            } else {
                // Generic search
                dt.search(val).draw();
                const firstResult = dt.rows({ search: 'applied' }).data()[0];
                if (firstResult) {
                    const layer = findLayerBySubId(firstResult.sub_id);
                    if (layer) {
                        if (typeof layer.getBounds === 'function' && layer.getBounds().isValid()) {
                            map.fitBounds(layer.getBounds(), { padding: [50, 50] });
                        } else if (typeof layer.getLatLng === 'function') {
                            map.setView(layer.getLatLng(), 19);
                        }
                        showFeaturePanel({ properties: firstResult });
                    }
                    // Highlight first result
                    const rowNode = dt.row((idx, d) => d.sub_id == firstResult.sub_id).node();
                    if (rowNode) {
                        rowNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        $(rowNode).addClass('selected').siblings().removeClass('selected');
                    }
                } else {
                    alert('ไม่พบข้อมูลแปลงที่ระบุ');
                }
            }
        });

        $('#search-plot-id').on('keypress', function (e) {
            if (e.which == 13) $('#btn-panel-search').click();
        });

        // ✅ Prev/Next Buttons
        $('#btn-plot-prev').on('click', () => navigatePlots(-1));
        $('#btn-plot-next').on('click', () => navigatePlots(1));
        $('#plot-nav-count').css('cursor', 'pointer').on('click', () => {
            if (!_currentReviewId) return;
            const dt = $('#featureTable').DataTable();
            const rowData = dt.rows().data().toArray().find(r => String(r.id) === String(_currentReviewId));
            if (rowData) { _currentReviewId = null; focusPlot(rowData); }
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
                        sub_id: row.sub_id,
                        id_farmer: row.id_farmer,
                        shpsplit_sqm: row.shpsplit_sqm,
                        Classtype: row.Classtype,
                        check_shape: row.check_shape,
                        remark: row.remark,
                        user_remark: row.user_remark,
                        reviewer: row.reviewer,
                        review_ts: row.review_ts,
                        user_remark_ts: row.user_remark_ts
                    }
                };

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
            e.stopPropagation();
            const subId = String($(this).data('subid'));
            const dt = $('#featureTable').DataTable();
            const rowData = dt.rows().data().toArray().find(r => String(r.sub_id) === subId);
            if (rowData) {
                _currentReviewId = null;
                focusPlot(rowData);
                // Mark the clicked sub_id as active in the checker box
                $('#id-sub-list .sub-review-row').removeClass('active-sub');
                const $activeRow = $(`#id-sub-list .sub-review-row[data-subid="${subId}"]`);
                $activeRow.addClass('active-sub');
                $activeRow[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });

        dataTable.rows().every(function () {
            const rowData = this.data();
            $(this.node()).attr('id', `row_${rowData.id}`);
        });

        // Review history button handler
        $('#featureTable tbody').on('click', '.btn-review-history', async function (e) {
            e.stopPropagation();
            const id = $(this).data('id');
            const tb = document.getElementById('tb').value;

            document.getElementById('history-plot-id').textContent = id;
            const body = document.getElementById('history-modal-body');
            body.innerHTML = '<div class="text-center py-3"><span class="spinner-border spinner-border-sm"></span> กำลังโหลด...</div>';

            const modal = new bootstrap.Modal(document.getElementById('reviewHistoryModal'));
            modal.show();

            const reasonLabels = {
                'restore': '🔄 คืนค่าแปลง',
                'reshape': '✏️ ปรับรูปแปลง',
                'manual_clear': '🗑️ ล้างข้อมูล',
                'update_landuse': '🏷️ อัปเดตประเภท',
                'update_geometry': '📐 อัปเดตรูปทรง',
                'split': '✂️ ตัดแบ่งแปลง',
                'unsplit': '🔗 ยกเลิกการตัด — คืนเป็นแปลงเดิม'
            };

            try {
                const res = await fetch(`/rub3/api/review_history/${tb}/${id}`);
                const data = await res.json();

                if (!data.success || data.data.length === 0) {
                    body.innerHTML = `<div class="text-center py-5 text-muted">
                        <i class="bi bi-inbox fs-2"></i>
                        <div class="mt-2">ไม่มีประวัติการตรวจสอบสำหรับแปลง ID: ${id}</div>
                        <div class="small mt-1">ประวัติจะถูกบันทึกเมื่อมีการปรับรูปแปลงหรือรีเซตข้อมูล</div>
                    </div>`;
                    return;
                }

                const rows = data.data.map(h => {
                    const resetTs = h.reset_ts ? new Date(h.reset_ts).toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + 'น.' : '-';
                    const reviewTs = h.review_ts ? new Date(h.review_ts).toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + 'น.' : '-';
                    const csClass = h.check_shape === 'ผ่าน' ? 'text-success fw-bold' : h.check_shape === 'ไม่ผ่าน' ? 'text-danger fw-bold' : 'text-muted';
                    const reason = reasonLabels[h.reset_reason] || (h.reset_reason || '-');
                    return `<tr>
                        <td class="small text-muted text-nowrap">${resetTs}</td>
                        <td><span class="badge bg-secondary">${reason}</span></td>
                        <td class="small">${h.sub_id || '-'}</td>
                        <td class="${csClass}">${h.check_shape || '<span class="text-muted">-</span>'}</td>
                        <td class="small">${h.remark
                            ? `<span class="history-remark-cell"
                                    data-remark="${h.remark.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"
                                    title="คลิกเพื่อดูทั้งหมด">
                                    <span class="history-remark-preview">${h.remark.replace(/</g, '&lt;')}</span>
                                    <i class="bi bi-arrows-angle-expand history-remark-icon"></i>
                               </span>`
                            : '<span class="text-muted">-</span>'}</td>
                        <td class="small">${h.reviewer || '<span class="text-muted">-</span>'}</td>
                        <td class="small text-muted text-nowrap">${reviewTs}</td>
                    </tr>`;
                }).join('');

                body.innerHTML = `
                    <div class="table-responsive">
                        <table class="table table-sm table-striped table-bordered align-middle">
                            <thead class="table-info">
                                <tr>
                                    <th>รีเซตเมื่อ</th>
                                    <th>สาเหตุ</th>
                                    <th>Sub ID</th>
                                    <th>ตรวจประเภท</th>
                                    <th>หมายเหตุ</th>
                                    <th>ผู้ตรวจ</th>
                                    <th>เวลาตรวจ</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                    <div class="text-muted small mt-1"><i class="bi bi-info-circle"></i> แสดงล่าสุดก่อน · ${data.data.length} รายการ</div>`;
            } catch (err) {
                body.innerHTML = `<div class="text-danger p-3">โหลดไม่ได้: ${err.message}</div>`;
            }
        });

        // History remark cell → popup (delegated on the modal body)
        document.getElementById('history-modal-body').addEventListener('click', function (e) {
            const cell = e.target.closest('.history-remark-cell');
            if (!cell) return;
            const raw = cell.getAttribute('data-remark')
                .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<');
            document.getElementById('notePopupTitle').innerHTML =
                '<i class="bi bi-chat-text me-1"></i>หมายเหตุ — ประวัติการตรวจสอบ';
            document.getElementById('notePopupBody').innerHTML = formatRemarkPopup(raw);
            // raise z-index so popup sits above the history modal
            const noteEl = document.getElementById('notePopupModal');
            noteEl.style.zIndex = 1065;
            const noteModal = bootstrap.Modal.getOrCreateInstance(noteEl);
            noteModal.show();
        });

        // Note popup handler — show full remark text formatted in modal
        $('#featureTable tbody').on('click', '.btn-note-popup', function () {
            const subId = $(this).data('subid');
            const type = $(this).data('type');
            const dt = $('#featureTable').DataTable();
            const rowData = dt.rows().data().toArray().find(r => String(r.sub_id) === String(subId));
            if (!rowData) return;
            const text = type === 'checker' ? rowData.remark : rowData.user_remark;
            const title = type === 'checker' ? '<i class="bi bi-shield-check me-1"></i>หมายเหตุผู้เช็ค' : '<i class="bi bi-chat-dots-fill me-1"></i>หมายเหตุผู้ใช้';
            $('#notePopupTitle').html(title);
            $('#notePopupBody').html(formatRemarkPopup(text));
            const modal = new bootstrap.Modal(document.getElementById('notePopupModal'));
            modal.show();
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
                const res = await fetch(`/rub3/api/update_user_remark/${tb}`, {
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
                    const displayName = document.getElementById('display-name')?.textContent || '';

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
                        cellDiv.find('.btn-view-user-remark').show();
                        cellDiv.find('.btn-view-user-remark').attr('data-remark', userRemark);
                    } else {
                        cellDiv.find('.btn-clear-user-remark').hide();
                        cellDiv.find('.btn-view-user-remark').hide();
                    }

                    // Sync side panel if this row is currently shown
                    const panelSubId = $('#panel-sub-id').val();
                    if (String(panelSubId) === String(subId)) {
                        $('#panel-user-remark').val(userRemark);
                        if (updatedTs) {
                            const d2 = new Date(updatedTs);
                            const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                            $('#panel-user-time').text(d2.toLocaleString('th-TH', opts) + ' น.');
                            $('#panel-user-info').show();
                        }
                        if (displayName) $('#panel-user-name').text(displayName);
                        _panelUserDirty = false;
                        $('#user-dirty-badge').hide();
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

        // View user remark handler (Popup)
        $('#featureTable tbody').on('click', '.btn-view-user-remark', function () {
            const row = $(this).closest('tr');
            const userRemark = row.find('.user-remark').val();
            if (!userRemark) return;
            const title = '<i class="bi bi-chat-dots-fill me-1"></i>หมายเหตุผู้ใช้';
            $('#notePopupTitle').html(title);
            // Replace newlines with <br> and format for display
            const formatted = userRemark.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
            $('#notePopupBody').html('<div style="font-size:0.95rem; line-height:1.6;">' + formatted + '</div>');
            const modal = new bootstrap.Modal(document.getElementById('notePopupModal'));
            modal.show();
        });

        // Save review handler
        $('#featureTable tbody').on('click', '.btn-save-review', async function () {
            const btn = $(this);
            const subId = btn.data('subid');
            const row = btn.closest('tr');
            const checkShape = row.find('.check-shape').val();
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
            const originalCheckShape = rowData.check_shape || '';
            const originalRemark = rowData.remark || '';

            const isReviewChanged = (checkShape !== originalCheckShape) ||
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
                const res = await fetch(`/rub3/api/update_review/${tb}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sub_id: subId,
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

                    // If rejected → clear user_remark so worker must write a fresh note
                    const isRejected = checkShape === 'ไม่ผ่าน';
                    if (isRejected) {
                        try {
                            await fetch(`/rub3/api/update_user_remark/${tb}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sub_id: subId, user_remark: '' })
                            });
                        } catch (_) { }
                    }

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

                    // Update internal DataTable data
                    rowData.check_shape = checkShape;
                    rowData.remark = remark;
                    rowData.reviewer = reviewerToSave;
                    rowData.review_ts = updatedTs;
                    if (isRejected) {
                        rowData.user_remark = '';
                        rowData.user_remark_ts = '';
                        // Clear the input in the table row visually
                        row.find('.user-remark').val('');
                        row.find('.user-remark-time').remove();
                        row.find('.btn-clear-user-remark').hide();
                    } else {
                        rowData.user_remark = userRemark;
                    }
                    dataTable.row(row).data(rowData);

                    // Update row color based on new check status
                    $(row).removeClass('row-checked-pass row-checked-fail');
                    if (checkArea === 'ผ่าน' && checkShape === 'ผ่าน') $(row).addClass('row-checked-pass');
                    else if (isRejected) $(row).addClass('row-checked-fail');

                    // Sync panel if this row is shown
                    const panelSubId = $('#panel-sub-id').val();
                    if (String(panelSubId) === String(subId)) {
                        showFeaturePanel({ properties: rowData });
                    }

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
                const res = await fetch(`/rub3/api/delete_reclass_feature/${tb}/${subId}`, {
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
        alert('Failed to load spatial data: ' + (error.message || error));
    }
};

const legend = L.control({ position: 'bottomright' });

legend.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'legend'),
        categories = ['rubber', 'Other'],
        labels = [
            'ยางพาราที่ลงทะเบียน',
            'ไม่ใช่ยางพารา',
            'ขอบเขต Reshape'
        ];

    // Add Reshape legend item first
    div.innerHTML += `<i style="background:#2196F3; width:14px; height:14px; display:inline-block; margin-right:6px; opacity:0.8; border:1px solid #1565C0"></i> ขอบเขต Reshape<br>`;


    for (let i = 0; i < categories.length; i++) {
        const dummy = { properties: { Classtype: categories[i] } },
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
        const res = await fetch(`/rub3/api/task-progress/${tb}`);
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
        // If user has no assigned tasks, fall back to showing all (admin/supervisor view)
        let displayData = data;
        let isPersonalView = false;
        if (currentUser) {
            const myData = data.filter(d =>
                d.assignee_name.toLowerCase().includes(currentUser.toLowerCase())
            );
            if (myData.length > 0) {
                displayData = myData;
                isPersonalView = true;
            }
            // else: currentUser has no assignments → show all (fall through)
        }

        let overallHtml = '';
        if ((!currentUser || !isPersonalView) && data.length > 0) {
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

        // Invalidate map size so it fills its container
        setTimeout(() => {
            map.invalidateSize();
            if ($.fn.DataTable.isDataTable('#featureTable')) {
                $('#featureTable').DataTable().columns.adjust();
            }
        }, 200);


        // Load reshape polygon data as overlay layer
        try {
            const reshapeRes = await fetch('/rub3/api/getreshapefeatures/' + tb);
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
                            Farmer_ID: item['Farmer_ID']
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
                            layer.bindPopup(`<b>Reshape</b><br>ID: ${feature.properties.id}<br>เลขลงทะเบียนเกษตรกร: ${feature.properties['Farmer_ID']}`);
                        }
                    }).addTo(reshapeFeatureGroup);
                });
            }
        } catch (reshapeErr) {
            console.error('Error loading reshape data:', reshapeErr);
        }

        const response = await fetch('/rub3/api/countsfeatures/' + tb);
        const data = await response.json();

        const chartData = [
            { name: 'จำนวนทั้งหมด', y: parseInt(data.total), color: '#7cb5ec' },
            { name: 'ปรับแก้เนื้อที่แล้ว', y: parseInt(data.reshp), color: '#434348' },
            { name: 'Classified แล้ว', y: parseInt(data.reclass), color: '#90ed7d' }
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

        const raiFetch = await fetch('/rub3/api/countsrai/reclass_' + tb);
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
            if (r.Classtype === 'rubber') cat = 'ยางพาราที่ลงทะเบียน';
            else if (r.Classtype === 'Other') cat = 'ไม่ใช่ยางพารา';

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



// ── Worker quick panel: delete (clear) remark for selected plot ──
$(document).on('click', '#worker-sel-delete', async function () {
    const subId = String($('#worker-sel-save').data('subid'));
    const tb = $('#tb').val();
    if (!subId || subId === 'undefined') return;
    if (!confirm('ลบหมายเหตุสำหรับแปลงนี้?')) return;

    const displayName = document.getElementById('display-name')?.textContent || '';
    const btn = $(this);
    btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i>');

    try {
        const res = await fetch(`/rub3/api/update_user_remark/${tb}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sub_id: subId, user_remark: '' })
        });
        const data = await res.json();
        if (data.success) {
            $('#worker-sel-remark').val('');
            // Update DataTable row
            if ($.fn.DataTable.isDataTable('#featureTable')) {
                const dt = $('#featureTable').DataTable();
                const tableRow = dt.row((idx, d) => String(d.sub_id) === subId);
                if (tableRow.any()) {
                    const rd = tableRow.data();
                    rd.user_remark = ''; rd.user_remark_ts = '';
                    tableRow.data(rd).draw(false);
                }
            }
            // Remove note preview from worker list item
            $(`.worker-plot-item[data-subid="${subId}"] .worker-plot-note`).remove();
        }
    } catch (e) { console.error(e); }
    finally { btn.prop('disabled', false).html('<i class="bi bi-trash3-fill"></i>'); }
});

// ── Worker quick panel: prev / next ID navigation ──
$(document).on('click', '#btn-worker-prev', () => navigatePlots(-1));
$(document).on('click', '#btn-worker-next', () => navigatePlots(1));

// ── Admin status filter cards ──
$(document).on('click', '#adminStatusBar .admin-status-card', function () {
    if ($(this).hasClass('active')) {
        _adminNavFilter = 'all';
        $(this).removeClass('active');
    } else {
        _adminNavFilter = $(this).data('status');
        $('#adminStatusBar .admin-status-card').removeClass('active');
        $(this).addClass('active');
    }
    // Update nav counter to reflect filtered IDs
    if ($.fn.DataTable.isDataTable('#featureTable')) {
        const allRows = $('#featureTable').DataTable().rows({ search: 'applied' }).data().toArray();
        const filtered = _getAdminNavIds(allRows);
        
        // Auto-jump to the first valid ID if the current one is no longer in the filtered list
        if (_currentReviewId && !filtered.includes(String(_currentReviewId))) {
            if (filtered.length > 0) {
                const firstRow = allRows.find(r => String(r.id) === filtered[0]);
                _currentReviewId = null; // force update
                focusPlot(firstRow);
                return; // focusPlot handles updating the nav counter
            } else {
                _currentReviewId = null;
            }
        }
        
        const currentIdx = _currentReviewId ? filtered.indexOf(String(_currentReviewId)) : -1;
        $('#plot-nav-count').text(`${currentIdx >= 0 ? currentIdx + 1 : '-'} / ${filtered.length}`);
    }
});

// ── Worker status filter tabs ──
$(document).on('click', '#workerStatusFilter .worker-status-card', function () {
    if ($(this).hasClass('active')) {
        _workerStatusFilter = 'all';
        $(this).removeClass('active');
    } else {
        _workerStatusFilter = $(this).data('filter');
        $('#workerStatusFilter .worker-status-card').removeClass('active');
        $(this).addClass('active');
    }
    
    // Auto-jump to the first ID in this filter if the current ID is no longer valid
    if ($.fn.DataTable.isDataTable('#featureTable')) {
        const dt = $('#featureTable').DataTable();
        const allRows = dt.rows({ search: 'applied' }).data().toArray();
        const validIds = _getWorkerNavIds(allRows);
        
        if (_currentReviewId && !validIds.includes(String(_currentReviewId))) {
            if (validIds.length > 0) {
                const firstRow = allRows.find(r => String(r.id) === validIds[0]);
                _currentReviewId = null; // force update in focusPlot
                focusPlot(firstRow);
                return; // focusPlot will call buildWorkerPlotList
            } else {
                _currentReviewId = null; // clear selection if list is empty
            }
        }
    }
    
    // filter ภายใน ID ที่เลือกอยู่เสมอ (ถ้ายังไม่เลือก ID จึงแสดงทั้งหมด)
    buildWorkerPlotList(_currentReviewId || null);
});

// ── Worker ID search input ──
$(document).on('input', '#worker-id-search', function () {
    const searchVal = $(this).val().trim();
    // ค้นหาข้ามทุก ID เมื่อพิมพ์, กลับ ID ปัจจุบันเมื่อล้าง
    buildWorkerPlotList(searchVal ? null : (_currentReviewId || null));
});

// ── Worker quick panel: click plot item → zoom + highlight + load banner ──
$(document).on('click', '.worker-plot-item', function () {
    const subId = String($(this).data('subid'));
    if (!$.fn.DataTable.isDataTable('#featureTable')) return;
    const dt = $('#featureTable').DataTable();
    const rowData = dt.rows().data().toArray().find(r => String(r.sub_id) === subId);
    if (!rowData) return;
    _currentReviewId = String(rowData.id);
    focusPlot(rowData);
});

// ── Worker quick panel: save remark for currently selected plot ──
$(document).on('click', '#worker-sel-save', async function () {
    const subId = String($(this).data('subid'));
    const tb = $('#tb').val();
    if (!subId || subId === 'undefined') { alert('กรุณาเลือกแปลงก่อน'); return; }
    const remark = $('#worker-sel-remark').val();
    const displayName = document.getElementById('display-name')?.textContent || '';
    const btn = $(this);
    btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i> กำลังบันทึก...');
    try {
        const res = await fetch(`/rub3/api/update_user_remark/${tb}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sub_id: subId, user_remark: remark })
        });
        const data = await res.json();
        if (data.success) {
            const updatedTs = data.data?.[0]?.user_remark_ts || new Date().toISOString();
            // Update DataTable row
            if ($.fn.DataTable.isDataTable('#featureTable')) {
                const dt = $('#featureTable').DataTable();
                const tableRow = dt.row((idx, d) => String(d.sub_id) === subId);
                if (tableRow.any()) {
                    const rd = tableRow.data();
                    rd.user_remark = remark; rd.user_remark_ts = updatedTs;
                    tableRow.data(rd).draw(false);
                }
            }
            // Update note preview in the worker list item
            const $item = $(`.worker-plot-item[data-subid="${subId}"]`);
            const $noteDiv = $item.find('.worker-plot-note');
            const preview = remark ? remark.substring(0, 25) + (remark.length > 25 ? '…' : '') : '';
            if (preview && $noteDiv.length) {
                $noteDiv.html(`<i class="bi bi-chat-dots-fill" style="font-size:0.65rem;"></i> ${preview}`);
            } else if (preview) {
                $item.find('.worker-plot-info').append(
                    `<div class="worker-plot-note"><i class="bi bi-chat-dots-fill" style="font-size:0.65rem;"></i> ${preview}</div>`
                );
            } else {
                $noteDiv.remove();
            }
            btn.html('<i class="bi bi-check-circle-fill"></i> บันทึกแล้ว!');
            setTimeout(() => btn.html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุ').prop('disabled', false), 2000);
        } else {
            alert('บันทึกไม่สำเร็จ'); btn.prop('disabled', false).html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุ');
        }
    } catch (e) {
        console.error(e);
        btn.prop('disabled', false).html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุ');
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/rub3/auth/me');
        const { user } = await res.json();
        // console.log(user);

        if (user) {
            // Show profile section
            document.getElementById('google-login-link').style.display = 'none';
            document.getElementById('profile-section').style.display = 'flex';
            const profileImg = document.getElementById('profile-image');
            profileImg.referrerPolicy = "no-referrer";
            profileImg.src = user.photo;
            profileImg.onerror = function () {
                this.onerror = null;
                this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=E9F5EC&color=2e7d32&rounded=true`;
            };
            document.getElementById('display-name').textContent = user.displayName;

            _userRole = user.role || 'worker';
            await loadGeoData();
            if (featureGroup.getLayers().length > 0) {
                map.fitBounds(featureGroup.getBounds());
            }
            _applyWorkerVisibility();
            _applyAdminVisibility();

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
                    await fetch('/rub3/auth/logout');
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

