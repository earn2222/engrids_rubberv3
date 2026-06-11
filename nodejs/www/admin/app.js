/* ================================================================
   Admin App  –  Two-step project workflow
   1) "สร้าง Project" → create empty table (no upload)
   2) "เพิ่มข้อมูล"   → upload shapefile (polygon / point) to existing table
   3) "มอบหมายงาน"  → assign ID ranges to team members
================================================================ */

/* ── Initialise logged-in users list ── */
const initUser = async () => {
    try {
        const response = await fetch(`/rub/api/users`);
        const result = await response.json();

        const usersDiv = document.getElementById('usersList');
        usersDiv.innerHTML = '';

        result.forEach(item => {
            const img = document.createElement('img');
            img.className = 'rounded-circle me-2';
            img.style = 'width: 32px; height: 32px; object-fit: cover';
            img.src = item.photo;

            const panel = document.createElement('div');
            panel.className = 'alert alert-dismissible alert-success';

            const username = document.createElement('span');
            username.innerHTML = `&nbsp;&nbsp;<strong>${item.display_name}</strong>`;

            panel.appendChild(img);
            panel.appendChild(username);
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
                    <strong>${index + 1}. Layer: ${tb_name.toUpperCase()}</strong>
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

/* ── Render assignee picker จาก users table ── */
function renderAssigneePicker(selectedName) {
    const picker = document.getElementById('assigneePicker');
    picker.innerHTML = '';

    if (allUsers.length === 0) {
        picker.innerHTML = '<small class="text-muted">ไม่มีผู้ใช้ในระบบ (ใช้ช่องพิมพ์ด้านล่างแทน)</small>';
        return;
    }

    allUsers.forEach(u => {
        const chip = document.createElement('div');
        chip.className = 'assignee-chip';
        if (selectedName === u.display_name) chip.classList.add('selected');
        chip.dataset.name = u.display_name;
        chip.dataset.photo = u.photo || '';
        chip.innerHTML = `
            <img src="${u.photo || ''}" onerror="this.style.display='none'">
            <span>${u.display_name}</span>
        `;
        chip.addEventListener('click', () => {
            document.querySelectorAll('.assignee-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            document.getElementById('assign_name').value = u.display_name;
            document.getElementById('assign_photo').value = u.photo || '';
            document.getElementById('assign_name_manual').value = '';
        });
        picker.appendChild(chip);
    });
}

/* ── Reset form ── */
function resetAssignForm() {
    document.getElementById('assign_id').value = '';
    document.getElementById('assign_name').value = '';
    document.getElementById('assign_photo').value = '';
    document.getElementById('assign_name_manual').value = '';
    document.getElementById('assign_id_from').value = '';
    document.getElementById('assign_id_to').value = '';
    document.getElementById('assign_note').value = '';
    document.getElementById('assignFormTitle').innerHTML = '<i class="bi bi-plus-circle me-1"></i>เพิ่มการมอบหมายงานใหม่';
    document.getElementById('btnCancelAssignEdit').style.display = 'none';
    document.querySelectorAll('.assignee-chip').forEach(c => c.classList.remove('selected'));
}

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
                    ? `<img src="${d.assignee_photo}" class="assign-avatar" onerror="this.style.display='none'">`
                    : `<div class="assign-avatar-placeholder" style="background:${color};">${d.assignee_name.charAt(0).toUpperCase()}</div>`
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
                document.getElementById('assign_photo').value = d.assignee_photo || '';
                document.getElementById('assign_name_manual').value = '';
                document.getElementById('assign_id_from').value = d.id_from;
                document.getElementById('assign_id_to').value = d.id_to;
                document.getElementById('assign_note').value = d.note || '';
                document.getElementById('assignFormTitle').innerHTML =
                    '<i class="bi bi-pencil-fill me-1"></i>แก้ไขการมอบหมายงาน';
                document.getElementById('btnCancelAssignEdit').style.display = 'inline-flex';

                // Highlight chip
                renderAssigneePicker(d.assignee_name);

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
    let name = document.getElementById('assign_name').value.trim();
    const nameManual = document.getElementById('assign_name_manual').value.trim();
    const photo = document.getElementById('assign_photo').value.trim();
    const id_from = document.getElementById('assign_id_from').value;
    const id_to = document.getElementById('assign_id_to').value;
    const note = document.getElementById('assign_note').value.trim();

    // ถ้าพิมพ์ชื่อเองให้ใช้
    if (!name && nameManual) name = nameManual;

    if (!name) { alert('กรุณาเลือกหรือพิมพ์ชื่อผู้รับผิดชอบ'); return; }
    if (!id_from || !id_to) { alert('กรุณากรอก ID เริ่มต้น และ ID สิ้นสุด'); return; }
    if (parseInt(id_from) > parseInt(id_to)) { alert('ID เริ่มต้นต้องไม่มากกว่า ID สิ้นสุด'); return; }

    const btn = document.getElementById('btnSaveAssign');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังบันทึก...';

    try {
        let res;
        if (assignId) {
            // Update
            res = await fetch(`/rub/api/task-assignments/${assignId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assignee_name: name, assignee_photo: photo, id_from, id_to, note })
            });
        } else {
            // Create
            res = await fetch(`/rub/api/task-assignments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tb_name, assignee_name: name, assignee_photo: photo, id_from, id_to, note })
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


/* ── Bootstrap DOMContentLoaded: auth check → init ── */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/rub/auth/me');
        const { user } = await res.json();

        document.getElementById('chkLogin').value = user ? 'true' : 'false';

        if (user) {
            document.getElementById('google-login-link').style.display = 'none';
            document.getElementById('profile-section').style.display = 'flex';
            document.getElementById('profile-image').src = user.photo;
            document.getElementById('display-name').textContent = user.displayName;

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

        await loadUsersCache();
        await initApp();
        await initUser();
    } catch (err) {
        console.error('Failed to fetch user:', err);
    }
});