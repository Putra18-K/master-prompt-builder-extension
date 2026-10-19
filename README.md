# Master Prompt Builder

Ekstensi Chrome (Manifest V3) untuk menyusun **Master Prompt** terstruktur dari ide mentah, menggunakan Gemini API.

Setiap prompt yang dihasilkan memakai enam bagian:

| Bagian | Isi |
|---|---|
| **Role** | Peran dan keahlian AI |
| **Task** | Tugas utama yang dikerjakan |
| **Context** | Latar belakang |
| **Reasoning** | Instruksi chain-of-thought |
| **Stop** | Batasan yang ketat |
| **Output** | Format hasil akhir |

## Fitur

- Membuat Master Prompt lengkap (6 bagian) pada pesan pertama di sebuah room.
- Pesan berikutnya dalam room yang sama merevisi bagian **Task, Context, dan Output** sesuai instruksi terbaru.
- Riwayat room chat tersimpan secara lokal dan bisa dibuka kembali atau dihapus.
- Tombol salin untuk setiap hasil.
- Pilihan model Gemini dan tingkat effort.
- Kirim dengan `Ctrl + Enter`.

## Instalasi

1. Clone repo ini:
```bash
   git clone https://github.com/USERNAME/NAMA-REPO.git
```
2. Buka `chrome://extensions`.
3. Aktifkan **Developer mode** (pojok kanan atas).
4. Klik **Load unpacked** dan pilih folder hasil clone.
5. Klik ikon ekstensi, lalu buka menu **API** dan masukkan Gemini API key Anda.

Dapatkan API key di [Google AI Studio](https://aistudio.google.com/apikey).

## Struktur proyek

```
├── manifest.json   # Konfigurasi ekstensi (Manifest V3)
├── popup.html      # Tampilan popup
├── popup.js        # Logika room, pemanggilan API, dan penyimpanan
└── icons/          # Ikon ekstensi (16, 32, 48, 128 px)
```

## Keamanan dan privasi

- API key disimpan di `chrome.storage.local` di browser Anda. Tidak ada server perantara.
- Isi prompt Anda dikirim langsung ke `generativelanguage.googleapis.com`. Tidak ada data yang dikirim ke pihak lain.
- Jangan commit API key ke repo. Jika key pernah ter-push, cabut dan buat yang baru.

## Stack

- HTML, CSS (Tailwind CSS via CDN), JavaScript vanilla
- Font Awesome untuk ikon
- Gemini API (`generateContent`)
