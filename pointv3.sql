select * from public.rayong_point_v3

-- เพิ่มคอลัมน์ใหม่ชื่อ farm_name ให้กับตาราง rayong_point_v3 โดยชนิดข้อมูลเป็น TEXT
ALTER TABLE public.rayong_point_v3
ADD COLUMN farm_name TEXT;

-- อัปเดตคอลัมน์ farm_name ด้วยการรวมค่าจาก titl_nam, f_name และ l_name
UPDATE public.rayong_point_v3
SET farm_name = CONCAT(titl_nam, f_name, ' ', l_name);

-- เพิ่มคอลัมน์ใหม่ชื่อ geom_point โดยชนิดข้อมูลเป็น geometry(POINT, 4326)
ALTER TABLE public.rayong_point_v3
ADD COLUMN geom_point geometry(POINT, 4326);

-- ตรวจสอบว่าคอลัมน์ geom ในตารางนี้ใช้ระบบพิกัดใด ถ้าเป็น 32647 ให้แปลงเป็น 4326 ในโค้ดถัดไป
SELECT DISTINCT ST_SRID(geom) FROM rayong_point_v3;

-- อัปเดตพิกัดในคอลัมน์ geom_point ให้เป็น4326
UPDATE rayong_point_v3
SET geom_point = ST_Transform(ST_SetSRID(geom, 32647), 4326);

-- ลบค่าข้อมูลพิกัดเดิมในคอลัมน์ geom โดยตั้งค่าให้เป็น NULL ทั้งหมด
UPDATE rayong_point_v3
SET geom = NULL

