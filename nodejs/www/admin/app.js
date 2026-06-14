/* ================================================================
   Admin App  –  Two-step project workflow
   1) "สร้าง Project" → create empty table (no upload)
   2) "เพิ่มข้อมูล"   → upload shapefile (polygon / point) to existing table
   3) "มอบหมายงาน"  → assign ID ranges to team members
================================================================ */

const ROLE_LABELS = { admin: 'Admin', worker: 'Worker' };
const ROLE_COLORS = { admin: 'danger', worker: 'success' };

/* ── Initialise logged-in users list with role management ── */
const initUser = async () => {
    try {
        const response = await fetch(`/rub/api/users`);
        const result = await response.json();

        const usersDiv = document.getElementById('usersList');
        usersDiv.innerHTML = '';

        result.forEach(item => {
            const panel = document.createElement('div');
            panel.className = 'alert alert-success d-flex align-items-center justify-content-between mb-2 py-2';

            const leftDiv = document.createElement('div');
            leftDiv.className = 'd-flex align-items-center gap-2';

            const img = document.createElement('img');
            img.className = 'rounded-circle';
            img.style = 'width: 32px; height: 32px; object-fit: cover; flex-shrink: 0;';
            img.referrerPolicy = "no-referrer";
            img.src = item.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.display_name)}&background=E9F5EC&color=2e7d32&rounded=true`;
            img.onerror = function() {
                this.onerror = null;
                this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.display_name)}&background=E9F5EC&color=2e7d32&rounded=true`;
            };

            const infoDiv = document.createElement('div');
            infoDiv.innerHTML = `
                <div class="fw-bold" style="font-size:0.85rem;">${item.display_name}</div>
                <div class="text-muted" style="font-size:0.72rem;">${item.email || ''}</div>
            `;

            leftDiv.appendChild(img);
            leftDiv.appendChild(infoDiv);

            const roleSelect = document.createElement('select');
            roleSelect.className = `form-select form-select-sm role-select`;
            roleSelect.style = 'width: auto; font-size: 0.75rem;';
            roleSelect.dataset.userId = item.id;
            ['worker', 'admin'].forEach(r => {
                const opt = document.createElement('option');
                opt.value = r;
                opt.textContent = ROLE_LABELS[r];
                if (item.role === r) opt.selected = true;
                roleSelect.appendChild(opt);
            });
            roleSelect.addEventListener('change', async function() {
                const newRole = this.value;
                try {
                    const res = await fetch(`/rub/api/users/${item.id}/role`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ role: newRole })
                    });
                    const data = await res.json();
                    if (!data.success) { alert('เปลี่ยน role ไม่สำเร็จ'); this.value = item.role; }
                    else item.role = newRole;
                } catch (e) { alert('เกิดข้อผิดพลาด'); this.value = item.role; }
            });

            panel.appendChild(leftDiv);
            panel.appendChild(roleSelect);
            usersDiv.appendChild(panel);
        });
    } catch (error) {
        console.error('Error initializing users:', error);
    }
};

/* ── Highcharts bar for feature counts ── */
const showChart = async (tb, div) => {
    try {
        const response = await fetch('/rub/api/countsfeatures/' + tb);
        const data = await response.json();

        const chartData = [
            { name: 'จำนวนทั้งหมด', y: parseInt(data.total), color: '#7cb5ec' },
            { name: 'ปรับแก้เนื้อที่แล้ว', y: parseInt(data.reshp), color: '#434348' },
            { name: 'Classified แล้ว', y: parseInt(data.reclass), color: '#90ed7d' }
        ];

        Highcharts.chart('chart_' + div, {
            chart: { type: 'bar', height: 150, style: { fontFamily: 'Noto Sans Thai' } },
            title: { text: null },
            xAxis: { type: 'category' },
            yAxis: { min: 0, title: { text: 'จำนวน (แปลง)', style: { fontFamily: 'Noto Sans Thai' } } },
            series: [{ name: 'Counts', data: chartData, dataLabels: { enabled: true, format: '{y}' } }],
            tooltip: { pointFormat: '<b>{point.y}</b> แปลง' },
            credits: { enabled: false },
            legend: { enabled: false }
        });
    } catch (error) {
        console.error('Error showing chart:', error);
    }
};

const existingLayerNames = new Set();

/* ── Render the layer list ── */
const initApp = async () => {
    try {
        const response = await fetch('/rub/api/layerlist');
        const result = await response.json();
        existingLayerNames.clear();
        result.forEach(item => existingLayerNames.add(item.tb_name.toLowerCase()));

        const layerList = document.getElementById('layerList');
        layerList.innerHTML = '';

        const promises = result.map(async (item, index) => {
            const { tb_name } = item;
            const wrapper = document.createElement('div');
            wrapper.innerHTML = `
                <div class="alert alert-dismissible alert-info mb-3">
                    <strong id="layerTitle_${tb_name.toLowerCase()}" style="font-size: 1.1rem;">${index + 1}. Layer: ${tb_name}</strong>
                    <button class="btn btn-link btn-sm p-0 ms-2 renameBtn" data-tb="${tb_name}" title="แก้ไขชื่อโปรเจค" style="color:#555;">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                    <div class="layer-actions mt-2">
                        <button class="btn btn-add-data layer-btn addDataBtn" data-tb="${tb_name}">
                            <i class="bi bi-upload me-1"></i>เพิ่มข้อมูล
                        </button>
                        <button class="btn btn-secondary layer-btn reshape" data-tb="${tb_name}">
                            ปรับรูปแปลง
                        </button>
                        <button class="btn btn-secondary layer-btn dashboard" data-tb="${tb_name}">
                            Dashboard
                        </button>
                        <button class="btn btn-assign layer-btn assignBtn" data-tb="${tb_name}" title="มอบหมายงาน">
                            <i class="bi bi-people-fill me-1"></i>มอบหมายงาน
                        </button>
                        <div class="dropdown d-inline-block mt-1">
                            <button class="btn btn-success dropdown-toggle layer-btn" type="button" id="dropdownMenuButton${tb_name}" data-bs-toggle="dropdown" aria-expanded="false">
                                <i class="bi bi-download me-1"></i>Download ข้อมูล
                            </button>
                            <ul class="dropdown-menu premium-dropdown-menu" aria-labelledby="dropdownMenuButton${tb_name}">
                                <li>
                                    <a class="dropdown-item download_all" href="javascript:void(0);" data-tb="${tb_name}">
                                        <div class="icon-wrapper" style="color: #e91e63 !important; background: #fce4ec !important;"><i class="bi bi-download"></i></div>
                                        <span class="fw-bold">Download ทั้งหมด</span>
                                    </a>
                                </li>
                                <li><hr class="dropdown-divider"></li>
                                <li>
                                    <a class="dropdown-item reshape_download" href="javascript:void(0);" data-tb="${tb_name}">
                                        <div class="icon-wrapper"><i class="bi bi-file-earmark-text"></i></div>
                                        <span>Download แปลงโฉนดของยางพารา</span>
                                    </a>
                                </li>
                                <li>
                                    <a class="dropdown-item classify_download" href="javascript:void(0);" data-tb="${tb_name}">
                                        <div class="icon-wrapper"><i class="bi bi-file-earmark-check"></i></div>
                                        <span>Download reclassify (LU)</span>
                                    </a>
                                </li>
                                <li><hr class="dropdown-divider"></li>
                                <li>
                                    <a class="dropdown-item classify_download_rubber" href="javascript:void(0);" data-tb="${tb_name}">
                                        <div class="icon-wrapper" style="color: #0288d1 !important; background: #e1f5fe !important;"><i class="bi bi-cloud-arrow-down"></i></div>
                                        <span>Download Reclassify (ยางลงทะเบียน)</span>
                                    </a>
                                </li>
                                <li>
                                    <a class="dropdown-item classify_download_all_rubber" href="javascript:void(0);" data-tb="${tb_name}">
                                        <div class="icon-wrapper" style="color: #6a1b9a !important; background: #f3e5f5 !important;"><i class="bi bi-cloud-download"></i></div>
                                        <span>Download Reclassify (ยางลงทะเบียน+พื้นที่กันออกทั้งหมด)</span>
                                    </a>
                                </li>
                            </ul>
                        </div>
                        <button class="btn btn-payment layer-btn payBtn mt-1" data-tb="${tb_name}" title="คำนวณค่าจ้าง">
                            <i class="bi bi-calculator-fill me-1"></i>คำนวณค่าจ้าง
                        </button>
                        <button class="btn btn-checker-pay layer-btn checkerPayBtn mt-1" data-tb="${tb_name}" title="คำนวณค่าจ้างคนตรวจ">
                            <i class="bi bi-shield-check me-1"></i>ค่าคนตรวจ
                        </button>
                        <button class="btn btn-danger layer-btn deleteBtn mt-1" data-tb="${tb_name}" title="ลบ layer">
                            <i class="bi bi-trash3-fill"></i>
                        </button>
                    </div>
                    <!-- Mini assignment strip -->
                    <div class="assignment-strip mt-2" id="strip_${tb_name}"></div>
                    <div class="mt-2 border" id="chart_${tb_name}"></div>
                </div>`;
            layerList.appendChild(wrapper);
            await showChart(tb_name, tb_name);
            await loadAssignmentStrip(tb_name);
        });

        await Promise.all(promises);

        /* ── rename display name ── */
        document.querySelectorAll('.renameBtn').forEach(btn => {
            btn.addEventListener('click', async function () {
                const currentName = this.getAttribute('data-tb');
                const newName = prompt(`แก้ไขชื่อโปรเจค "${currentName}"\n(พิมพ์ตัวพิมพ์ใหญ่/เล็กได้ตามต้องการ เช่น PLK หรือ Plk)`, currentName);
                if (!newName || newName === currentName) return;
                if (newName.toLowerCase() !== currentName.toLowerCase()) {
                    alert('ไม่สามารถเปลี่ยนชื่อตัวอักษรได้ เปลี่ยนได้เฉพาะตัวพิมพ์ใหญ่/เล็กเท่านั้น');
                    return;
                }
                try {
                    const res = await fetch(`/rub/api/layerlist/${currentName}/displayname`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ display_name: newName })
                    });
                    const data = await res.json();
                    if (data.success) {
                        const titleEl = document.getElementById(`layerTitle_${currentName.toLowerCase()}`);
                        if (titleEl) titleEl.textContent = titleEl.textContent.replace(currentName, newName);
                        this.setAttribute('data-tb', newName);
                        alert(`เปลี่ยนชื่อเป็น "${newName}" สำเร็จ`);
                        await initApp();
                    } else {
                        alert('เกิดข้อผิดพลาด: ' + (data.error || 'unknown'));
                    }
                } catch (err) {
                    alert('เกิดข้อผิดพลาด: ' + err.message);
                }
            });
        });

        /* ── เพิ่มข้อมูล per-row button ── */
        document.querySelectorAll('.addDataBtn').forEach(btn => {
            btn.addEventListener('click', function () {
                const tb = this.getAttribute('data-tb');
                openAddDataModal(tb);
            });
        });

        /* ── มอบหมายงาน per-row button ── */
        document.querySelectorAll('.assignBtn').forEach(btn => {
            btn.addEventListener('click', function () {
                const tb = this.getAttribute('data-tb');
                openAssignModal(tb);
            });
        });

        /* ── ปรับรูปแปลง ── */
        document.querySelectorAll('.reshape').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                if (document.getElementById('chkLogin').value === 'false') {
                    alert('กรุณา Login ก่อนครับ');
                    return;
                }
                const tb = this.getAttribute('data-tb');
                window.location.href = `./../reshape/index.html?tb=${tb}`;
            });
        });

        /* ── Dashboard ── */
        document.querySelectorAll('.dashboard').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                window.location.href = `./../reclassdash/index.html?tb=${tb}`;
            });
        });

        /* ── Download ทั้งหมด ── */
        document.querySelectorAll('.download_all').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/${tb}`, `pacel_yang_${tb}.geojson`);
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}`, `v_reclass_LU_${tb}.geojson`);
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}?type=rubber`, `v_reclass_rubber_${tb}.geojson`);
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}?type=rubber_and_ex`, `v_reclass_rubber_ex_${tb}.geojson`);
            });
        });

        /* ── Download แปลงยาง ── */
        document.querySelectorAll('.reshape_download').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/${tb}`, `pacel_yang_${tb}.geojson`);
            });
        });

        /* ── Download reclassify ── */
        document.querySelectorAll('.classify_download').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}`, `v_reclass_LU_${tb}.geojson`);
            });
        });

        /* ── Download reclassify (ลงทะเบียน) ── */
        document.querySelectorAll('.classify_download_rubber').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}?type=rubber`, `v_reclass_rubber_${tb}.geojson`);
            });
        });

        /* ── Download reclassify (ลงทะเบียน+พื้นที่กันออกทั้งหมด) ── */
        document.querySelectorAll('.classify_download_all_rubber').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}?type=rubber_and_ex`, `v_reclass_rubber_ex_${tb}.geojson`);
            });
        });

        /* ── คำนวณค่าจ้าง ── */
        document.querySelectorAll('.payBtn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                openPaymentModal(tb);
            });
        });

        /* ── คำนวณค่าคนตรวจ ── */
        document.querySelectorAll('.checkerPayBtn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                openCheckerPaymentModal(tb);
            });
        });

        /* ── ลบ layer ── */
        document.querySelectorAll('.deleteBtn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                if (document.getElementById('chkLogin').value === 'false') {
                    alert('กรุณา Login ก่อนครับ');
                    return;
                }
                const tb = this.getAttribute('data-tb');
                if (!confirm(`ยืนยันลบ "${tb}" ใช่หรือไม่?`)) return;

                fetch(`/rub/api/layerlist/${tb}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' }
                })
                    .then(res => res.json())
                    .then(result => {
                        if (result.success) {
                            alert(`ลบ ${tb} เรียบร้อย`);
                            initApp();
                        } else {
                            alert('เกิดข้อผิดพลาด');
                        }
                    })
                    .catch(err => console.error('Delete failed:', err));
            });
        });

    } catch (error) {
        console.error('Error initializing app:', error);
    }
};

/* ── Helper: trigger file download ── */
const downloadFile = (url, filename) => {
    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error(res.statusText);
            return res.blob();
        })
        .then(blob => {
            const link = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = link;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(link);
        })
        .catch(err => console.error('Download failed:', err));
};

/* ═════════════════════════════════════════════════════════════
   MODAL 1 – สร้าง Project (create empty table, no upload)
═════════════════════════════════════════════════════════════ */

let createProjectModal = null;

document.getElementById('createProjectBtn').addEventListener('click', () => {
    if (!createProjectModal) {
        createProjectModal = new bootstrap.Modal(document.getElementById('createProjectModal'));
    }
    // reset form
    const cpProv = document.getElementById('cp_province');
    const cpPers = document.getElementById('cp_person');
    const cpRem = document.getElementById('cp_remark');
    if (cpProv) { cpProv.value = ''; cpProv.classList.remove('is-invalid'); }
    if (cpPers) cpPers.value = '';
    if (cpRem) cpRem.value = '';
    document.getElementById('tableNamePreview').style.display = 'none';
    const errEl = document.getElementById('cp_name_error');
    if (errEl) errEl.style.display = 'none';
    createProjectModal.show();
});

/* Live preview of table name */
['cp_province', 'cp_person'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('input', updateTableNamePreview);
    }
});

function updateTableNamePreview() {
    const provEl = document.getElementById('cp_province');
    const persEl = document.getElementById('cp_person');

    const province = provEl ? provEl.value.trim().replace(/\s+/g, '_') : '';
    const person = persEl ? persEl.value.trim().replace(/\s+/g, '_') : '';
    const preview = document.getElementById('tableNamePreview');
    const nameEl = document.getElementById('previewTableName');
    const errorEl = document.getElementById('cp_name_error');

    if (province) {
        const tb_name = person ? `${province}_${person}` : `${province}`;
        nameEl.textContent = tb_name;
        preview.style.display = 'block';

        if (errorEl) {
            if (existingLayerNames.has(tb_name.toLowerCase())) {
                errorEl.textContent = `ชื่อ "${tb_name.toUpperCase()}" มีอยู่แล้ว กรุณาใช้ชื่ออื่น`;
                errorEl.style.display = 'block';
                document.getElementById('cp_province').classList.add('is-invalid');
            } else {
                errorEl.style.display = 'none';
                document.getElementById('cp_province').classList.remove('is-invalid');
            }
        }
    } else {
        preview.style.display = 'none';
        if (errorEl) errorEl.style.display = 'none';
        document.getElementById('cp_province').classList.remove('is-invalid');
    }
}

document.getElementById('btnCreateProject').addEventListener('click', async () => {
    const provEl = document.getElementById('cp_province');
    const persEl = document.getElementById('cp_person');
    const remEl = document.getElementById('cp_remark');

    const province = provEl ? provEl.value.trim().replace(/\s+/g, '_') : '';
    const person = persEl ? persEl.value.trim().replace(/\s+/g, '_') : '';
    const remark = remEl ? remEl.value.trim() : '';

    const errorEl = document.getElementById('cp_name_error');
    const cpInput = document.getElementById('cp_province');

    if (!province) {
        if (errorEl) { errorEl.textContent = 'กรุณากรอกชื่อ table'; errorEl.style.display = 'block'; }
        cpInput.classList.add('is-invalid');
        return;
    }

    const tb_name = person ? `${province}_${person}` : `${province}`;

    if (existingLayerNames.has(tb_name.toLowerCase())) {
        if (errorEl) { errorEl.textContent = `ชื่อ "${tb_name.toUpperCase()}" มีอยู่แล้ว กรุณาใช้ชื่ออื่น`; errorEl.style.display = 'block'; }
        cpInput.classList.add('is-invalid');
        return;
    }

    const btn = document.getElementById('btnCreateProject');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังสร้าง...';

    try {
        const res = await fetch('/rub/api/create-project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tb_name, remark })
        });
        const data = await res.json();

        if (data.success) {
            createProjectModal.hide();
            initApp();
        } else {
            if (errorEl) { errorEl.textContent = data.error || 'เกิดข้อผิดพลาด'; errorEl.style.display = 'block'; }
            cpInput.classList.add('is-invalid');
        }
    } catch (err) {
        if (errorEl) { errorEl.textContent = err.message; errorEl.style.display = 'block'; }
        cpInput.classList.add('is-invalid');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>สร้าง Project';
    }
});

/* ═════════════════════════════════════════════════════════════
   MODAL 2 – เพิ่มข้อมูล (upload shapefile to existing table)
═════════════════════════════════════════════════════════════ */

let addDataModal = null;
let selectedZipFiles = [];

function openAddDataModal(tb_name) {
    if (!addDataModal) {
        addDataModal = new bootstrap.Modal(document.getElementById('addDataModal'));
    }
    // reset
    document.getElementById('ad_tb_name').value = tb_name;
    document.getElementById('ad_geom_type').value = '';
    document.getElementById('ad_shpFile').value = '';
    document.getElementById('fileNameDisplay').style.display = 'none';
    document.getElementById('fileNameDisplay').textContent = '';
    document.getElementById('fileNameDisplay').innerHTML = '';
    document.getElementById('ad_uploadProgress').style.display = 'none';
    document.getElementById('ad_progressBar').style.width = '0%';
    selectedZipFiles = [];
    // clear geom type selection
    document.querySelectorAll('.geom-type-card').forEach(c => c.classList.remove('selected'));

    addDataModal.show();
}

/* Geometry type card selection */
document.querySelectorAll('.geom-type-card').forEach(card => {
    card.addEventListener('click', function () {
        document.querySelectorAll('.geom-type-card').forEach(c => c.classList.remove('selected'));
        this.classList.add('selected');
        document.getElementById('ad_geom_type').value = this.getAttribute('data-value');
    });
});

/* Upload zone – drag & drop */
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('ad_shpFile');

uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        setSelectedFiles(e.dataTransfer.files);
    }
});

fileInput.addEventListener('change', function () {
    if (this.files.length > 0) {
        setSelectedFiles(this.files);
    }
});

function setSelectedFiles(files) {
    for (let i = 0; i < files.length; i++) {
        selectedZipFiles.push(files[i]);
    }
    renderSelectedFiles();
}

function renderSelectedFiles() {
    const display = document.getElementById('fileNameDisplay');
    if (selectedZipFiles.length === 0) {
        display.style.display = 'none';
        display.innerHTML = '';
        fileInput.value = '';
        return;
    }

    display.style.display = 'flex';
    display.innerHTML = '';

    selectedZipFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'd-flex justify-content-between align-items-center w-100 p-2 border rounded border-secondary bg-white shadow-sm';
        item.innerHTML = `
            <span><i class="bi bi-file-earmark-zip me-1 text-primary"></i>${file.name}</span>
            <i class="bi bi-x-circle-fill text-danger btn-remove-file ms-3" style="cursor:pointer;" title="ลบไฟล์" data-index="${index}"></i>
        `;
        display.appendChild(item);
    });

    display.querySelectorAll('.btn-remove-file').forEach(btn => {
        btn.addEventListener('click', function () {
            const idx = parseInt(this.getAttribute('data-index'));
            selectedZipFiles.splice(idx, 1);
            renderSelectedFiles();
        });
    });
}

/* Upload button */
document.getElementById('btnAddData').addEventListener('click', async () => {
    const tb_name = document.getElementById('ad_tb_name').value.trim();
    const geom_type = document.getElementById('ad_geom_type').value;

    if (!geom_type) { alert('กรุณาเลือกประเภทข้อมูล (Polygon / Point)'); return; }
    if (selectedZipFiles.length === 0) { alert('กรุณาเลือกไฟล์ ZIP อย่างน้อย 1 ไฟล์'); return; }

    document.getElementById('ad_uploadProgress').style.display = 'block';

    const btn = document.getElementById('btnAddData');
    btn.disabled = true;

    let totalRecords = 0;
    let hasError = false;

    for (let i = 0; i < selectedZipFiles.length; i++) {
        const file = selectedZipFiles[i];
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>กำลังอัปโหลดไฟล์ ${i + 1} / ${selectedZipFiles.length}...`;

        document.getElementById('ad_progressBar').style.width = '0%';
        document.getElementById('ad_progressText').textContent = `กำลังอัปโหลด ${file.name} (ไฟล์ ${i + 1}/${selectedZipFiles.length})...`;

        const success = await new Promise((resolve) => {
            const formData = new FormData();
            formData.append('shpFile', file);
            formData.append('tb_name', tb_name);
            formData.append('geom_type', geom_type);

            const xhr = new XMLHttpRequest();
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const pct = Math.round((e.loaded / e.total) * 100);
                    document.getElementById('ad_progressBar').style.width = pct + '%';
                    document.getElementById('ad_progressText').textContent = `อัปโหลด ${file.name} ${pct}%`;
                }
            });

            xhr.addEventListener('load', () => {
                try {
                    const result = JSON.parse(xhr.responseText);
                    if (xhr.status === 200 && result.success) {
                        totalRecords += result.recordCount || 0;
                        resolve(true);
                    } else {
                        alert(`เกิดข้อผิดพลาดกับไฟล์ ${file.name}: ${result.error || 'Unknown error'}`);
                        resolve(false);
                    }
                } catch (parseErr) {
                    alert(`เกิดข้อผิดพลาดในการประมวลผลไฟล์ ${file.name}`);
                    resolve(false);
                }
            });

            xhr.addEventListener('error', () => {
                alert(`เกิดข้อผิดพลาดในการส่งข้อมูลไฟล์ ${file.name} (Network Error)`);
                resolve(false);
            });

            xhr.open('POST', '/rub/api/upload-shapefile-to-table', true);
            xhr.send(formData);
        });

        if (!success) {
            hasError = true;
            break;
        }
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-cloud-upload me-1"></i>อัปโหลดข้อมูล';

    if (!hasError) {
        document.getElementById('ad_progressBar').style.width = '100%';
        document.getElementById('ad_progressText').textContent = 'อัปโหลดเสร็จแล้ว!';
        setTimeout(() => {
            document.getElementById('ad_uploadProgress').style.display = 'none';
            alert(`อัปโหลดสำเร็จ! ทั้งหมด ${totalRecords} records (${geom_type})`);
            addDataModal.hide();
            initApp();
        }, 600);
    } else {
        document.getElementById('ad_uploadProgress').style.display = 'none';
    }
});


/* ═════════════════════════════════════════════════════════════
   MODAL 3 – มอบหมายงาน (Task Assignment)
═════════════════════════════════════════════════════════════ */

let assignModal = null;
let currentAssignTb = null;
let allUsers = [];

/* ── โหลด users ไว้ใน cache ── */
async function loadUsersCache() {
    try {
        const res = await fetch('/rub/api/users');
        allUsers = await res.json();
    } catch (e) {
        allUsers = [];
    }
}

/* ── เปิด Modal ── */
async function openAssignModal(tb_name) {
    currentAssignTb = tb_name;
    if (!assignModal) {
        assignModal = new bootstrap.Modal(document.getElementById('assignModal'));
    }

    // set badge
    document.getElementById('assignModalTbBadge').textContent = tb_name;
    document.getElementById('assign_tb_name').value = tb_name;

    // reset form
    resetAssignForm();

    // render user picker
    renderAssigneePicker(null);

    // load existing assignments
    await renderAssignmentList(tb_name);

    assignModal.show();
}

/* ── Render assignee picker จาก users table (ใช้ email เป็นตัวระบุ) ── */
function renderAssigneePicker(selectedEmail) {
    const picker = document.getElementById('assigneePicker');
    picker.innerHTML = '';

    if (allUsers.length === 0) {
        picker.innerHTML = '<small class="text-muted">ยังไม่มีผู้ใช้ login เข้าระบบ</small>';
        return;
    }

    allUsers.forEach(u => {
        const chip = document.createElement('div');
        chip.className = 'assignee-chip';
        if (selectedEmail && u.email === selectedEmail) chip.classList.add('selected');
        chip.dataset.email = u.email || '';
        chip.dataset.userId = u.id;
        const avatarSrc = u.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.display_name)}&background=E9F5EC&color=2e7d32&rounded=true`;
        chip.innerHTML = `
            <img src="${avatarSrc}" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(u.display_name)}&background=E9F5EC&color=2e7d32&rounded=true'">
            <div style="line-height:1.2; text-align:center;">
                <div style="font-size:0.78rem; font-weight:600;">${u.display_name}</div>
                <div style="font-size:0.65rem; color:#6a8c6a;">${u.email || ''}</div>
            </div>
        `;
        chip.addEventListener('click', () => {
            document.querySelectorAll('.assignee-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            document.getElementById('assign_name').value = u.display_name;
            document.getElementById('assign_email').value = u.email || '';
            document.getElementById('assign_user_id').value = u.id;
            document.getElementById('assign_photo').value = u.photo || '';
        });
        picker.appendChild(chip);
    });
}

/* ── Reset form ── */
function resetAssignForm() {
    document.getElementById('assign_id').value = '';
    document.getElementById('assign_name').value = '';
    document.getElementById('assign_email').value = '';
    document.getElementById('assign_user_id').value = '';
    document.getElementById('assign_photo').value = '';
    document.getElementById('assign_id_from').value = '';
    document.getElementById('assign_id_to').value = '';
    document.getElementById('assign_note').value = '';
    document.getElementById('assign_email_input').value = '';
    document.getElementById('emailLookupResult').innerHTML = '';
    document.getElementById('assignFormTitle').innerHTML = '<i class="bi bi-plus-circle me-1"></i>เพิ่มการมอบหมายงานใหม่';
    document.getElementById('btnCancelAssignEdit').style.display = 'none';
    document.querySelectorAll('.assignee-chip').forEach(c => c.classList.remove('selected'));
}

/* ── ฟังก์ชัน: เลือก assignee จาก email (ทั้ง lookup และ manual) ── */
function selectAssigneeByEmail(email) {
    const resultEl = document.getElementById('emailLookupResult');
    if (!email) { resultEl.innerHTML = ''; return; }

    // ค้นหาใน allUsers ก่อน
    const found = allUsers.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());

    if (found) {
        // มีใน DB → เลือก chip + fill hidden fields
        document.querySelectorAll('.assignee-chip').forEach(c => c.classList.remove('selected'));
        const chip = document.querySelector(`.assignee-chip[data-email="${found.email}"]`);
        if (chip) chip.classList.add('selected');

        document.getElementById('assign_name').value = found.display_name;
        document.getElementById('assign_email').value = found.email;
        document.getElementById('assign_user_id').value = found.id;
        document.getElementById('assign_photo').value = found.photo || '';

        resultEl.innerHTML = `
            <span class="text-success">
                <i class="bi bi-check-circle-fill me-1"></i>พบในระบบ: <strong>${found.display_name}</strong>
            </span>`;
    } else {
        // ยังไม่เคย Login → ใช้อีเมลเป็นชื่อ (จะ link ตอน Login ครั้งแรก)
        document.querySelectorAll('.assignee-chip').forEach(c => c.classList.remove('selected'));
        const namePart = email.split('@')[0];
        document.getElementById('assign_name').value = namePart;
        document.getElementById('assign_email').value = email;
        document.getElementById('assign_user_id').value = '';
        document.getElementById('assign_photo').value = '';

        resultEl.innerHTML = `
            <span class="text-warning">
                <i class="bi bi-exclamation-circle-fill me-1"></i>ยังไม่เคย Login — จะใช้ชื่อ <strong>${namePart}</strong> และ link อัตโนมัติเมื่อ Login ครั้งแรก
            </span>`;
    }
}

/* ── Event: กดปุ่ม Lookup ── */
document.getElementById('btnLookupEmail').addEventListener('click', () => {
    const email = document.getElementById('assign_email_input').value.trim();
    if (!email) { document.getElementById('emailLookupResult').innerHTML = '<span class="text-danger">กรุณากรอกอีเมล</span>'; return; }
    selectAssigneeByEmail(email);
});

/* ── Event: กด Enter ในช่อง email ── */
document.getElementById('assign_email_input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const email = e.target.value.trim();
        if (email) selectAssigneeByEmail(email);
    }
});

/* ── แสดงรายการ assignments ── */
async function renderAssignmentList(tb_name) {
    const listEl = document.getElementById('assignmentList');
    listEl.innerHTML = '<div class="text-muted text-center py-2"><span class="spinner-border spinner-border-sm"></span></div>';

    try {
        const res = await fetch(`/rub/api/task-assignments/${tb_name}`);
        const { data } = await res.json();

        if (!data || data.length === 0) {
            listEl.innerHTML = `<div class="assign-empty">
                <i class="bi bi-inbox" style="font-size:2rem; color:#a5d6a7;"></i>
                <div class="mt-1">ยังไม่มีการมอบหมายงาน</div>
            </div>`;
            return;
        }

        // Sort by id_from
        data.sort((a, b) => a.id_from - b.id_from);

        listEl.innerHTML = '';

        // Visualise ID range bar
        const maxId = Math.max(...data.map(d => d.id_to));

        // Color palette
        const palette = [
            '#4CAF50', '#2196F3', '#FF9800', '#9C27B0',
            '#F44336', '#00BCD4', '#FF5722', '#795548'
        ];

        // Group by assignee to assign consistent color
        const colorMap = {};
        let colorIdx = 0;
        data.forEach(d => {
            if (!colorMap[d.assignee_name]) {
                colorMap[d.assignee_name] = palette[colorIdx % palette.length];
                colorIdx++;
            }
        });

        // Render header summary
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'assign-summary mb-3';

        // ID range visualization
        const vizDiv = document.createElement('div');
        vizDiv.className = 'assign-range-viz mb-3';
        vizDiv.innerHTML = `<div class="assign-range-label">ภาพรวม ID Range</div>`;

        const rangeBar = document.createElement('div');
        rangeBar.className = 'assign-range-bar';

        data.forEach(d => {
            const pct_start = ((d.id_from - 1) / maxId) * 100;
            const pct_width = ((d.id_to - d.id_from + 1) / maxId) * 100;
            const seg = document.createElement('div');
            seg.className = 'assign-range-seg';
            seg.style.left = `${pct_start}%`;
            seg.style.width = `${pct_width}%`;
            seg.style.background = colorMap[d.assignee_name];
            seg.title = `${d.assignee_name}: ID ${d.id_from}–${d.id_to}`;
            rangeBar.appendChild(seg);
        });
        vizDiv.appendChild(rangeBar);

        // Range labels
        const labelRow = document.createElement('div');
        labelRow.className = 'assign-range-labels';
        data.forEach(d => {
            const lbl = document.createElement('span');
            lbl.className = 'assign-range-tick';
            lbl.style.left = `${((d.id_from - 1) / maxId) * 100}%`;
            lbl.textContent = d.id_from;
            labelRow.appendChild(lbl);
        });
        // Last id label
        const lastLbl = document.createElement('span');
        lastLbl.className = 'assign-range-tick';
        lastLbl.style.left = '100%';
        lastLbl.style.transform = 'translateX(-100%)';
        lastLbl.textContent = maxId;
        labelRow.appendChild(lastLbl);
        vizDiv.appendChild(labelRow);

        listEl.appendChild(vizDiv);

        // Render each row
        const rowsDiv = document.createElement('div');
        rowsDiv.className = 'assign-rows';

        data.forEach(d => {
            const color = colorMap[d.assignee_name];
            const row = document.createElement('div');
            row.className = 'assign-row';
            row.innerHTML = `
                <div class="assign-row-color" style="background:${color};"></div>
                <div class="assign-row-avatar">
                    ${d.assignee_photo
                    ? `<img src="${d.assignee_photo}" referrerpolicy="no-referrer" class="assign-avatar" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(d.assignee_name)}&background=E9F5EC&color=2e7d32&rounded=true'">`
                    : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(d.assignee_name)}&background=E9F5EC&color=2e7d32&rounded=true" class="assign-avatar">`
                }
                </div>
                <div class="assign-row-info">
                    <div class="assign-row-name">${d.assignee_name}</div>
                    <div class="assign-row-range">
                        <span class="assign-badge" style="background:${color};">ID ${d.id_from} – ${d.id_to}</span>
                        <span class="assign-count">(${d.id_to - d.id_from + 1} รายการ)</span>
                        ${d.note ? `<span class="assign-note-text">• ${d.note}</span>` : ''}
                    </div>
                </div>
                <div class="assign-row-actions">
                    <button class="btn btn-sm btn-outline-primary assign-edit-btn" data-id="${d.id}" title="แก้ไข">
                        <i class="bi bi-pencil-fill"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger assign-del-btn" data-id="${d.id}" title="ลบ">
                        <i class="bi bi-trash3-fill"></i>
                    </button>
                </div>
            `;
            rowsDiv.appendChild(row);
        });

        listEl.appendChild(rowsDiv);

        // Edit button handler
        listEl.querySelectorAll('.assign-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const rowId = btn.getAttribute('data-id');
                const d = data.find(x => x.id == rowId);
                if (!d) return;

                document.getElementById('assign_id').value = d.id;
                document.getElementById('assign_name').value = d.assignee_name;
                document.getElementById('assign_email').value = d.assignee_email || '';
                document.getElementById('assign_user_id').value = d.user_id || '';
                document.getElementById('assign_photo').value = d.assignee_photo || '';
                document.getElementById('assign_id_from').value = d.id_from;
                document.getElementById('assign_id_to').value = d.id_to;
                document.getElementById('assign_note').value = d.note || '';
                document.getElementById('assignFormTitle').innerHTML =
                    '<i class="bi bi-pencil-fill me-1"></i>แก้ไขการมอบหมายงาน';
                document.getElementById('btnCancelAssignEdit').style.display = 'inline-flex';

                // Highlight chip by email
                renderAssigneePicker(d.assignee_email || null);

                // Scroll to form
                document.getElementById('assignFormCard').scrollIntoView({ behavior: 'smooth' });
            });
        });

        // Delete button handler
        listEl.querySelectorAll('.assign-del-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const rowId = btn.getAttribute('data-id');
                const d = data.find(x => x.id == rowId);
                if (!d) return;
                if (!confirm(`ลบการมอบหมาย "${d.assignee_name} (ID ${d.id_from}–${d.id_to})" ใช่หรือไม่?`)) return;

                try {
                    const res = await fetch(`/rub/api/task-assignments/${rowId}`, { method: 'DELETE' });
                    const result = await res.json();
                    if (result.success) {
                        await renderAssignmentList(tb_name);
                        await loadAssignmentStrip(tb_name);
                    } else {
                        alert(`เกิดข้อผิดพลาด: ${result.error}`);
                    }
                } catch (err) {
                    alert(`เกิดข้อผิดพลาด: ${err.message}`);
                }
            });
        });

    } catch (err) {
        listEl.innerHTML = `<div class="text-danger">โหลดข้อมูลไม่ได้: ${err.message}</div>`;
    }
}

/* ── Save assignment ── */
document.getElementById('btnSaveAssign').addEventListener('click', async () => {
    const assignId = document.getElementById('assign_id').value;
    const tb_name = document.getElementById('assign_tb_name').value;
    const name = document.getElementById('assign_name').value.trim();
    const email = document.getElementById('assign_email').value.trim();
    const userId = document.getElementById('assign_user_id').value.trim();
    const photo = document.getElementById('assign_photo').value.trim();
    const id_from = document.getElementById('assign_id_from').value;
    const id_to = document.getElementById('assign_id_to').value;
    const note = document.getElementById('assign_note').value.trim();

    // ถ้ายังไม่ได้เลือก → ลองดึงจากช่องพิมพ์อีเมลก่อน save
    if (!email) {
        const typedEmail = document.getElementById('assign_email_input').value.trim();
        if (typedEmail) { selectAssigneeByEmail(typedEmail); }
    }
    const finalName = document.getElementById('assign_name').value.trim();
    const finalEmail = document.getElementById('assign_email').value.trim();
    if (!finalName || !finalEmail) { alert('กรุณาเลือกผู้รับผิดชอบ หรือพิมพ์อีเมลแล้วกดค้นหา'); return; }
    if (!id_from || !id_to) { alert('กรุณากรอก ID เริ่มต้น และ ID สิ้นสุด'); return; }
    if (parseInt(id_from) > parseInt(id_to)) { alert('ID เริ่มต้นต้องไม่มากกว่า ID สิ้นสุด'); return; }

    const btn = document.getElementById('btnSaveAssign');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังบันทึก...';

    try {
        let res;
        const finalUserId = document.getElementById('assign_user_id').value.trim();
        const finalPhoto = document.getElementById('assign_photo').value.trim();
        const payload = { assignee_name: finalName, assignee_email: finalEmail, assignee_photo: finalPhoto,
                          user_id: finalUserId || null, id_from, id_to, note };
        if (assignId) {
            res = await fetch(`/rub/api/task-assignments/${assignId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch(`/rub/api/task-assignments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tb_name, ...payload })
            });
        }
        const result = await res.json();
        if (result.success) {
            resetAssignForm();
            renderAssigneePicker(null);
            await renderAssignmentList(tb_name);
            await loadAssignmentStrip(tb_name);
        } else {
            alert(`เกิดข้อผิดพลาด: ${result.error}`);
        }
    } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>บันทึก';
    }
});

/* ── Cancel edit ── */
document.getElementById('btnCancelAssignEdit').addEventListener('click', () => {
    resetAssignForm();
    renderAssigneePicker(null);
});

/* ── Mini assignment strip inside layer card (with progress) ── */
async function loadAssignmentStrip(tb_name) {
    const stripEl = document.getElementById(`strip_${tb_name}`);
    if (!stripEl) return;

    try {
        const res = await fetch(`/rub/api/task-progress/${tb_name}`);
        const { data } = await res.json();

        if (!data || data.length === 0) {
            stripEl.innerHTML = '';
            return;
        }

        const palette = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4', '#FF5722', '#795548'];
        const colorMap = {};
        let ci = 0;
        data.forEach(d => {
            if (!colorMap[d.assignee_name]) { colorMap[d.assignee_name] = palette[ci++ % palette.length]; }
        });

        stripEl.innerHTML = data.map(d => {
            const c = colorMap[d.assignee_name];
            const pct = d.pct || 0;
            let tsStr = '';
            if (d.last_ts) {
                const dt = new Date(d.last_ts);
                tsStr = `<span class="strip-ts"> · ${dt.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}น.</span>`;
            }
            return `
            <div class="strip-progress-block" style="border-color:${c}33;">
                <div class="strip-progress-header">
                    <span class="strip-dot" style="background:${c};"></span>
                    <span class="strip-progress-name" style="color:${c};">${d.assignee_name}</span>
                    <span class="strip-id-range">ID ${d.id_from}–${d.id_to}</span>
                    <span class="strip-pct" style="color:${c};">${pct}%</span>
                    ${tsStr}
                </div>
                <div class="strip-bar-bg">
                    <div class="strip-bar-fill" style="width:${pct}%; background:${c};"></div>
                </div>
                <div class="strip-progress-sub">${d.done}/${d.total} แปลง
                    ${d.last_editor ? `· แก้ล่าสุดโดย <b>${d.last_editor}</b>` : ''}
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        stripEl.innerHTML = '';
    }
}


/* ═════════════════════════════════════════════════════════════
   MODAL 4 – ภาพรวมทีมงานทุกโปรเจค (Global Team Overview)
═════════════════════════════════════════════════════════════ */

let teamOverviewModal = null;
let teamOverviewData = [];

document.getElementById('btnTeamOverview').addEventListener('click', () => {
    if (!teamOverviewModal) {
        teamOverviewModal = new bootstrap.Modal(document.getElementById('teamOverviewModal'));
    }
    document.getElementById('teamOverviewWrap').innerHTML = `
        <div class="text-center text-muted py-4">
            <div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลดข้อมูล...
        </div>`;
    teamOverviewModal.show();

    fetch('/rub/api/worker-summary-all')
        .then(r => r.json())
        .then(({ data }) => {
            teamOverviewData = data || [];
            renderTeamOverview();
        })
        .catch(() => {
            document.getElementById('teamOverviewWrap').innerHTML =
                '<div class="alert alert-danger">โหลดข้อมูลไม่สำเร็จ</div>';
        });
});

/* ── Shared helper: render one area cell (ไร่ + ตร.ม.) ── */
function areaCell(a, countLabel) {
    if (!a || a.total_sqm === 0) return '<span class="text-muted small">—</span>';
    const sqm = Math.round(a.total_sqm).toLocaleString('th-TH');
    return `<div class="area-cnt">${countLabel}</div>
            <div class="pay-area-badge">${fmtRai(a.total_sqm)}</div>
            <div class="pay-area-sub">${sqm} ตร.ม.</div>`;
}

function renderTeamOverview() {
    const rate   = parseFloat(document.getElementById('team_rate_rai').value) || 0;
    const basis  = document.getElementById('team_basis').value;
    const data   = teamOverviewData;
    const wrap   = document.getElementById('teamOverviewWrap');

    if (!data || data.length === 0) {
        wrap.innerHTML = `<div class="alert alert-warning">
            <i class="bi bi-exclamation-triangle me-2"></i>ยังไม่มีข้อมูลการทำงานในระบบ
        </div>`;
        return;
    }

    const palette = ['#4CAF50','#2196F3','#FF9800','#9C27B0','#F44336','#00BCD4','#FF5722','#795548'];
    const basisLabel = { reshape: 'โฉนด', reclass_all: 'Reclass ทั้งหมด', reclass_rubber: 'ยางพารา Rubber' };

    const cards = data.map((worker, wi) => {
        const color  = palette[wi % palette.length];
        const basisA = worker[basis] || {};
        const totalPay = (basisA.area_rai_decimal || 0) * rate;
        const avatar = worker.photo
            ? `<img src="${worker.photo}" class="pay-avatar" referrerpolicy="no-referrer"
                onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(worker.editor)}&background=E9F5EC&color=2e7d32&rounded=true'">`
            : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(worker.editor)}&background=E9F5EC&color=2e7d32&rounded=true" class="pay-avatar">`;

        const projectRows = worker.projects.map(p => {
            const pBasis = p[basis] || {};
            const pPay = (pBasis.area_rai_decimal || 0) * rate;
            const reshapeCnt  = `${(p.reshape.farmer_count||0)} แปลง`;
            const reclassCnt  = `${(p.reclass_all.sub_plot_count||0)} รายการ /${(p.reclass_all.farmer_count||0)} แปลง`;
            const rubberCnt   = `${(p.reclass_rubber.sub_plot_count||0)} รายการ /${(p.reclass_rubber.farmer_count||0)} แปลง`;
            return `<tr class="team-project-row">
                <td><span class="team-project-badge"><i class="bi bi-table me-1"></i>${p.tb_name}</span></td>
                <td class="text-center ${basis==='reshape'?'area-col-selected':''}">${areaCell(p.reshape, reshapeCnt)}</td>
                <td class="text-center ${basis==='reclass_all'?'area-col-selected':''}">${areaCell(p.reclass_all, reclassCnt)}</td>
                <td class="text-center ${basis==='reclass_rubber'?'area-col-selected':''}">${areaCell(p.reclass_rubber, rubberCnt)}</td>
                <td class="text-end fw-bold" style="color:${color};">${pPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
            </tr>`;
        }).join('');

        const wReshapeCnt  = `${(worker.reshape.farmer_count||0)} แปลง`;
        const wReclassCnt  = `${(worker.reclass_all.sub_plot_count||0)} รายการ`;
        const wRubberCnt   = `${(worker.reclass_rubber.sub_plot_count||0)} รายการ`;

        return `
        <div class="team-worker-card mb-3" style="border-color:${color}44;">
            <div class="team-worker-header" data-bs-toggle="collapse" data-bs-target="#worker_${wi}" style="cursor:pointer;">
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    ${avatar}
                    <div class="team-worker-dot" style="background:${color};"></div>
                    <span class="team-worker-name" style="color:${color};">${worker.editor}</span>
                    <span class="team-worker-meta">${worker.projects.length} โปรเจค</span>
                    <span class="ms-auto d-flex align-items-center gap-3 flex-wrap">
                        <span class="area-summary-group">
                            <span class="area-summary-label">โฉนด</span>
                            <span class="area-summary-val ${basis==='reshape'?'area-selected-text':''}">${fmtRai(worker.reshape.total_sqm||0)} · ${Math.round(worker.reshape.total_sqm||0).toLocaleString()}ตร.ม.</span>
                        </span>
                        <span class="area-summary-group">
                            <span class="area-summary-label">Reclass</span>
                            <span class="area-summary-val ${basis==='reclass_all'?'area-selected-text':''}">${fmtRai(worker.reclass_all.total_sqm||0)} · ${Math.round(worker.reclass_all.total_sqm||0).toLocaleString()}ตร.ม.</span>
                        </span>
                        <span class="area-summary-group">
                            <span class="area-summary-label">Rubber</span>
                            <span class="area-summary-val ${basis==='reclass_rubber'?'area-selected-text':''}">${fmtRai(worker.reclass_rubber.total_sqm||0)} · ${Math.round(worker.reclass_rubber.total_sqm||0).toLocaleString()}ตร.ม.</span>
                        </span>
                        <span class="team-pay-total" style="color:${color};">${totalPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</span>
                        <i class="bi bi-chevron-down team-chevron"></i>
                    </span>
                </div>
            </div>
            <div class="collapse show" id="worker_${wi}">
                <div class="team-project-table-wrap table-responsive">
                    <table class="table table-sm payment-table mb-0">
                        <thead>
                            <tr>
                                <th>โปรเจค</th>
                                <th class="text-center ${basis==='reshape'?'area-col-selected':''}">🏡 โฉนด Reshape<br><small class="fw-normal text-muted">แปลง / ไร่ / ตร.ม.</small></th>
                                <th class="text-center ${basis==='reclass_all'?'area-col-selected':''}">📋 Reclass ทั้งหมด<br><small class="fw-normal text-muted">แปลง / ไร่ / ตร.ม.</small></th>
                                <th class="text-center ${basis==='reclass_rubber'?'area-col-selected':''}">🌿 ยางพารา Rubber<br><small class="fw-normal text-muted">แปลง / ไร่ / ตร.ม.</small></th>
                                <th class="text-end">ค่าจ้าง<br><small class="fw-normal text-muted">(จาก ${basisLabel[basis]})</small></th>
                            </tr>
                        </thead>
                        <tbody>${projectRows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
    }).join('');

    // Grand total per basis
    const grandSqm = data.reduce((s,w) => s + ((w[basis]||{}).total_sqm||0), 0);
    const grandPay = (grandSqm / 1600) * rate;

    wrap.innerHTML = `
        ${cards}
        <div class="team-grand-total">
            <span class="fw-bold">รวมทั้งระบบ (${basisLabel[basis]})</span>
            <span class="pay-area-badge ms-3">${fmtRai(grandSqm)}</span>
            <span class="pay-area-sub ms-1">${Math.round(grandSqm).toLocaleString()} ตร.ม.</span>
            <span class="team-pay-total ms-3">${grandPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</span>
        </div>`;
}

function fmtRai(sqm) {
    return (parseFloat(sqm) / 1600).toFixed(2) + ' ไร่';
}

document.getElementById('btnCalcTeam').addEventListener('click', renderTeamOverview);

document.getElementById('btnPrintTeam').addEventListener('click', () => {
    const rate = document.getElementById('team_rate_rai').value;
    const bodyHtml = document.getElementById('teamOverviewWrap').innerHTML;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>ภาพรวมทีมงาน – ทุกโปรเจค</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css">
<style>
  body { font-family:"Noto Sans Thai",sans-serif; padding:20px; }
  .pay-avatar{width:28px;height:28px;border-radius:50%;object-fit:cover;}
  .pay-area-badge{font-size:0.85rem;font-weight:600;color:#2e7d32;}
  .pay-area-sub{font-size:0.72rem;color:#78909c;}
  .team-worker-card{border:1px solid #ddd;border-radius:10px;padding:12px;margin-bottom:12px;}
  .team-worker-header{margin-bottom:8px;}
  .team-worker-name{font-weight:700;font-size:1rem;}
  .team-worker-meta{font-size:0.8rem;color:#78909c;}
  .team-pay-total{font-weight:700;font-size:0.95rem;}
  .team-project-badge{background:#f5f5f5;padding:2px 8px;border-radius:6px;font-size:0.82rem;}
  .team-grand-total{background:#e8f5e9;border-radius:10px;padding:12px 16px;font-size:1rem;margin-top:16px;}
  .team-worker-dot,.team-chevron{display:none;}
  @media print{button,.btn{display:none!important;}}
</style>
</head>
<body>
<h4 style="color:#4a7c59">ภาพรวมทีมงาน – ทุกโปรเจค</h4>
<p class="text-muted mb-3">อัตราค่าจ้าง: <strong>${rate} บาท/ไร่</strong> &nbsp;|&nbsp; วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH',{day:'2-digit',month:'long',year:'numeric'})}</p>
${bodyHtml}
<script>window.onload=()=>window.print();<\/script>
</body></html>`);
    win.document.close();
});

/* ═════════════════════════════════════════════════════════════
   MODAL 5 – คำนวณค่าจ้างรายโปรเจค (Payment per Layer)
═════════════════════════════════════════════════════════════ */

let paymentModal = null;
let paymentWorkerData = [];

function openPaymentModal(tb_name) {
    if (!paymentModal) {
        paymentModal = new bootstrap.Modal(document.getElementById('paymentModal'));
    }
    document.getElementById('paymentModalTbBadge').textContent = tb_name;
    document.getElementById('paymentTableWrap').innerHTML = `
        <div class="text-center text-muted py-4">
            <div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลดข้อมูล...
        </div>`;
    paymentModal.show();

    fetch(`/rub/api/worker-summary/${tb_name}`)
        .then(r => r.json())
        .then(({ data }) => {
            paymentWorkerData = data || [];
            renderPaymentTable();
        })
        .catch(() => {
            document.getElementById('paymentTableWrap').innerHTML =
                '<div class="alert alert-danger">โหลดข้อมูลไม่สำเร็จ</div>';
        });
}

function renderPaymentTable() {
    const rate  = parseFloat(document.getElementById('pay_rate_rai').value) || 0;
    const basis = document.getElementById('pay_basis').value;
    const data  = paymentWorkerData;
    const wrap  = document.getElementById('paymentTableWrap');

    if (!data || data.length === 0) {
        wrap.innerHTML = `<div class="alert alert-warning">
            <i class="bi bi-exclamation-triangle me-2"></i>
            ยังไม่มีข้อมูลการทำงานใน table นี้
        </div>`;
        return;
    }

    const basisLabel = { reshape: 'โฉนด Reshape', reclass_all: 'Reclass ทั้งหมด', reclass_rubber: 'ยางพารา Rubber' };

    const rows = data.map((r, i) => {
        const basisA = r[basis] || {};
        const pay = (basisA.area_rai_decimal || 0) * rate;
        const avatar = r.photo
            ? `<img src="${r.photo}" class="pay-avatar" referrerpolicy="no-referrer"
                onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(r.editor)}&background=E9F5EC&color=2e7d32&rounded=true'">`
            : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(r.editor)}&background=E9F5EC&color=2e7d32&rounded=true" class="pay-avatar">`;

        const reshapeCnt  = `${(r.reshape.farmer_count||0).toLocaleString()} แปลง`;
        const reclassCnt  = `${(r.reclass_all.sub_plot_count||0).toLocaleString()} รายการ ·${(r.reclass_all.farmer_count||0).toLocaleString()} แปลง`;
        const rubberCnt   = `${(r.reclass_rubber.sub_plot_count||0).toLocaleString()} รายการ ·${(r.reclass_rubber.farmer_count||0).toLocaleString()} แปลง`;

        return `<tr>
            <td class="text-center align-middle">${i + 1}</td>
            <td class="align-middle">
                <div class="d-flex align-items-center gap-2">
                    ${avatar}
                    <span class="fw-bold">${r.editor}</span>
                </div>
            </td>
            <td class="text-center ${basis==='reshape'?'area-col-selected':''}">${areaCell(r.reshape, reshapeCnt)}</td>
            <td class="text-center ${basis==='reclass_all'?'area-col-selected':''}">${areaCell(r.reclass_all, reclassCnt)}</td>
            <td class="text-center ${basis==='reclass_rubber'?'area-col-selected':''}">${areaCell(r.reclass_rubber, rubberCnt)}</td>
            <td class="text-end fw-bold align-middle pay-amount">${pay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
        </tr>`;
    }).join('');

    // Totals
    const sumSqm = (key) => data.reduce((s, r) => s + ((r[key]||{}).total_sqm||0), 0);
    const rSqm = sumSqm('reshape'), rcSqm = sumSqm('reclass_all'), rubSqm = sumSqm('reclass_rubber');
    const bSqm = sumSqm(basis);
    const totalPay = (bSqm / 1600) * rate;

    const sumCell = (sqm) => {
        return `<div class="pay-area-badge">${fmtRai(sqm)}</div>
                <div class="pay-area-sub">${Math.round(sqm).toLocaleString('th-TH')} ตร.ม.</div>`;
    };

    wrap.innerHTML = `
    <div class="table-responsive">
        <table class="table table-hover payment-table">
            <thead>
                <tr>
                    <th class="text-center align-middle" style="width:40px" rowspan="1">#</th>
                    <th class="align-middle">ชื่อผู้ทำงาน</th>
                    <th class="text-center ${basis==='reshape'?'area-col-selected':''}">🏡 โฉนด Reshape<br><small class="fw-normal text-muted">แปลง / ไร่ / ตร.ม.</small></th>
                    <th class="text-center ${basis==='reclass_all'?'area-col-selected':''}">📋 Reclass ทั้งหมด<br><small class="fw-normal text-muted">รายการ / แปลง / ไร่ / ตร.ม.</small></th>
                    <th class="text-center ${basis==='reclass_rubber'?'area-col-selected':''}">🌿 ยางพารา Rubber<br><small class="fw-normal text-muted">รายการ / แปลง / ไร่ / ตร.ม.</small></th>
                    <th class="text-end align-middle">ค่าจ้าง<br><small class="fw-normal text-muted">(จาก ${basisLabel[basis]})</small></th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr class="payment-total-row">
                    <td colspan="2" class="fw-bold align-middle">รวมทั้งหมด</td>
                    <td class="text-center ${basis==='reshape'?'area-col-selected':''}">${sumCell(rSqm)}</td>
                    <td class="text-center ${basis==='reclass_all'?'area-col-selected':''}">${sumCell(rcSqm)}</td>
                    <td class="text-center ${basis==='reclass_rubber'?'area-col-selected':''}">${sumCell(rubSqm)}</td>
                    <td class="text-end fw-bold align-middle pay-total-amount">${totalPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                </tr>
            </tfoot>
        </table>
    </div>`;
}

document.getElementById('btnCalcPay').addEventListener('click', renderPaymentTable);

document.getElementById('btnPrintPayment').addEventListener('click', () => {
    const tb = document.getElementById('paymentModalTbBadge').textContent;
    const rate = document.getElementById('pay_rate_rai').value;
    const tableHtml = document.getElementById('paymentTableWrap').innerHTML;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>สรุปค่าจ้าง – ${tb}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css">
<style>
  body { font-family: "Noto Sans Thai", sans-serif; padding: 20px; }
  .pay-avatar { width:28px; height:28px; border-radius:50%; object-fit:cover; }
  .pay-area-badge { font-size:0.85rem; }
  .pay-area-sub { font-size:0.72rem; color:#78909c; }
  .pay-amount { color:#2e7d32; }
  .pay-total-amount { color:#1b5e20; font-size:1.1rem; }
  .payment-total-row { background:#e8f5e9; }
  @media print { button { display:none; } }
</style>
</head>
<body>
<h4 style="color:#4a7c59">สรุปค่าจ้างทีมงาน – ${tb}</h4>
<p class="text-muted mb-3">อัตราค่าจ้าง: <strong>${rate} บาท/ไร่</strong> &nbsp;|&nbsp; วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH', {day:'2-digit',month:'long',year:'numeric'})}</p>
${tableHtml}
<script>window.onload=()=>window.print();<\/script>
</body></html>`);
    win.document.close();
});

/* ═════════════════════════════════════════════════════════════
   MODAL 6 – คำนวณค่าจ้างคนตรวจ (Checker Payment per Layer)
═════════════════════════════════════════════════════════════ */

let checkerPaymentModal = null;
let checkerWorkerData = [];

function openCheckerPaymentModal(tb_name) {
    if (!checkerPaymentModal) {
        checkerPaymentModal = new bootstrap.Modal(document.getElementById('checkerPaymentModal'));
    }
    document.getElementById('checkerPayModalTbBadge').textContent = tb_name;
    document.getElementById('checkerPayTableWrap').innerHTML = `
        <div class="text-center text-muted py-4">
            <div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลดข้อมูล...
        </div>`;
    checkerPaymentModal.show();

    fetch(`/rub/api/checker-summary/${tb_name}`)
        .then(r => r.json())
        .then(({ data }) => {
            checkerWorkerData = data || [];
            renderCheckerPaymentTable();
        })
        .catch(() => {
            document.getElementById('checkerPayTableWrap').innerHTML =
                '<div class="alert alert-danger">โหลดข้อมูลไม่สำเร็จ</div>';
        });
}

function renderCheckerPaymentTable() {
    const rate = parseFloat(document.getElementById('chk_rate_rai').value) || 0;
    const unit = document.getElementById('chk_unit').value;
    const data = checkerWorkerData;
    const wrap = document.getElementById('checkerPayTableWrap');

    if (!data || data.length === 0) {
        wrap.innerHTML = `<div class="alert alert-warning">
            <i class="bi bi-exclamation-triangle me-2"></i>
            ยังไม่มีข้อมูลการตรวจใน table นี้
        </div>`;
        return;
    }

    const unitLabels = {
        class_rai:  'บาท/ไร่ (พื้นที่คลาส)',
        deed_rai:   'บาท/ไร่ (พื้นที่โฉนด)',
        rubber_rai: 'บาท/ไร่ (พื้นที่ยางพารา)',
        plot:       'บาท/แปลง (ID)',
        subplot:    'บาท/รายการ (sub_id)'
    };

    // highlight which area column is active
    const isClass  = unit === 'class_rai';
    const isDeed   = unit === 'deed_rai';
    const isRubber = unit === 'rubber_rai';
    const hl = 'background:#fff9e6;font-weight:700;';

    const rows = data.map((r, i) => {
        let pay = 0;
        if (unit === 'class_rai')  pay = (r.class_rai  || 0) * rate;
        if (unit === 'deed_rai')   pay = (r.deed_rai   || 0) * rate;
        if (unit === 'rubber_rai') pay = (r.rubber_rai || 0) * rate;
        if (unit === 'plot')       pay = (r.farmer_count   || 0) * rate;
        if (unit === 'subplot')    pay = (r.sub_plot_count || 0) * rate;

        const avatar = r.photo
            ? `<img src="${r.photo}" class="pay-avatar" referrerpolicy="no-referrer"
                onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(r.reviewer)}&background=e1f5fe&color=0277bd&rounded=true'">`
            : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(r.reviewer)}&background=e1f5fe&color=0277bd&rounded=true" class="pay-avatar">`;

        const areaBadge = (sqm) =>
            `<div class="pay-area-badge">${fmtRai(sqm || 0)}</div>
             <div class="pay-area-sub">${Math.round(sqm || 0).toLocaleString('th-TH')} ตร.ม.</div>`;

        return `<tr>
            <td class="text-center align-middle">${i + 1}</td>
            <td class="align-middle">
                <div class="d-flex align-items-center gap-2">
                    ${avatar}
                    <span class="fw-bold">${r.reviewer}</span>
                </div>
            </td>
            <td class="text-center align-middle">${(r.sub_plot_count || 0).toLocaleString()} รายการ</td>
            <td class="text-center align-middle">${(r.farmer_count || 0).toLocaleString()} แปลง</td>
            <td class="text-center align-middle" style="${isDeed ? hl : ''}">${areaBadge(r.deed_sqm)}</td>
            <td class="text-center align-middle" style="${isClass ? hl : ''}">${areaBadge(r.class_sqm)}</td>
            <td class="text-center align-middle" style="${isRubber ? hl : ''}">${areaBadge(r.rubber_sqm)}</td>
            <td class="text-end fw-bold align-middle pay-amount">${pay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
        </tr>`;
    }).join('');

    const totalSubplot  = data.reduce((s, r) => s + (r.sub_plot_count || 0), 0);
    const totalPlot     = data.reduce((s, r) => s + (r.farmer_count   || 0), 0);
    const totalDeedSqm  = data.reduce((s, r) => s + (r.deed_sqm    || 0), 0);
    const totalClassSqm = data.reduce((s, r) => s + (r.class_sqm   || 0), 0);
    const totalRubrSqm  = data.reduce((s, r) => s + (r.rubber_sqm  || 0), 0);

    let totalPay = 0;
    if (unit === 'class_rai')  totalPay = (totalClassSqm / 1600) * rate;
    if (unit === 'deed_rai')   totalPay = (totalDeedSqm  / 1600) * rate;
    if (unit === 'rubber_rai') totalPay = (totalRubrSqm  / 1600) * rate;
    if (unit === 'plot')       totalPay = totalPlot    * rate;
    if (unit === 'subplot')    totalPay = totalSubplot * rate;

    const areaBadge = (sqm) =>
        `<div class="pay-area-badge">${fmtRai(sqm || 0)}</div>
         <div class="pay-area-sub">${Math.round(sqm || 0).toLocaleString('th-TH')} ตร.ม.</div>`;

    wrap.innerHTML = `
    <div class="table-responsive">
        <table class="table table-hover payment-table">
            <thead style="background:#e1f5fe !important;">
                <tr>
                    <th class="text-center align-middle" rowspan="2" style="width:36px">#</th>
                    <th class="align-middle" rowspan="2">ชื่อผู้ตรวจ</th>
                    <th class="text-center" rowspan="2">รายการ<br><small class="fw-normal text-muted">sub_id</small></th>
                    <th class="text-center" rowspan="2">แปลง<br><small class="fw-normal text-muted">ID</small></th>
                    <th class="text-center" colspan="3" style="border-bottom:2px solid #81d4fa;">พื้นที่ (ไร่ / ตร.ม.)</th>
                    <th class="text-end align-middle" rowspan="2">ค่าตรวจ<br><small class="fw-normal text-muted">${unitLabels[unit]}</small></th>
                </tr>
                <tr>
                    <th class="text-center" style="${isDeed   ? hl : ''}">📄 โฉนด</th>
                    <th class="text-center" style="${isClass  ? hl : ''}">🗂️ คลาส</th>
                    <th class="text-center" style="${isRubber ? hl : ''}">🌿 ยางพารา</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr class="payment-total-row">
                    <td colspan="4" class="fw-bold align-middle">รวมทั้งหมด
                        <span class="ms-2 text-muted fw-normal small">${totalSubplot.toLocaleString()} รายการ / ${totalPlot.toLocaleString()} แปลง</span>
                    </td>
                    <td class="text-center" style="${isDeed   ? hl : ''}">${areaBadge(totalDeedSqm)}</td>
                    <td class="text-center" style="${isClass  ? hl : ''}">${areaBadge(totalClassSqm)}</td>
                    <td class="text-center" style="${isRubber ? hl : ''}">${areaBadge(totalRubrSqm)}</td>
                    <td class="text-end fw-bold align-middle pay-total-amount">${totalPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                </tr>
            </tfoot>
        </table>
    </div>`;
}

document.getElementById('btnCalcChecker').addEventListener('click', renderCheckerPaymentTable);

document.getElementById('btnPrintChecker').addEventListener('click', () => {
    const tb   = document.getElementById('checkerPayModalTbBadge').textContent;
    const rate = document.getElementById('chk_rate_rai').value;
    const unit = document.getElementById('chk_unit').options[document.getElementById('chk_unit').selectedIndex].text;
    const tableHtml = document.getElementById('checkerPayTableWrap').innerHTML;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>สรุปค่าจ้างคนตรวจ – ${tb}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css">
<style>
  body { font-family: "Noto Sans Thai", sans-serif; padding: 20px; }
  .pay-avatar { width:28px; height:28px; border-radius:50%; object-fit:cover; }
  .pay-area-badge { font-size:0.85rem; font-weight:600; color:#01579b; }
  .pay-area-sub { font-size:0.72rem; color:#78909c; }
  .pay-amount { color:#01579b; }
  .pay-total-amount { color:#006064; font-size:1.1rem; }
  .payment-total-row { background:#e1f5fe !important; }
  @media print { button { display:none; } }
</style>
</head>
<body>
<h4 style="color:#01579b">สรุปค่าจ้างคนตรวจ – ${tb}</h4>
<p class="text-muted mb-3">อัตราค่าตรวจ: <strong>${rate} ${unit}</strong> &nbsp;|&nbsp; วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH', {day:'2-digit',month:'long',year:'numeric'})}</p>
${tableHtml}
<script>window.onload=()=>window.print();<\/script>
</body></html>`);
    win.document.close();
});

/* ── Bootstrap DOMContentLoaded: auth check → role guard → init ── */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/rub/auth/me');
        const { user } = await res.json();

        if (!user) {
            alert('กรุณา Login ก่อนเข้าใช้งานหน้า Admin');
            window.location.href = '/rub/index.html';
            return;
        }

        if (user.role !== 'admin') {
            alert(`คุณไม่มีสิทธิ์เข้าถึงหน้านี้ (Role: ${user.role || 'worker'})\nหน้านี้สำหรับ Admin เท่านั้น`);
            window.location.href = '/rub/index.html';
            return;
        }

        document.getElementById('chkLogin').value = 'true';
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

        document.getElementById('logout-link').addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await fetch('/rub/auth/logout');
                window.location.href = '/rub/index.html';
            } catch (err) {
                console.error('Logout failed:', err);
            }
        });

        await loadUsersCache();
        await initApp();
        await initUser();
    } catch (err) {
        console.error('Failed to fetch user:', err);
    }
});