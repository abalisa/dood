# Video Site Project

Proyek ini adalah situs web video statis yang dihosting di Cloudflare Pages dengan fungsionalitas serverless menggunakan Cloudflare Functions.

## Struktur Proyek

- `/public`: Berisi file statis (HTML, images, data).
- `/functions`: Berisi logika serverless (Cloudflare Functions).
- `wrangler.toml`: Konfigurasi untuk Cloudflare Wrangler.

## Cara Deploy ke Cloudflare

### 1. Melalui Cloudflare Dashboard (Direkomendasikan)

Metode ini paling mudah jika kode Anda ada di GitHub atau GitLab.

1.  Login ke [Cloudflare Dashboard](https://dash.cloudflare.com/).
2.  Buka **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
3.  Pilih repositori Anda.
4.  Di bagian **Build settings**:
    *   **Framework preset**: None
    *   **Build command**: (Kosongkan)
    *   **Build output directory**: `public`
5.  Klik **Save and Deploy**.
6.  Cloudflare akan secara otomatis mendeteksi folder `functions` dan men-deploy-nya sebagai Functions.

---

### 2. Melalui Wrangler CLI

Metode ini berguna untuk deployment manual langsung dari terminal.

1.  **Install Wrangler:**
    ```bash
    npm install -g wrangler
    ```

2.  **Login ke Cloudflare:**
    ```bash
    wrangler login
    ```

3.  **Deploy Proyek:**
    Jalankan perintah berikut di root direktori proyek:
    ```bash
    wrangler pages deploy ./public
    ```
    *Wrangler akan otomatis mengunggah isi folder `./public` dan memproses folder `functions` di root.*

---

## Pengembangan Lokal

Untuk menjalankan proyek secara lokal menggunakan Wrangler:

```bash
wrangler pages dev ./public
```
Proyek akan berjalan di `http://localhost:8788`.
## Otomatisasi Pembaruan Data

Skrip sedot.py ...
## Otomatisasi Pembaruan Data

Skrip `sedot.py` digunakan untuk mengambil dan memperbarui berkas JSON statis
di bawah `public/data`. Untuk menjaga data tetap up‑to‑date, jalankan skrip satu
kali setiap 24 jam. Ada dua pendekatan:

1. **Loop internal** – biarkan skrip terus berjalan dan tidur di antara pengambilan:
   ```bash
   python sedot.py --loop        # interval default 24 jam
   python sedot.py --loop 12     # interval 12 jam
   ```
   Skrip akan mencetak log ke terminal dan menulis timestamp terakhir ke file
   `last_fetch.txt`.

2. **Penjadwalan eksternal (cron/dll)** – gunakan scheduler sistem untuk memanggil
   skrip pada waktu yang Anda tentukan. Contoh cron:
   ```cron
   0 3 * * * /usr/bin/python3 /path/to/sedot.py >> /var/log/sedot.log 2>&1
   ```
   Ganti path dan jam sesuai kebutuhan.

Kedua metode akan menghasilkan file baru di `public/data`, lalu file tersebut
dapat dideploy kembali ke Cloudflare Pages.

### Otomasi dengan GitHub Actions

Anda juga bisa menyerahkan semua pekerjaan ke GitHub Actions sehingga
proses pengambil data dan commit berjalan di server GitHub setiap hari
(jadi Anda tidak perlu meninggalkan mesin sendiri berjalan atau membuka
Codespace). Berikut langkah umum:

1. Buat file workflow di `.github/workflows/update-data.yml` (contoh file
   sudah disediakan di repo).
2. Atur *schedule* (cron) di dalam workflow sesuai kebutuhan. Defaultnya
   adalah `0 3 * * *` (pukul 03:00 UTC setiap hari).
3. Pastikan skrip `sedot.py` dan dependensi (`aiohttp`) sudah berada di
   repo; workflow akan menginstalnya pada runner.
4. Workflow akan menjalankan `python sedot.py --sync`, mengidentifikasi
   perubahan di `public/data`, dan otomatis commit/push bila ada file
   baru atau ter-update.
5. (Opsional) tambahkan langkah setelah commit untuk menjalankan `wrangler
   pages deploy ./public` jika Anda ingin deployment Pages dilakukan
   langsung dari Actions. Gunakan secret `CF_API_TOKEN` untuk autentikasi.

Dengan pendekatan ini, data statis akan diperbarui setiap 24 jam (atau
interval lain yang ditentukan) dan commit hasilnya ke repository tanpa
intervensi manual.

