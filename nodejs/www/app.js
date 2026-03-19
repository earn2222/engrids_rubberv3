const initUser = async () => {
    try {
        const response = await fetch(`/rub/api/users`);
        const result = await response.json();

        const usersDiv = document.getElementById('usersList');
        usersDiv.innerHTML = '';

        result.forEach(async (item) => {
            const img = document.createElement('img');
            img.className = 'rounded-circle me-2';
            img.style = 'width: 32px; height: 32px; object-fit: cover';
            img.src = item.photo

            const panel = document.createElement('div');
            panel.className = 'alert alert-dismissible alert-success';

            const username = document.createElement('span');
            username.innerHTML = `&nbsp;&nbsp;<strong>${item.display_name}</strong>`;

            panel.appendChild(img);
            panel.appendChild(username);
            usersDiv.appendChild(panel);
        });

    } catch (error) {
        console.error('Error initializing app:', error);
    }
};

const initApp = async () => {
    try {

        const response = await fetch('/rub/api/layerlist');
        const result = await response.json();

        const layerList = document.getElementById('layerList');
        layerList.innerHTML = ''; // clear existing

        await result.forEach((item, index) => {
            const { tb_name, remark } = item;
            const wrapper = document.createElement('div');
            wrapper.innerHTML = `
                <div class="alert alert-dismissible alert-info">
                    <strong>${index + 1}. ชื่อ layer: ${tb_name}</strong><br>
                    <div class="d-flex justify-content-between">
                        <div>
                            <button class="btn btn-secondary reshape" data-tb="${tb_name}">
                                ปรับรูปแปลง
                            </button>
                            <button class="btn btn-secondary dashboard" data-tb="${tb_name}">
                                Dashboard
                            </button>
                            <div class="dropdown d-inline-block mt-1">
                                <button class="btn btn-success dropdown-toggle layer-btn" type="button" id="dropdownMenuButton${tb_name}" data-bs-toggle="dropdown" aria-expanded="false">
                                    <i class="bi bi-download me-1"></i>Download ข้อมูล
                                </button>
                                <ul class="dropdown-menu premium-dropdown-menu" aria-labelledby="dropdownMenuButton${tb_name}">
                                    <li>
                                        <a class="dropdown-item reshape_download" href="javascript:void(0);" data-tb="${tb_name}">
                                            <div class="icon-wrapper"><i class="bi bi-file-earmark-text"></i></div>
                                            <span>Download แปลงยาง</span>
                                        </a>
                                    </li>
                                    <li>
                                        <a class="dropdown-item classify_download" href="javascript:void(0);" data-tb="${tb_name}">
                                            <div class="icon-wrapper"><i class="bi bi-file-earmark-check"></i></div>
                                            <span>Download reclassify</span>
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
                                            <span>Download Reclassify (ยางลงทะเบียน+ยางไม่ลงทะเบียน)</span>
                                        </a>
                                    </li>
                                </ul>
                            </div>
                            
                        </div>
                        <div>
                            <!--button class="btn btn-danger deleteBtn" data-tb="${tb_name}">
                                <i class="bi bi-trash3-fill"></i>
                            </button-->
                        </div>
                    </div>

                </div>
        `;
            layerList.appendChild(wrapper);
        });

        const reshape = document.getElementsByClassName('reshape');
        for (let i = 0; i < reshape.length; i++) {
            reshape[i].addEventListener('click', function (e) {
                e.preventDefault();
                const chkLogin = document.getElementById('chkLogin').value;
                if (chkLogin === 'false') {
                    alert('กรุณา Login ก่อนครับ');
                    return;
                }
                const tb = this.getAttribute('data-tb');
                window.location.href = `./reshape/index.html?tb=${tb}`;
            });
        }



        const dashboard = document.getElementsByClassName('dashboard');
        for (let i = 0; i < dashboard.length; i++) {
            dashboard[i].addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                window.location.href = `./reclassdash/index.html?tb=${tb}`;
            });
        }


        const reshape_download = document.getElementsByClassName('reshape_download');
        for (let i = 0; i < reshape_download.length; i++) {
            reshape_download[i].addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                fetch(`/rub/api/download/reshape/${tb}`)
                    .then(res => {
                        if (!res.ok) throw new Error(res.statusText);
                        return res.blob();
                    })
                    .then(blob => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${tb}.geojson`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                    })
                    .catch(err => console.error('Download failed:', err));
            });
        }

        const classify_download = document.getElementsByClassName('classify_download');
        for (let i = 0; i < classify_download.length; i++) {
            classify_download[i].addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                fetch(`/rub/api/download/reshape/v_reclass_${tb}`)
                    .then(res => {
                        if (!res.ok) throw new Error(res.statusText);
                        return res.blob();
                    })
                    .then(blob => {
                        const url = URL.createObjectURL(blob);
                        console.log(url);

                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `v_reclass_${tb}.geojson`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                    })
                    .catch(err => console.error('Download failed:', err));
            });
        }

        const classify_download_rubber = document.getElementsByClassName('classify_download_rubber');
        for (let i = 0; i < classify_download_rubber.length; i++) {
            classify_download_rubber[i].addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                fetch(`/rub/api/download/reshape/v_reclass_${tb}?type=rubber`)
                    .then(res => {
                        if (!res.ok) throw new Error(res.statusText);
                        return res.blob();
                    })
                    .then(blob => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `v_reclass_rubber_${tb}.geojson`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                    })
                    .catch(err => console.error('Download failed:', err));
            });
        }

        const classify_download_all_rubber = document.getElementsByClassName('classify_download_all_rubber');
        for (let i = 0; i < classify_download_all_rubber.length; i++) {
            classify_download_all_rubber[i].addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                fetch(`/rub/api/download/reshape/v_reclass_${tb}?type=all_rubber`)
                    .then(res => {
                        if (!res.ok) throw new Error(res.statusText);
                        return res.blob();
                    })
                    .then(blob => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `v_reclass_all_rubber_${tb}.geojson`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                    })
                    .catch(err => console.error('Download failed:', err));
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

                fetch(`/rub/api/layerlist/${tb}`, {
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

        const response = await fetch(`/rub/api/layerlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tb_name, remark })
        });

        const result = await response.json();

        const response_reclass = await fetch(`/rub/api/create_reclass_layer`, {
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