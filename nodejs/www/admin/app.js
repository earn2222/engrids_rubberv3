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

const showChart = async (tb, div) => {
    try {
        const response = await fetch('/rub/api/countsfeatures/' + tb);
        const data = await response.json();

        const chartData = [
            { name: 'จำนวนทั้งหมด', y: parseInt(data.total), color: '#7cb5ec' },
            { name: 'ปรับแก้เนื้อที่แล้ว', y: parseInt(data.reshp), color: '#434348' },
            { name: 'classified แล้ว', y: parseInt(data.reclass), color: '#90ed7d' }
        ];

        Highcharts.chart('chart_' + div, {
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
    } catch (error) {
        console.error('Error initializing app:', error);

    }
}

const initApp = async () => {
    try {

        const response = await fetch('/rub/api/layerlist');
        const result = await response.json();

        const layerList = document.getElementById('layerList');
        layerList.innerHTML = ''; // clear existing

        const promises = result.map(async (item, index) => {
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
                            <button class="btn btn-success reshape_download" data-tb="${tb_name}">
                                Download แปลงยาง
                            </button>
                            <button class="btn btn-success classify_download" data-tb="${tb_name}">
                                Download reclassify
                            </button>
                        </div>
                        <div>
                            <button class="btn btn-danger deleteBtn" data-tb="${tb_name}">
                                <i class="bi bi-trash3-fill"></i>
                            </button>
                        </div>
                    </div>
                    <div class="mt-2 border" id="chart_${tb_name}" ></div>

                </div> `;
            layerList.appendChild(wrapper);
            await showChart(tb_name, tb_name);
        });

        await Promise.all(promises);

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
                window.location.href = `./../reshape/index.html?tb=${tb}`;
            });
        }

        const dashboard = document.getElementsByClassName('dashboard');
        for (let i = 0; i < dashboard.length; i++) {
            dashboard[i].addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                window.location.href = `./../reclassdash/index.html?tb=${tb}`;
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

document.getElementById("addData").addEventListener("click", () => {
    try {
        const modal = document.getElementById("addModal");
        if (modal) {
            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();
        } else {
            console.error(`Modal with ID ${modalId} not found.`);
        }
    } catch (error) {
        console.error('Failed to fetch user:', err);
    }
})

document.getElementById('btnAdd').addEventListener("click", async () => {
    try {
        const province = document.getElementById("province").value.trim();
        const person_name = document.getElementById("person_name").value.trim();
        const geom_type = document.getElementById("geom_type").value;
        const remark = document.getElementById("tb_remark").value;
        const shpFile = document.getElementById("shpFile").files[0];

        // Validation
        if (!province) {
            alert('กรุณากรอกชื่อจังหวัด');
            return;
        }
        if (!person_name) {
            alert('กรุณากรอกชื่อบุคคล');
            return;
        }
        if (!geom_type) {
            alert('กรุณาเลือกประเภทข้อมูล');
            return;
        }

        // Create table name: tb_[province]_[person_name]
        const tb_name = `tb_${province}_${person_name}`.toLowerCase();

        if (!shpFile) {
            alert('กรุณาเลือกไฟล์ Shapefile');
            return;
        }

        // Upload shapefile
        const formData = new FormData();
        formData.append('shpFile', shpFile);
        formData.append('tb_name', tb_name);
        formData.append('geom_type', geom_type);
        formData.append('remark', remark);

        document.getElementById('uploadProgress').style.display = 'block';
        document.getElementById('progressBar').style.width = '0%';

        const xhr = new XMLHttpRequest();

        // Track progress
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                document.getElementById('progressBar').style.width = percentComplete + '%';
                document.getElementById('progressText').textContent = `อัปโหลด ${Math.round(percentComplete)}%`;
            }
        });

        xhr.addEventListener('load', async () => {
            try {
                const shpResult = JSON.parse(xhr.responseText);

                if (xhr.status === 200 && shpResult.success) {
                    // 1. อัปโหลด SHP สำเร็จ
                    document.getElementById('progressText').textContent = 'กำลังสร้าง layer...';
                    document.getElementById('progressBar').style.width = '75%';

                    document.getElementById('progressBar').style.width = '100%';

                    // Clear form
                    document.getElementById("province").value = "";
                    document.getElementById("person_name").value = "";
                    document.getElementById("geom_type").value = "";
                    document.getElementById("tb_remark").value = "";
                    document.getElementById("shpFile").value = "";

                    setTimeout(() => {
                        document.getElementById('uploadProgress').style.display = 'none';
                        alert(`สร้าง ${tb_name} เรียบร้อย (${shpResult.recordCount} records, ประเภท: ${geom_type})`);
                        initApp();
                    }, 500);
                } else {
                    const errorMsg = shpResult.error || 'Unknown error';
                    alert(`เกิดข้อผิดพลาดในการอัปโหลด: ${errorMsg}`);
                    document.getElementById('uploadProgress').style.display = 'none';
                    console.error('Upload error:', shpResult);
                }
            } catch (parseErr) {
                console.error('Parse error:', parseErr, 'Response:', xhr.responseText);
                alert(`เกิดข้อผิดพลาดในการประมวลผล: ${parseErr.message}`);
                document.getElementById('uploadProgress').style.display = 'none';
            }
        });

        xhr.addEventListener('error', () => {
            alert('เกิดข้อผิดพลาดในการอัปโหลด (Network Error)');
            document.getElementById('uploadProgress').style.display = 'none';
            console.error('XHR error');
        });

        xhr.addEventListener('abort', () => {
            alert('การอัปโหลดถูกยกเลิก');
            document.getElementById('uploadProgress').style.display = 'none';
        });

        xhr.open('POST', '/rub/api/upload-shapefile', true);
        xhr.send(formData);

    } catch (error) {
        console.error('Failed:', error);
        alert(`เกิดข้อผิดพลาด: ${error.message}`);
        document.getElementById('uploadProgress').style.display = 'none';
    }
})

document.getElementById('exportSqlBtn').addEventListener('click', () => {
    window.location.href = '/rub/api/export-sql';
});

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