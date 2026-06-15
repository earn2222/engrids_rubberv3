const initUser = async () => {
    try {
        const response = await fetch(`/rub3/api/users`);
        if (!response.ok) { console.error('users API:', response.status); return; }
        const result = await response.json();
        if (!Array.isArray(result)) { console.error('users unexpected response:', result); return; }

        const usersDiv = document.getElementById('usersList');
        usersDiv.innerHTML = '';

        result.forEach(async (item) => {
            const panel = document.createElement('div');
            panel.className = 'alert alert-dismissible alert-success d-flex align-items-center mb-2';

            const avatarDiv = document.createElement('div');
            if (item.photo) {
                const img = document.createElement('img');
                img.className = 'rounded-circle me-2';
                img.style = 'width: 32px; height: 32px; object-fit: cover; border: 1px solid #ddd;';
                img.referrerPolicy = "no-referrer";
                img.src = item.photo;
                img.onerror = function () {
                    this.onerror = null;
                    this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.display_name)}&background=E9F5EC&color=2e7d32&rounded=true`;
                };
                avatarDiv.appendChild(img);
            } else {
                avatarDiv.innerHTML = `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(item.display_name)}&background=E9F5EC&color=2e7d32&rounded=true" class="rounded-circle me-2" style="width: 32px; height: 32px; object-fit: cover; border: 1px solid #ddd;">`;
            }

            const username = document.createElement('span');
            username.innerHTML = `<strong>${item.display_name}</strong>`;

            panel.appendChild(avatarDiv);
            panel.appendChild(username);
            usersDiv.appendChild(panel);
        });

    } catch (error) {
        console.error('Error initializing app:', error);
    }
};

/**
 * Show a selection modal for assignees before going to Reshape or Dashboard
 * - worker: auto-navigate ตรงไปที่ assignment ของตัวเอง
 * - admin: เห็นทุกคน เลือกได้ทุก assignment (ถ้ามีงานตัวเองจะมีปุ่ม "งานของฉัน" ด้วย)
 */
async function showAssigneeSelect(event, tb, targetType) {
    if (event) event.preventDefault();

    const chkLogin = document.getElementById('chkLogin').value;
    if (chkLogin === 'false') {
        alert('กรุณา Login ก่อนเข้าใช้งานส่วนนี้ครับ');
        return;
    }

    const role = window.currentUser?.role || 'worker';
    const subPath = targetType === 'reshape' ? 'reshape' : 'reclassdash';

    // Worker: ดึง assignment ของตัวเองและ navigate ตรง ไม่ต้องเปิด modal
    if (role === 'worker') {
        try {
            const res = await fetch(`/rub3/api/my-assignment/${tb}`);
            if (res.status === 401) {
                alert('Session หมดอายุ กรุณา Login ใหม่อีกครั้ง');
                window.location.reload();
                return;
            }
            const { data } = await res.json();
            if (data) {
                window.location.href = `./${subPath}/index.html?tb=${tb}&id_from=${data.id_from}&id_to=${data.id_to}&assignee=${encodeURIComponent(data.assignee_name)}`;
            } else {
                alert('คุณยังไม่ได้รับมอบหมายงานในโครงการนี้\nกรุณาติดต่อ Admin');
            }
        } catch (e) {
            alert('เกิดข้อผิดพลาดในการตรวจสอบงานที่ได้รับมอบหมาย');
        }
        return;
    }

    // Admin: แสดง modal เลือก
    const modalEl = document.getElementById('selectionModal');
    const listEl = document.getElementById('assigneeList');
    if (!modalEl || !listEl) return;

    const modal = new bootstrap.Modal(modalEl);
    listEl.innerHTML = `
        <div class="text-center py-4">
            <div class="spinner-border text-primary spinner-border-sm" role="status"></div>
            <div class="mt-2 small text-muted">กำลังเรียกรายชื่อผู้ได้รับมอบหมาย...</div>
        </div>
    `;
    modal.show();

    try {
        const response = await fetch(`/rub3/api/task-progress/${tb}`);
        const { data } = await response.json();

        if (!data || data.length === 0) {
            listEl.innerHTML = `
                <div class="alert alert-warning border-0 small mb-4" style="border-radius: 12px; background: rgba(255,193,7, 0.1);">
                    <i class="bi bi-exclamation-triangle-fill me-2"></i>โครงการนี้ยังไม่มีการมอบหมายงาน
                </div>
                <button class="btn btn-primary-premium rounded-pill w-100 py-2 shadow-sm" onclick="window.location.href='./${subPath}/index.html?tb=${tb}'">ไปต่อโดยไม่ระบุชื่อ (ดูทั้งหมด)</button>
            `;
            return;
        }

        listEl.innerHTML = '';
        const myEmail = (window.currentUser?.email || '').toLowerCase();

        const totalDone = data.reduce((acc, item) => acc + (item.done || 0), 0);
        const totalTotal = data.reduce((acc, item) => acc + (item.total || 0), 0);
        const totalPct = totalTotal > 0 ? Math.round((totalDone / totalTotal) * 100) : 0;

        // ถ้า admin มี assignment ของตัวเอง ให้แสดงปุ่ม "งานของฉัน" ก่อน
        const myItem = myEmail ? data.find(item => item.assignee_email && item.assignee_email.toLowerCase() === myEmail) : null;
        if (myItem) {
            const myBtn = document.createElement('button');
            myBtn.className = 'btn w-100 text-start d-flex align-items-center mb-2 px-3 py-2 border-0 shadow-sm';
            myBtn.style.cssText = 'border-radius:15px; background:linear-gradient(135deg,#5ea36a,#4a7c59); box-shadow:0 4px 12px rgba(74,124,89,0.3);';
            myBtn.innerHTML = `
                <div class="rounded-circle d-flex align-items-center justify-content-center text-white me-3"
                     style="width:42px;height:42px;background:rgba(255,255,255,0.2);">
                    <i class="bi bi-person-fill" style="font-size:1.2rem;"></i>
                </div>
                <div class="flex-grow-1">
                    <div class="fw-bold text-white" style="font-size:0.9rem;">งานของฉัน</div>
                    <div class="text-white-50" style="font-size:0.72rem;">ID ${myItem.id_from}–${myItem.id_to} · ${myItem.done||0}/${myItem.total||0} แปลง · ${myItem.pct||0}%</div>
                </div>
                <i class="bi bi-chevron-right text-white ms-2" style="font-size:1.1rem;"></i>
            `;
            myBtn.onclick = () => {
                modal.hide();
                window.location.href = `./${subPath}/index.html?tb=${tb}&id_from=${myItem.id_from}&id_to=${myItem.id_to}&assignee=${encodeURIComponent(myItem.assignee_name)}`;
            };
            listEl.appendChild(myBtn);
        }

        // "ดูทั้งหมด" ปุ่ม
        const allOption = document.createElement('button');
        allOption.className = `btn btn-item-premium w-100 text-start d-flex align-items-center mb-2 px-3 py-2 border-0 shadow-sm`;
        allOption.style.cssText = 'border-radius:15px; background:linear-gradient(135deg,#ffffff,#f9fbf9);';
        allOption.innerHTML = `
            <div class="d-flex align-items-center w-100">
                <div class="rounded-circle d-flex align-items-center justify-content-center text-white me-3"
                     style="width:42px;height:42px;background:linear-gradient(135deg,#6b9c75,#4a7c59);">
                    <i class="bi bi-people-fill" style="font-size:1.2rem;"></i>
                </div>
                <div class="flex-grow-1">
                    <div class="d-flex justify-content-between align-items-end">
                        <div class="fw-bold" style="color:#2d3e2d;">ดูทั้งหมด</div>
                        <div class="small fw-bold" style="color:#4a7c59;">${totalPct}%</div>
                    </div>
                    <div class="progress mt-1 mb-1" style="height:6px;border-radius:10px;background:rgba(74,124,89,0.1);">
                        <div class="progress-bar" style="width:${totalPct}%;background:#5ea36a;border-radius:10px;"></div>
                    </div>
                    <div class="small" style="color:#6a8c6a;font-size:0.75rem;">ภาพรวม (${totalDone}/${totalTotal} แปลง)</div>
                </div>
            </div>
            <i class="bi bi-chevron-right ms-2" style="color:#4a7c59;font-size:1.1rem;"></i>
        `;
        allOption.onclick = () => { modal.hide(); window.location.href = `./${subPath}/index.html?tb=${tb}&view=all`; };
        listEl.appendChild(allOption);

        data.forEach(item => {
            const isMe = myEmail && item.assignee_email && item.assignee_email.toLowerCase() === myEmail;
            const btn = document.createElement('button');
            btn.className = `btn w-100 text-start d-flex align-items-center mb-2 px-3 py-2 border-0 shadow-sm`;
            btn.style.cssText = `border-radius:15px; background:${isMe ? 'linear-gradient(135deg,#5ea36a,#4a7c59)' : '#ffffff'}; ${isMe ? 'box-shadow:0 6px 15px rgba(74,124,89,0.25);' : ''}`;

            const avatarHtml = item.assignee_photo
                ? `<img src="${item.assignee_photo}" referrerpolicy="no-referrer" class="rounded-circle me-3" style="width:42px;height:42px;object-fit:cover;border:2px solid ${isMe ? 'rgba(255,255,255,0.6)' : '#f1f7f1'}" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(item.assignee_name)}&background=E9F5EC&color=2e7d32&rounded=true';">`
                : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(item.assignee_name)}&background=E9F5EC&color=2e7d32&rounded=true" class="rounded-circle me-3" style="width:42px;height:42px;object-fit:cover;border:2px solid ${isMe ? 'rgba(255,255,255,0.6)' : '#f1f7f1'};">`;

            const emailLine = item.assignee_email
                ? `<div class="small ${isMe ? 'text-white-50' : 'text-muted'}" style="font-size:0.68rem;">${item.assignee_email}</div>`
                : '';

            btn.innerHTML = `
                <div class="d-flex align-items-center w-100">
                    ${avatarHtml}
                    <div class="flex-grow-1">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <span class="fw-bold ${isMe ? 'text-white' : ''}" style="${!isMe ? 'color:#2d3e2d;' : ''}">
                                    ${item.assignee_name}
                                    ${isMe ? '<span class="badge bg-white text-success ms-1" style="font-size:0.65rem;padding:2px 6px;border-radius:8px;">คุณ</span>' : ''}
                                </span>
                                ${emailLine}
                            </div>
                            <div class="small fw-bold ${isMe ? 'text-white' : ''}" style="${!isMe ? 'color:#4a7c59;' : ''}font-size:0.85rem;">${item.pct || 0}%</div>
                        </div>
                        <div class="progress mt-1 mb-1" style="height:4px;border-radius:10px;background:${isMe ? 'rgba(255,255,255,0.2)' : 'rgba(74,124,89,0.08)'};">
                            <div class="progress-bar" style="width:${item.pct || 0}%;background:${isMe ? '#fff' : '#5ea36a'};border-radius:10px;"></div>
                        </div>
                        <div class="d-flex justify-content-between small ${isMe ? 'text-white-50' : 'text-muted'}" style="font-size:0.7rem;">
                            <span>ID: ${item.id_from}-${item.id_to}</span>
                            <span>เสร็จแล้ว ${item.done || 0}/${item.total || 0}</span>
                        </div>
                    </div>
                </div>
                <i class="bi bi-chevron-right ms-2" style="${isMe ? 'color:rgba(255,255,255,0.8);' : 'color:#4a7c59;'}font-size:1.1rem;"></i>
            `;
            btn.onclick = () => {
                modal.hide();
                const url = `./${subPath}/index.html?tb=${tb}&id_from=${item.id_from}&id_to=${item.id_to}&assignee=${encodeURIComponent(item.assignee_name)}`;
                window.location.href = url;
            };
            listEl.appendChild(btn);
        });

    } catch (error) {
        console.error('Error loading assignees:', error);
        listEl.innerHTML = '<div class="text-danger small text-center p-3">ไม่สามารถโหลดข้อมูลผู้รับผิดชอบได้</div>';
    }
}


/* ── Load assignments for home project cards ── */
async function loadAssignmentHome(tb_name) {
    const el = document.getElementById(`assign_home_${tb_name}`);
    if (!el) return;

    try {
        const res = await fetch(`/rub3/api/task-progress/${tb_name}`);
        const { data } = await res.json();
        const myName = document.getElementById('display-name')?.textContent || '';

        if (!data || data.length === 0) {
            el.innerHTML = '<div class="text-muted" style="font-size:0.75rem;">(ยังไม่มีการมอบหมายงาน)</div>';
            return;
        }

        const myTask = data.find(d => d.assignee_name && d.assignee_name.toLowerCase().includes(myName.toLowerCase()));

        el.innerHTML = `
            <div class="ah-title"><i class="bi bi-people-fill me-1"></i> รายชื่อผู้รับผิดชอบและความคืบหน้า</div>
            <div class="ah-list">
                ${data.map(d => {
            const avatarHtml = d.assignee_photo
                ? `<img src="${d.assignee_photo}" referrerpolicy="no-referrer" class="ha-avatar" style="border: 1px solid #eee;" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(d.assignee_name)}&background=E9F5EC&color=2e7d32&rounded=true';">`
                : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(d.assignee_name)}&background=E9F5EC&color=2e7d32&rounded=true" class="ha-avatar" style="border: 1px solid #eee;">`;

            return `
                    <div class="home-assignee-card shadow-sm" onclick="showAssigneeSelect(event, '${tb_name}', 'reshape')">
                        <div class="d-flex align-items-center mb-1">
                            ${avatarHtml}
                            <span class="fw-bold text-truncate" style="max-width: 100px;">${d.assignee_name}</span>
                            <span class="ms-auto fw-bold" style="font-size: 0.7rem; color: #4a7c59;">${d.pct || 0}%</span>
                        </div>
                        <div class="progress" style="height: 4px; border-radius: 10px; background-color: rgba(74, 124, 89, 0.1); margin-bottom: 4px;">
                            <div class="progress-bar" role="progressbar" style="width: ${d.pct || 0}%; background: #5ea36a; border-radius: 10px;" 
                                 aria-valuenow="${d.pct || 0}" aria-valuemin="0" aria-valuemax="100"></div>
                        </div>
                        <span class="ha-range" style="font-size: 0.65rem;">ID ${d.id_from}-${d.id_to} (${d.done}/${d.total})</span>
                    </div>`;

        }).join('')}
            </div>
        `;

    } catch (e) {
        console.error('loadAssignmentHome error:', e);
    }
}

const initApp = async () => {
    try {

        const response = await fetch('/rub3/api/layerlist');
        if (!response.ok) { console.error('layerlist API:', response.status); return; }
        const result = await response.json();
        if (!Array.isArray(result)) { console.error('layerlist unexpected response:', result); return; }

        const layerList = document.getElementById('layerList');
        layerList.innerHTML = ''; // clear existing

        const promises = result.map(async (item, index) => {
            const { tb_name } = item;
            const wrapper = document.createElement('div');
            wrapper.innerHTML = `
                <div class="alert alert-dismissible alert-info shadow-sm mb-3 border-0 project-card-premium">
                    <div class="d-flex justify-content-between align-items-center mb-3">

                        <strong style="color: #2e7d32; font-size: 1.4rem;"><i class="bi bi-folder-fill text-warning me-2"></i>${index + 1}. โครงการ: ${tb_name}</strong>
                    </div>
                    
                    <div class="d-flex flex-wrap gap-2 mb-3">
                        <button class="btn btn-secondary reshape btn-sm px-3" data-tb="${tb_name}" style="background-color: #5c727d; border-color: #5c727d;">
                            <i class="bi bi-pencil-square me-1"></i>ปรับรูปแปลง
                        </button>
                        <button class="btn btn-secondary dashboard-btn btn-sm px-3" data-tb="${tb_name}" style="background-color: #5c727d; border-color: #5c727d;">
                            <i class="bi bi-graph-up-arrow me-1"></i>Dashboard
                        </button>
                        <div class="dropdown d-inline-block">
                            <button class="btn btn-success dropdown-toggle btn-sm px-3" type="button" id="dropdownMenuButton${tb_name}" data-bs-toggle="dropdown" aria-expanded="false" style="background-color: #43a047; border-color: #43a047;">
                                <i class="bi bi-download me-1"></i>Download ข้อมูล
                            </button>

                            <ul class="dropdown-menu premium-dropdown-menu shadow-lg border-0" style="border-radius: 12px;" aria-labelledby="dropdownMenuButton${tb_name}">
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
                    </div>

                    <!-- Assignment Section -->
                    <div class="assignment-home-section" id="assign_home_${tb_name}"></div>
                </div>
            `;
            layerList.appendChild(wrapper);
            await loadAssignmentHome(tb_name);
        });

        await Promise.all(promises);

        // Event listeners for premium buttons
        const reshapeBtns = document.querySelectorAll('.reshape');
        reshapeBtns.forEach(btn => {
            btn.onclick = (e) => {
                const tb = btn.getAttribute('data-tb');
                showAssigneeSelect(e, tb, 'reshape');
            };
        });

        const dashboardBtns = document.querySelectorAll('.dashboard-btn');
        dashboardBtns.forEach(btn => {
            btn.onclick = (e) => {
                const tb = btn.getAttribute('data-tb');
                showAssigneeSelect(e, tb, 'dashboard');
            };
        });



        const reshape_download = document.getElementsByClassName('reshape_download');
        for (let i = 0; i < reshape_download.length; i++) {
            reshape_download[i].addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub3/api/download/reshape/${tb}`, `pacel_yang_${tb}.geojson`);
            });
        }

        const classify_download = document.getElementsByClassName('classify_download');
        for (let i = 0; i < classify_download.length; i++) {
            classify_download[i].addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub3/api/download/reshape/v_reclass_${tb}`, `v_reclass_LU_${tb}.geojson`);
            });
        }

        const classify_download_rubber = document.getElementsByClassName('classify_download_rubber');
        for (let i = 0; i < classify_download_rubber.length; i++) {
            classify_download_rubber[i].addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub3/api/download/reshape/v_reclass_${tb}?type=rubber`, `v_reclass_rubber_${tb}.geojson`);
            });
        }

        const classify_download_all_rubber = document.getElementsByClassName('classify_download_all_rubber');
        for (let i = 0; i < classify_download_all_rubber.length; i++) {
            classify_download_all_rubber[i].addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub3/api/download/reshape/v_reclass_${tb}?type=rubber_and_ex`, `v_reclass_rubber_ex_${tb}.geojson`);
            });
        }

        const download_all = document.getElementsByClassName('download_all');
        for (let i = 0; i < download_all.length; i++) {
            download_all[i].addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub3/api/download/reshape/${tb}`, `pacel_yang_${tb}.geojson`);
                downloadFile(`/rub3/api/download/reshape/v_reclass_${tb}`, `v_reclass_LU_${tb}.geojson`);
                downloadFile(`/rub3/api/download/reshape/v_reclass_${tb}?type=rubber`, `v_reclass_rubber_${tb}.geojson`);
                downloadFile(`/rub3/api/download/reshape/v_reclass_${tb}?type=rubber_and_ex`, `v_reclass_rubber_ex_${tb}.geojson`);
            });
        }

        const deleteBtn = document.getElementsByClassName('deleteBtn');
        for (let i = 0; i < deleteBtn.length; i++) {
            deleteBtn[i].addEventListener('click', function (e) {
                e.preventDefault();
                const chkLogin = document.getElementById('chkLogin').value;
                if (chkLogin === 'false') {
                    alert('กรุณา Login ก่อนครับ');
                    return;
                }
                const tb = this.getAttribute('data-tb');

                fetch(`/rub3/api/layerlist/${tb}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' }
                })
                    .then(res => {
                        if (!res.ok) throw new Error(res.statusText);
                        return res.json();
                    })
                    .then(result => {
                        if (result.success) {
                            alert(`ลบ ${tb} เรียบร้อย`);
                            initApp();
                        } else {
                            alert(`เกิดข้อผิดพลาด`);
                        }
                    })
                    .catch(err => console.error('Delete failed:', err));
            });
        }
    } catch (error) {
        console.error('Error initializing app:', error);
    }
};

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

// document.getElementById("addData").addEventListener("click", () => {
//     try {
//         const modal = document.getElementById("addModal");
//         if (modal) {
//             const bsModal = new bootstrap.Modal(modal);
//             bsModal.show();
//         } else {
//             console.error(`Modal with ID ${modalId} not found.`);
//         }
//     } catch (error) {
//         console.error('Failed to fetch user:', err);
//     }
// })

document.getElementById('btnAdd').addEventListener("click", async () => {
    try {
        const tb_name = document.getElementById("tb_name").value;
        const remark = document.getElementById("tb_remark");

        const response = await fetch(`/rub3/api/layerlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tb_name, remark })
        });

        const result = await response.json();

        const response_reclass = await fetch(`/rub3/api/create_reclass_layer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tb: tb_name })
        });

        const result_reclass = await response_reclass.json();

        if (result.success) {
            document.getElementById("tb_name").value = "";
            document.getElementById("tb_remark").value = "";
            alert(`อัพเดท features ${result.updated} เรียบร้อย`);
            await initApp();
        } else {
            alert(`เกิดข้อผิดพลาด`);
        }

    } catch (error) {
        console.error('Failed to fetch user:', err);
    }
})

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/rub3/auth/me');
        const { user } = await res.json();

        window.currentUser = user || null;
        document.getElementById('chkLogin').value = user ? 'true' : 'false';

        if (user) {
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

            // แสดง role badge
            const roleBadgeColors = { admin: '#dc3545', worker: '#198754' };
            const roleEl = document.createElement('span');
            roleEl.className = 'badge ms-2';
            roleEl.style.cssText = `background:${roleBadgeColors[user.role] || '#198754'};font-size:0.65rem;vertical-align:middle;`;
            roleEl.textContent = user.role || 'worker';
            document.getElementById('display-name').after(roleEl);

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
        await initApp();
        await initUser();
    } catch (err) {
        console.error('Failed to fetch user:', err);
    }
});