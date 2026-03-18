/* ================================================================
   Admin App  –  Two-step project workflow
   1) "สร้าง Project" → create empty table (no upload)
   2) "เพิ่มข้อมูล"   → upload shapefile (polygon / point) to existing table
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
            { name: 'จำนวนทั้งหมด',    y: parseInt(data.total),  color: '#7cb5ec' },
            { name: 'ปรับแก้เนื้อที่แล้ว', y: parseInt(data.reshp),  color: '#434348' },
            { name: 'classified แล้ว', y: parseInt(data.reclass), color: '#90ed7d' }
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

/* ── Render the layer list ── */
const initApp = async () => {
    try {
        const response = await fetch('/rub/api/layerlist');
        const result = await response.json();

        const layerList = document.getElementById('layerList');
        layerList.innerHTML = '';

        const promises = result.map(async (item, index) => {
            const { tb_name } = item;
            const wrapper = document.createElement('div');
            wrapper.innerHTML = `
                <div class="alert alert-dismissible alert-info mb-3">
                    <strong>${index + 1}. Layer: ${tb_name}</strong>
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
                        <button class="btn btn-success layer-btn reshape_download" data-tb="${tb_name}">
                            <i class="bi bi-download me-1"></i>Download แปลงยาง
                        </button>
                        <button class="btn btn-success layer-btn classify_download" data-tb="${tb_name}">
                            <i class="bi bi-download me-1"></i>Download reclassify
                        </button>
                        <button class="btn btn-danger layer-btn deleteBtn" data-tb="${tb_name}" title="ลบ layer">
                            <i class="bi bi-trash3-fill"></i>
                        </button>
                    </div>
                    <div class="mt-2 border" id="chart_${tb_name}"></div>
                </div>`;
            layerList.appendChild(wrapper);
            await showChart(tb_name, tb_name);
        });

        await Promise.all(promises);

        /* ── เพิ่มข้อมูล per-row button ── */
        document.querySelectorAll('.addDataBtn').forEach(btn => {
            btn.addEventListener('click', function () {
                const tb = this.getAttribute('data-tb');
                openAddDataModal(tb);
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

        /* ── Download แปลงยาง ── */
        document.querySelectorAll('.reshape_download').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/${tb}`, `${tb}.geojson`);
            });
        });

        /* ── Download reclassify ── */
        document.querySelectorAll('.classify_download').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}`, `v_reclass_${tb}.geojson`);
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
    if(cpProv) cpProv.value = '';
    if(cpPers) cpPers.value = '';
    if(cpRem) cpRem.value = '';
    document.getElementById('tableNamePreview').style.display = 'none';
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
    
    const province = provEl ? provEl.value.trim().toLowerCase().replace(/\s+/g, '_') : '';
    const person   = persEl ? persEl.value.trim().toLowerCase().replace(/\s+/g, '_') : '';
    const preview  = document.getElementById('tableNamePreview');
    const nameEl   = document.getElementById('previewTableName');

    if (province) {
        nameEl.textContent = person ? `${province}_${person}` : `${province}`;
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }
}

document.getElementById('btnCreateProject').addEventListener('click', async () => {
    const provEl = document.getElementById('cp_province');
    const persEl = document.getElementById('cp_person');
    const remEl  = document.getElementById('cp_remark');
    
    const province = provEl ? provEl.value.trim().toLowerCase().replace(/\s+/g, '_') : '';
    const person   = persEl ? persEl.value.trim().toLowerCase().replace(/\s+/g, '_') : '';
    const remark   = remEl ? remEl.value.trim() : '';

    if (!province) { alert('กรุณากรอกชื่อจังหวัด'); return; }

    const tb_name = person ? `${province}_${person}` : `${province}`;

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
            alert(`สร้าง Project "${tb_name}" เรียบร้อย`);
            createProjectModal.hide();
            initApp();
        } else {
            alert(`เกิดข้อผิดพลาด: ${data.error || 'Unknown error'}`);
        }
    } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>สร้าง Project';
    }
});

/* ═════════════════════════════════════════════════════════════
   MODAL 2 – เพิ่มข้อมูล (upload shapefile to existing table)
═════════════════════════════════════════════════════════════ */

let addDataModal = null;

function openAddDataModal(tb_name) {
    if (!addDataModal) {
        addDataModal = new bootstrap.Modal(document.getElementById('addDataModal'));
    }
    // reset
    document.getElementById('ad_tb_name').value  = tb_name;
    document.getElementById('ad_geom_type').value = '';
    document.getElementById('ad_shpFile').value   = '';
    document.getElementById('fileNameDisplay').style.display = 'none';
    document.getElementById('fileNameDisplay').textContent   = '';
    document.getElementById('ad_uploadProgress').style.display = 'none';
    document.getElementById('ad_progressBar').style.width = '0%';
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
const fileInput  = document.getElementById('ad_shpFile');

uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) setSelectedFile(file);
});

fileInput.addEventListener('change', function () {
    if (this.files[0]) setSelectedFile(this.files[0]);
});

function setSelectedFile(file) {
    const display = document.getElementById('fileNameDisplay');
    display.innerHTML = `
        <span><i class="bi bi-file-earmark-zip me-1"></i>${file.name}</span>
        <i class="bi bi-x-circle-fill btn-remove-file" id="btnRemoveFile" title="ลบไฟล์"></i>
    `;
    display.style.display = 'flex';

    document.getElementById('btnRemoveFile').addEventListener('click', () => {
        fileInput.value = '';
        display.innerHTML = '';
        display.style.display = 'none';
    });
    // Assign file to input (for browsers that support DataTransfer)
    try {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
    } catch (_) {}
}

/* Upload button */
document.getElementById('btnAddData').addEventListener('click', async () => {
    const tb_name   = document.getElementById('ad_tb_name').value.trim();
    const geom_type = document.getElementById('ad_geom_type').value;
    const shpFile   = fileInput.files[0];

    if (!geom_type) { alert('กรุณาเลือกประเภทข้อมูล (Polygon / Point)'); return; }
    if (!shpFile)   { alert('กรุณาเลือกไฟล์ ZIP ที่มี Shapefile'); return; }

    const formData = new FormData();
    formData.append('shpFile',   shpFile);
    formData.append('tb_name',   tb_name);
    formData.append('geom_type', geom_type);

    document.getElementById('ad_uploadProgress').style.display = 'block';
    document.getElementById('ad_progressBar').style.width = '0%';
    document.getElementById('ad_progressText').textContent = 'กำลังอัปโหลด...';

    const btn = document.getElementById('btnAddData');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังอัปโหลด...';

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            document.getElementById('ad_progressBar').style.width = pct + '%';
            document.getElementById('ad_progressText').textContent = `อัปโหลด ${pct}%`;
        }
    });

    xhr.addEventListener('load', () => {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-upload me-1"></i>อัปโหลดข้อมูล';

        try {
            const result = JSON.parse(xhr.responseText);
            if (xhr.status === 200 && result.success) {
                document.getElementById('ad_progressBar').style.width = '100%';
                document.getElementById('ad_progressText').textContent = 'อัปโหลดเสร็จแล้ว!';
                setTimeout(() => {
                    document.getElementById('ad_uploadProgress').style.display = 'none';
                    alert(`อัปโหลดสำเร็จ! ${result.recordCount} records (${geom_type})`);
                    addDataModal.hide();
                    initApp();
                }, 600);
            } else {
                document.getElementById('ad_uploadProgress').style.display = 'none';
                alert(`เกิดข้อผิดพลาด: ${result.error || 'Unknown error'}`);
            }
        } catch (parseErr) {
            document.getElementById('ad_uploadProgress').style.display = 'none';
            alert('เกิดข้อผิดพลาดในการประมวลผล');
        }
    });

    xhr.addEventListener('error', () => {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-upload me-1"></i>อัปโหลดข้อมูล';
        document.getElementById('ad_uploadProgress').style.display = 'none';
        alert('เกิดข้อผิดพลาดในการส่งข้อมูล (Network Error)');
    });

    xhr.open('POST', '/rub/api/upload-shapefile-to-table', true);
    xhr.send(formData);
});



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

        await initApp();
        await initUser();
    } catch (err) {
        console.error('Failed to fetch user:', err);
    }
});