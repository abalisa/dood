# sedot.py
import asyncio
import json
import os
import time
import random
import re
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional
import sys
import urllib.parse
import argparse  # for command line options

# Try to import aiohttp, install if not available
try:
    import aiohttp
except ImportError:
    print("📦 Installing aiohttp...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "aiohttp"])
    import aiohttp

# ============================================================================
# CONSTANTS AND CONFIGURATION
# ============================================================================

DATA_PER_PAGE = 200
MAX_INDEXED_VIDEOS = 10000  # Maksimal video untuk search index
SEARCH_PREFIX_LEN = 2
PREFIX2_LIMIT = 500

CONFIGS = {
    'doodstream': {
        'api_url': 'https://doodapi.com/api/file/list',
        'api_key': '112623ifbcbltzajwjrpjx',
        'per_page': 200,
        'request_delay': 0.5,
        'max_retries': 3,
        'concurrent_requests': 5
    },
    'lulustream': {
        'api_url': 'https://api.lulustream.com/api/file/list',
        'api_key': '37943j35tc5i1bg3gje5y',
        'per_page': 500,
        'request_delay': 0.5,
        'max_retries': 3,
        'concurrent_requests': 5
    }
}

# ============================================================================
# BLOCKED TITLE PATTERNS - Skip videos matching these patterns
# ============================================================================

BLOCKED_TITLE_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r'anak\s+kecil',
        r'bocil',
        r'pedofil',
        r'\bsd\b',
        r'bawah\s+umur',
        r'dibawah\s+umur',
        r'kids?',
        r'child',
        r'bayi',
        r'balita',
        r'toddler',
        r'baby',
        r'junior',
        r'pre-?school',
        r'paud',
        r'tk',
        r'sd\s+kelas',
        r'sekolah\s+dasar',
        r'childhood',
        r'teen',
        r'belia',
        r'underage',
        r'minor',
        r'pemerkosaan',
        r'incest',
        r'sodomi',
        r'kekerasan\s+anak',
    ]
]

# ============================================================================
# DATA NORMALIZER CLASS
# ============================================================================

class DataNormalizer:
    def strip_blocked_words(self, title: str) -> str:
        """Remove blocked words/phrases from title"""
        if not title:
            return ''
        cleaned = title
        for pattern in BLOCKED_TITLE_PATTERNS:
            cleaned = pattern.sub('', cleaned)
        # Collapse multiple spaces
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        return cleaned

    def clean_and_format_title(self, title: str) -> str:
        if not title:
            return ''
        
        # Strip blocked words first
        title = self.strip_blocked_words(title)
        
        # Add space before capital letters following lowercase
        clean_title = re.sub(r'([a-z])([A-Z])', r'\1 \2', title)
        
        # Replace special characters within words with spaces
        clean_title = re.sub(r'([a-zA-Z])[^a-zA-Z\s]+([a-zA-Z])', r'\1 \2', clean_title)
        
        # Remove remaining special characters
        clean_title = re.sub(r'[^a-zA-Z\s]', '', clean_title)
        
        # Replace multiple spaces and trim
        clean_title = re.sub(r'\s+', ' ', clean_title).strip()
        
        # Convert to proper case
        clean_title = clean_title.title()
        
        words = clean_title.split()
        if len(words) < 12:
            additional_words = self.get_random_words(5)
            clean_title += ' ' + ' '.join(additional_words)
        
        words = clean_title.split()
        unique_words = list(dict.fromkeys(words))  # Preserve order
        limited_words = unique_words[:12]
        
        return ' '.join(limited_words)
    
    def get_random_words(self, count: int) -> List[str]:
        words = [
            'Sotwe', 'Bokep Dood', 'Twitter', 'Bokepsatset', 'Simontok', 'Video Viral',
            'Video Viral', 'Bokep Video', 'Simintok', 'Xpanas', 'Full Album', 'Doodstream',
            'Bokepsin', 'Simontok', 'Bokep', 'Asupan', 'Bokepsin', 'Bebasindo',
            'Pekoblive', 'Terabox', 'Streaming', 'Viral', 'Indo', 'Tiktok', 'Telegram',
            'Doods Pro', 'Telegram', 'Ful Album', 'Viral', 'Videos',
            'Poophd', 'Bochiel', 'Link Web', 'Folder',
            'Cilbo', 'Live', 'Tele', 'Terupdate', 'Links', 'Lokal', 'Dodstream',
            'Pemersatu', 'Update', 'Dood', 'Doostream', 'Website',
            'Downloader', 'Lulustream', 'Doodsflix', 'Yakwad', 'Doodflix',
            'Tobrut', 'Lagi Viral', 'Doodstreem', 'Jilbab',
            'Asupan Viral',
            'Pejuang Lendir', 'Popstream', 'Staklam', 'Bokepind', 'Video Bokep',
            'Bokep31', 'Video Indo', 'Video Colmek', 'Toketbagus',  
            'Video Sma', 'Doods Pro', 'Ngentot',  
            'Indonesia', 'Bokepin', 'Dood Tele', 'Cantik Tobrut', 'Memeksiana'
        ]
        random.shuffle(words)
        return words[:count]
    
    def parse_duration(self, duration) -> int:
        if isinstance(duration, (int, float)):
            return int(duration)
        
        if isinstance(duration, str):
            parts = list(reversed(duration.split(':')))
            seconds = 0
            for idx, val in enumerate(parts):
                seconds += int(val) * (60 ** idx)
            return seconds
        
        return 0
    
    def parse_size_to_bytes(self, size_value) -> int:
        """Convert size from string with units (e.g., '608.00 MB') to bytes (integer)"""
        if isinstance(size_value, int):
            return size_value
        
        if isinstance(size_value, str):
            # Remove spaces and convert to uppercase
            size_str = size_value.strip().upper()
            
            # Extract number and unit
            import re
            match = re.match(r'([0-9.]+)\s*(BYTES|KB|MB|GB|TB)?', size_str)
            if match:
                number = float(match.group(1))
                unit = match.group(2) or 'BYTES'
                
                # Convert to bytes
                multipliers = {
                    'BYTES': 1,
                    'KB': 1024,
                    'MB': 1024 ** 2,
                    'GB': 1024 ** 3,
                    'TB': 1024 ** 4
                }
                
                return int(number * multipliers.get(unit, 1))
        
        return 0
    
    def duration_to_iso8601(self, seconds: int) -> str:
        """Convert duration in seconds to ISO 8601 format PT[M]M[S]S"""
        if seconds <= 0:
            return "PT10M30S"
        
        minutes = seconds // 60
        remaining_seconds = seconds % 60
        
        if minutes > 0 and remaining_seconds > 0:
            return f"PT{minutes}M{remaining_seconds}S"
        elif minutes > 0:
            return f"PT{minutes}M"
        else:
            return f"PT{remaining_seconds}S"
    

    
    def format_number(self, num) -> str:
        """Format number (views) to K/M format"""
        if not num:
            return '0'
        try:
            num = int(num)
        except (ValueError, TypeError):
            return str(num)
            
        if num >= 1000000:
            return f"{(num/1000000):.1f}M"
        if num >= 1000:
            return f"{(num/1000):.1f}K"
        return str(num)

    def format_date(self, uploaded: str, format_type='full') -> str:
        """Format ISO date to Indonesian format"""
        if not uploaded:
            return ''
        try:
            # Handle possible 'Z' suffix
            dt_str = uploaded.replace('Z', '+00:00')
            dt = datetime.fromisoformat(dt_str)
            # Basic month mapping for Indonesian
            months = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
            
            if format_type == 'full':
                return f"{dt.day} {months[dt.month]} {dt.year}"
            elif format_type == 'short':
                return f"{dt.day} {months[dt.month]}"
        except Exception:
            return uploaded
        return uploaded

    def generate_slug(self, text: str) -> str:
        """Generate URL-friendly slug"""
        if not text:
            return "video"
        # Mirror of JS norm() function but for slugs
        norm = text.lower()
        norm = re.sub(r'[^a-z0-9\s]', ' ', norm)
        norm = re.sub(r'\s+', ' ', norm).strip()
        return norm.replace(' ', '-')

    def html_escape(self, text: str) -> str:
        """Basic HTML escaping"""
        if not text:
            return ""
        return (text.replace('&', '&amp;')
                    .replace('<', '&lt;')
                    .replace('>', '&gt;')
                    .replace('"', '&quot;')
                    .replace("'", '&#39;'))
    
    def format_size(self, size_bytes: int) -> str:
        """Format size from bytes to human readable format (MB/GB)"""
        if size_bytes <= 0:
            return "0.00 B"
        
        units = ['B', 'KB', 'MB', 'GB', 'TB']
        index = 0
        size = float(size_bytes)
        
        while size >= 1024 and index < len(units) - 1:
            size /= 1024
            index += 1
            
        return f"{size:.2f} {units[index]}"

    def format_duration(self, seconds: int) -> str:
        """Format duration in seconds to HH:MM:SS"""
        if seconds <= 0:
            return "00:00:00"
        
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        remaining_seconds = seconds % 60
        
        return f"{hours:02d}:{minutes:02d}:{remaining_seconds:02d}"

    def generate_description(self, video_data: Dict) -> str:
        """Generate a human readable description from video data"""
        title = video_data.get('title', 'Unknown Title')
        uploaded = video_data.get('uploaded', 'Unknown Date')
        size = video_data.get('size', 'Unknown Size')
        length = video_data.get('length', 'Unknown Duration')
        
        return f"Nonton {title} yang lagi viral yang di upload pada tanggal {uploaded}. Video ini memiliki Ukuran file {size} dengan durasi {length}."
    
    def generate_category_name(self, title: str) -> str:
        """Generate category name from title"""
        # Kata-kata prioritas
        priority_words = [
        # Kategori umum viral
        'hijab', 'viral', 'trending', 'populer', 'terbaru', 'terkini', 'hot',
        
        # Lokasi/region
        'indo', 'indonesia', 'lokal', 'jepang', 'jepang', 'jav', 'japan', 
        'korea', 'korean', 'china', 'chinese', 'thai', 'thailand', 'vietnam',
        'filipina', 'malaysia', 'singapore', 'asia', 'barat', 'timur',
        
        # Platform hosting
        'doodstream', 'terabox', 'lulustream', 'streaming', 'dood', 'terabox',
        'google', 'drive', 'gdrive', 'mega', 'dropbox', 'mediafire',
        'zippyshare', 'racaty', 'solidfiles', 'upload', 'uploaded',
        
        # Demografi/karakter
        'Abg', 'Sma', 'Remaja', 'Janda', 'Stw', 'Ibu', 'Bapak', 'Kakek', 'Nenek',
        'Mahasiswa', 'Pelajar', 'Siswi', 'Siswa', 'Guru', 'Murid', 'Dosen',
        'Pegawai', 'Karyawan', 'Artis', 'Selebriti', 'Selebgram', 'Tiktoker',
        'Youtuber', 'Streamer', 'Model', 'Bintang', 'Pemain',
        
        # Kategori konten
        'Skandal', 'Bokep', 'Colmek', 'Pijat', 'Pijat Plus', 'Pijat Panggilan',
        'Spa', 'Hotel', 'Motel', 'Penginapan', 'Kosan', 'Kontrakan',
        'Rumah', 'Kamar', 'Tidur', 'Mandi', 'Kamar Mandi', 'Toilet',
        'Prank', 'Kloset', 'Terima', 'Kasih', 'Berkah',
        
        # Genre/fetish
        'Ngentot', 'ML', 'Senggama', 'Bercinta', 'Mesum', 'Asusila',
        'Telanjang', 'Bugil', 'Togel', 'Toge', 'Polisi', 'Tentara',
        'Satpam', 'Security', 'Sopir', 'Driver', 'Ojek', 'Grab', 'Gojek',
        'Taksi', 'Taxi', 'Angkot', 'Bus', 'Kereta', 'Pesawat',
        
        # Event/spesial
        'Lebaran', 'Natal', 'Tahun Baru', 'Valentine', 'Halloween',
        'Liburan', 'Weekend', 'Sabtu', 'Minggu', 'Malam', 'Siang', 'Pagi',
        'Sore', 'Petang', 'Senja', 'Dini', 'Hari',
        
        # Teknis/kualitas
        'Hd', 'Fhd', '4k', '1080p', '720p', '480p', '360p', 'High Quality',
        'Hq', 'Clear', 'Jernih', 'Bening', 'Full', 'Lengkap', 'Complete',
        'Part', 'Episode', 'Eps', 'Season', 'Series', 'Serial',
        
        # Media sosial
        'Tiktok', 'Instagram', 'Ig', 'Facebook', 'Fb', 'Twitter', 'Twt',
        'Whatsapp', 'Wa', 'Telegram', 'Tg', 'Line', 'Snapchat', 'Sc',
        'Vcs', 'Videocall', 'Live', 'Streaming', 'Siaran', 'Broadcast',
        
        # Nama spesifik (tokoh/artis viral)
        'Tobrut', 'Ariel', 'Luna', 'Maya', 'Bayu', 'Siska', 'Rina', 'Dewi',
        'Sari', 'Mawar', 'Melati', 'Anggun', 'Cantik', 'Manis', 'Imut',
        'Gadis', 'Perawan', 'Wanita', 'Pria', 'Laki', 'Cowok', 'Cewek',
        
        # Status hubungan
        'Pacar', 'Kekasih', 'Suami', 'Istri', 'Mertua', 'Besan', 'Saudara',
        'Saudari', 'Kakak', 'Adik', 'Keluarga', 'Kerabat', 'Teman', 'Sahabat',
        'Tetangga', 'Kolega', 'Rekan', 'Partner',
        
        # Profesi
        'Dokter', 'Perawat', 'Bidan', 'Suster', 'Perawat', 'Polwan',
        'Tentara', 'Prajurit', 'Satpam', 'Security', 'Sopir', 'Driver',
        'Guru', 'Murid', 'Dosen', 'Mahasiswa', 'Pegawai', 'Karyawan',
        'Bos', 'Manager', 'Direktur', 'CEO', 'Owner', 
        
        # Konten eksklusif
        'Premium', 'Vip', 'Exclusive', 'Eksklusif', 'Private', 'Pribadi',
        'Rahasia', 'Secret', 'Hidden', 'Tersembunyi', 'Leak', 'Bocor',
        'Hack', 'Retas', 'Phishing', 'Scam', 'Penipuan',
      
        
 
  ]
    
        
        # Kata-kata yang harus dilewati (awalan, akhiran, imbuhan, kata sambung)
        skip_words = [
        # Kata sambung/konjungsi
        'di', 'ke', 'dari', 'pada', 'yang', 'untuk', 'dan', 'atau', 'tapi', 'tetapi',
        'dengan', 'oleh', 'karena', 'sehingga', 'agar', 'supaya', 'jika', 'kalau',
        'apabila', 'walau', 'meski', 'walaupun', 'meskipun', 'sementara',
        'sedang', 'ketika', 'saat', 'setelah', 'sebelum', 'hingga', 'sampai',
        'demi', 'lewat', 'melalui', 'via', 'tanpa', 'sejak', 'selama', 'ketika',
        'sambil', 'seraya', 'biar', 'meski', 'meskipun', 'agar', 'supaya',
        
        # Preposisi
        'atas', 'bawah', 'depan', 'belakang', 'samping', 'dalam', 'luar',
        'antara', 'sekitar', 'sebelah', 'hadap', 'tepi', 'pinggir', 'ujung',
        
        # Partikel
        'kah', 'lah', 'tah', 'pun', 'nya',
        
        # Awalan/imbuhan
        'se', 'ber', 'ter', 'me', 'pe', 'per', 'mem', 'pen', 'peng', 'men',
        'pem', 'pel', 'ber', 'ter', 'ke', 'di', 'per', 'se', 'meng', 'meny',
        'memper', 'mempert', 'diper', 'terper',
        
        # Akhiran
        'kan', 'an', 'i', 'nya', 'ku', 'mu',
        
        # Kata ganti
        'ini', 'itu', 'sini', 'situ', 'sana', 'kamu', 'aku', 'saya', 'kita',
        'mereka', 'dia', 'beliau', 'anda', 'kalian', 'kami', 'engkau', 'kau',
        'beliau', 'nya',
        
        # Kata sifat umum/pembuka
        'sebuah', 'suatu', 'sang', 'si', 'para', 'kaum', 'segala', 'seluruh',
        'semua', 'setiap', 'masing', 'beberapa', 'sedikit', 'banyak', 'semua',
        
        # Kata bantu/kerja bantu
        'adalah', 'ialah', 'merupakan', 'menjadi', 'bisa', 'dapat', 'mampu',
        'harus', 'wajib', 'perlu', 'hendak', 'akan', 'sedang', 'telah', 'sudah',
        'pernah', 'belum', 'masih', 'baru', 'hanya', 'cuma', 'sekadar', 'hampir',
        'nyaris', 'agak', 'cukup', 'terlalu', 'amat', 'sangat', 'benar', 'sungguh',
        
        # Kata lain yang umum
        'ada', 'tidak', 'bukan', 'jangan', 'janganlah', 'usah', 'jangan',
        'mohon', 'tolong', 'harap', 'silahkan', 'mari', 'ayo', 'ayolah',
        'wah', 'aduh', 'astaga', 'ya', 'tidak', 'bukan',
        
        # Kata umum dalam judul video
        'full', 'part', 'episode', 'eps', 'scene', 'clip', 'short', 'video',
        'film', 'movie', 'tv', 'series', 'season', 'trailer', 'preview',
        'official', 'original', 'version', 'edit', 'hd', 'fhd', '4k', '1080p',
        '720p', '480p', '360p', '240p', 'mp4', 'mkv', 'avi', 'download',
        'stream', 'online', 'free', 'premium', 'vip', 'baru', 'lama', 'baru',
        'hot', 'trending', 'populer', 'terpopuler', 'terbaru', 'terlama',
        
        # Kata umum bahasa Indonesia
        'dalam', 'oleh', 'pada', 'sebagai', 'bagi', 'menurut', 'tentang',
        'mengenai', 'atas', 'bawah', 'depan', 'belakang', 'samping', 'antara',
        'di', 'ke', 'dari', 'demi', 'hingga', 'sampai', 'selama', 'sementara',
        'seraya', 'ketika', 'sewaktu', 'sebelum', 'sesudah', 'setelah', 'sejak',
        'tatkala', 'selagi', 'sedangkan', 'sambil', 'seraya', 'biar', 'meski',
        'walau', 'walaupun', 'meskipun', 'supaya', 'agar', 'untuk', 'guna',
        'dengan', 'tanpa', 'via', 'lewat', 'melalui', 'oleh', 'sebab', 'karena',
        'lantas', 'lalu', 'kemudian', 'maka', 'oleh_karena', 'sehingga',
        'maka_dari', 'adapun', 'akan', 'bahwa', 'bahwasanya', 'sebab', 'jika',
        'kalau', 'apabila', 'andai', 'andaikata', 'seandainya', 'seumpama',
        
        # Kata sambung subordinatif
        'seakan', 'seolah', 'ibarat', 'sebagaimana', 'seperti', 'bagai',
        'laksana', 'daripada', 'alih', 'daripada',
        
        # Kata bilangan
        'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan',
        'sembilan', 'sepuluh', 'seratus', 'seribu', 'sejuta', 'pertama',
        'kedua', 'ketiga', 'keempat', 'kelima',
    ]
        # Pisahkan kata-kata dalam title
        words = title.split()
        
        # Hapus kata "Video" dari awal jika ada
        original_words = words.copy()  # Simpan original untuk pengecekan panjang
        if words and words[0].lower() == 'video':
            words = words[1:]  # Hapus kata pertama jika itu "Video"
        
        # Jika setelah dihapus masih ada kata-kata
        if words:
            # Inisialisasi first_word dengan kata pertama setelah menghapus "Video"
            first_word = None
            
            # Periksa kata-kata prioritas dalam title terlebih dahulu
            for priority_word in priority_words:
                if priority_word.lower() in [w.lower() for w in words]:
                    first_word = priority_word
                    break
            
            # Jika tidak ada kata prioritas, cari kata yang tidak di skip_words
            if not first_word:
                for word in words:
                    # Skip jika kata hanya angka
                    if word.isdigit():
                        continue
                    
                    # Skip jika kata kurang dari 3 huruf
                    if len(word) < 3:
                        continue
                    
                    # Skip jika kata ada di skip_words
                    if word.lower() in skip_words:
                        continue
                    
                    # Kata ini valid, gunakan sebagai first_word
                    first_word = word
                    break
            
            # Fallback: jika masih tidak ada first_word yang valid
            if not first_word:
                # Cek apakah semua kata dalam original title kurang dari 3 huruf
                # (kecuali kata "Video" yang sudah dihapus)
                all_short_words = True
                for word in original_words:
                    # Abaikan kata "video" dari pengecekan panjang
                    if word.lower() != 'video' and len(word) >= 3:
                        all_short_words = False
                        break
                
                first_word = "Terbaru"
            
            # Ubah huruf pertama menjadi besar dan tambahkan "Video" di awal
            category_name = 'Video ' + first_word.capitalize()
        else:
            # Jika tidak ada kata lain setelah "Video", gunakan default
            category_name = 'Video Terbaru'
        
        return category_name
    

    
    def normalize_data(self, api_data: Dict, api_source: str = 'doodstream', existing_videos: List[Dict] = None) -> List[Dict]:
        if existing_videos is None:
            existing_videos = []
        
        normalized_items = []
        
        if not api_data.get('result') or not isinstance(api_data['result'].get('files'), list):
            return normalized_items
        
        existing_videos_map = {}
        for video in existing_videos:
            filecode = video.get('filecode') or video.get('file_code')
            if filecode:
                existing_videos_map[filecode] = video
        
        for item in api_data['result']['files']:
            filecode = item.get('file_code') or item.get('filecode', '')
            raw_title = item.get('title') or item.get('file_title', '')
            clean_title = self.clean_and_format_title(raw_title)
            
            duration = self.parse_duration(item.get('length') or item.get('file_length', 0))
            duration_iso = self.duration_to_iso8601(duration)
            formatted_length = self.format_duration(duration)
            kategori = self.generate_category_name(clean_title)
            
            if api_source == 'doodstream':
                size_bytes = self.parse_size_to_bytes(item.get('size', self.convert_duration_to_size(duration)))
                formatted_size = self.format_size(size_bytes)
                
                # Create a temporary dict to pass to generate_description
                temp_data = {
                    'title': clean_title,
                    'uploaded': item.get('uploaded', ''),
                    'size': formatted_size,
                    'length': formatted_length
                }
                deskripsi = self.generate_description(temp_data)

                normalized_item = {
                    'protected_embed': item.get('protected_embed', f'https://dodl.pages.dev/{filecode}'),
                    'size': formatted_size,
                    'length': formatted_length,
                    'duration': duration_iso,
                    'protected_dl': item.get('download_url', f'https://doodstream.com/d/{filecode}'),
                    'views': item.get('views', 0),
                    'vw_fmt': self.format_number(item.get('views', 0)),
                    'single_img': item.get('single_img') or item.get('splash_img') or '/images/placeholder.png',
                    'title': clean_title,
                    't_esc': self.html_escape(clean_title),
                    'raw_title': raw_title,
                    'status': item.get('status', '200'),
                    'uploaded': item.get('uploaded', ''),
                    'up_fmt': self.format_date(item.get('uploaded', ''), 'full'),
                    'up_short': self.format_date(item.get('uploaded', ''), 'short'),
                    'last_view': item.get('uploaded', ''),
                    'splash_img': item.get('splash_img') or item.get('single_img') or '/images/placeholder.png',
                    'filecode': filecode,
                    'file_code': filecode,
                    'canplay': item.get('canplay', True),
                    'api_source': item.get('api_source', 'doodstream'),
                    'kategori': kategori,
                    'kt_slug': self.generate_slug(kategori),
                    'kt_url': f"/f/{self.generate_slug(kategori)}",
                    'deskripsi': deskripsi,
                    'ds_esc': self.html_escape(deskripsi)
                }
            else:
                size_bytes = self.parse_size_to_bytes(item.get('file_size', self.convert_duration_to_size(duration)))
                formatted_size = self.format_size(size_bytes)
                
                # Create a temporary dict to pass to generate_description
                temp_data = {
                    'title': clean_title,
                    'uploaded': item.get('uploaded', ''),
                    'size': formatted_size,
                    'length': formatted_length
                }
                deskripsi = self.generate_description(temp_data)

                normalized_item = {
                    'protected_embed': item.get('protected_embed', f'https://luvluv.pages.dev/{filecode}'),
                    'size': formatted_size,
                    'length': formatted_length,
                    'duration': duration_iso,
                    'protected_dl': item.get('download_url', f'https://lulustream.com/d/{filecode}'),
                    'views': item.get('views', item.get('file_views', 0)),
                    'vw_fmt': self.format_number(item.get('views', item.get('file_views', 0))),
                    'single_img': item.get('player_img', f'https://img.lulucdn.com/{filecode}_t.jpg' or '/images/placeholder.png'),
                    'splash_img': item.get('player_img', f'https://img.lulucdn.com/{filecode}_xt.jpg' or '/images/placeholder.png'),
                    'title': clean_title,
                    't_esc': self.html_escape(clean_title),
                    'raw_title': raw_title,
                    'status': item.get('status', '200'),
                    'uploaded': item.get('uploaded', ''),
                    'up_fmt': self.format_date(item.get('uploaded', ''), 'full'),
                    'up_short': self.format_date(item.get('uploaded', ''), 'short'),
                    'last_view': item.get('uploaded', ''),
                    'filecode': filecode,
                    'file_code': filecode,
                    'canplay': item.get('canplay', True),
                    'api_source': item.get('api_source', 'lulustream'),
                    'kategori': kategori,
                    'kt_slug': self.generate_slug(kategori),
                    'kt_url': f"/f/{self.generate_slug(kategori)}",
                    'deskripsi': deskripsi,
                    'ds_esc': self.html_escape(deskripsi)
                }
            
            if filecode in existing_videos_map:
                normalized_items.append(self.update_existing_data(existing_videos_map[filecode], normalized_item))
            else:
                normalized_items.append(normalized_item)
        
        return normalized_items
    
    def convert_duration_to_size(self, duration: int, bitrate: int = 1) -> float:
        return duration * bitrate * 1024 * 1024
    
    def update_existing_data(self, existing_data: Dict, new_data: Dict) -> Dict:
        preserved_title = existing_data.get('title', '')
        updated_data = new_data.copy()
        updated_data['title'] = preserved_title
        
        if existing_data.get('kategori'):
            updated_data['kategori'] = existing_data['kategori']
        
        return updated_data

# ============================================================================
# ASYNC API CLIENT
# ============================================================================

class AsyncAPIClient:
    def __init__(self):
        self.normalizer = DataNormalizer()
        self.user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
        ]
        self.session = None
    
    def get_random_user_agent(self) -> str:
        return random.choice(self.user_agents)
    
    async def __aenter__(self):
        timeout = aiohttp.ClientTimeout(total=30)
        connector = aiohttp.TCPConnector(limit_per_host=10, limit=20)
        self.session = aiohttp.ClientSession(
            timeout=timeout,
            connector=connector,
            headers={'Accept': 'application/json'}
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def fetch_page(self, url: str, max_retries: int = 3) -> Optional[Dict]:
        for attempt in range(max_retries):
            try:
                headers = {'User-Agent': self.get_random_user_agent()}
                async with self.session.get(url, headers=headers) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        print(f"HTTP {response.status} for {url}")
                        if response.status == 429:  # Too Many Requests
                            wait_time = (attempt + 1) * 2
                            print(f"Rate limited, waiting {wait_time} seconds...")
                            await asyncio.sleep(wait_time)
            except asyncio.TimeoutError:
                print(f"Timeout on attempt {attempt + 1} for {url}")
            except Exception as e:
                print(f"Attempt {attempt + 1} failed for {url}: {str(e)}")
            
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
        
        return None
    
    async def fetch_all_pages_concurrent(self, config: Dict, api_source: str, existing_videos: List[Dict] = None) -> List[Dict]:
        """Fetch all pages using actual API response data for pagination"""
        if existing_videos is None:
            existing_videos = []
        
        all_data = []
        max_concurrent = config.get('concurrent_requests', 5)
        
        # Semaphore untuk membatasi concurrent requests
        semaphore = asyncio.Semaphore(max_concurrent)
        
        print(f"Starting fetch from {api_source}...")
        
        # Fetch first page to get total pages from API response
        url = f"{config['api_url']}?key={config['api_key']}&per_page={config['per_page']}&page=1"
        first_result = await self.fetch_page(url, config['max_retries'])
        
        if not first_result or first_result.get('status') != 200:
            print(f"Failed to fetch first page from {api_source}")
            return []
        
        # Get total pages from API response
        # doodapi uses 'total_pages', lulustream uses 'pages'
        result_data = first_result.get('result', {})
        total_pages = result_data.get('total_pages') or result_data.get('pages', 1)
        
        print(f"API {api_source} reports {total_pages} total pages")
        
        # Process first page data
        normalized_data = self.normalizer.normalize_data(first_result, api_source, existing_videos)
        if normalized_data:
            all_data.extend(normalized_data)
            print(f"  ✓ Page 1 from {api_source}: {len(normalized_data)} videos")
        
        # If only one page, return early
        if total_pages <= 1:
            print(f"Completed fetch from {api_source}: {len(all_data)} total videos")
            return self.preserve_existing_titles(all_data, existing_videos)
        
        # Fetch remaining pages concurrently
        async def fetch_and_process(page_num: int):
            async with semaphore:
                url = f"{config['api_url']}?key={config['api_key']}&per_page={config['per_page']}&page={page_num}"
                result = await self.fetch_page(url, config['max_retries'])
                
                if result and result.get('status') == 200:
                    normalized_data = self.normalizer.normalize_data(result, api_source, existing_videos)
                    if normalized_data:
                        print(f"  ✓ Page {page_num} from {api_source}: {len(normalized_data)} videos")
                        await asyncio.sleep(config.get('request_delay', 0.5))
                        return normalized_data
                return []
        
        # Create tasks for remaining pages
        tasks = [fetch_and_process(page) for page in range(2, total_pages + 1)]
        
        # Execute in batches
        batch_size = max_concurrent
        for i in range(0, len(tasks), batch_size):
            batch = tasks[i:i + batch_size]
            results = await asyncio.gather(*batch, return_exceptions=True)
            
            for result in results:
                if isinstance(result, Exception):
                    print(f"Error in batch processing: {result}")
                    continue
                if result:
                    all_data.extend(result)
        
        print(f"Completed fetch from {api_source}: {len(all_data)} total videos")
        return self.preserve_existing_titles(all_data, existing_videos)
    
    def preserve_existing_titles(self, new_videos: List[Dict], existing_videos: List[Dict]) -> List[Dict]:
        existing_titles_map = {}
        
        for video in existing_videos:
            filecode = video.get('filecode') or video.get('file_code', '')
            title = video.get('title', '')
            if filecode and title:
                existing_titles_map[filecode] = title
        
        for video in new_videos:
            filecode = video.get('filecode') or video.get('file_code', '')
            if filecode in existing_titles_map:
                video['title'] = existing_titles_map[filecode]
                video['title_preserved'] = True
            else:
                video['title_preserved'] = False
        
        return new_videos

# ============================================================================
# FILE OPERATIONS - OPTIMIZED FOR AGC.PHP
# ============================================================================

def load_all_videos_from_detail_files() -> List[Dict]:
    """
    Load all videos from public/data/detail/ shard folders.
    This replaces load_all_videos_from_paginated_files for better persistence.
    """
    detail_dir = Path('public/data/detail')
    all_videos = []
    
    if not detail_dir.exists():
        return all_videos
    
    print("   • Scanning shard folders in output/detail/...")
    shard_dirs = [d for d in detail_dir.iterdir() if d.is_dir()]
    
    for shard_dir in shard_dirs:
        for detail_file in shard_dir.glob('*.json'):
            try:
                with open(detail_file, 'r', encoding='utf-8') as f:
                    v = json.load(f)
                    if v:
                        all_videos.append(v)
            except Exception as e:
                print(f"Error loading {detail_file}: {e}")
    
    return all_videos

def parse_uploaded_timestamp(uploaded: str) -> int:
    """
    Parse uploaded string to timestamp
    """
    if not uploaded:
        return 0
    
    if isinstance(uploaded, (int, float)):
        return int(uploaded)
    
    try:
        # Try to parse various date formats
        dt = datetime.fromisoformat(uploaded.replace('Z', '+00:00'))
        return int(dt.timestamp())
    except:
        try:
            dt = datetime.strptime(uploaded, '%Y-%m-%d %H:%M:%S')
            return int(dt.timestamp())
        except:
            try:
                dt = datetime.strptime(uploaded, '%Y-%m-%d')
                return int(dt.timestamp())
            except:
                return 0

def merge_video_data(new_videos: List[Dict], existing_videos: List[Dict]) -> List[Dict]:
    merged_videos = []
    existing_map = {}
    
    for video in existing_videos:
        filecode = video.get('filecode') or video.get('file_code', '')
        if filecode:
            existing_map[filecode] = video
    
    for new_video in new_videos:
        filecode = new_video.get('filecode') or new_video.get('file_code', '')
        
        if filecode and filecode in existing_map:
            existing_video = existing_map[filecode]
            merged_video = new_video.copy()
            
            # Preserve important fields from existing data
            merged_video['title'] = existing_video.get('title', new_video['title'])
            merged_video['kategori'] = existing_video.get('kategori', new_video.get('kategori'))
            merged_video['custom_fields'] = existing_video.get('custom_fields', new_video.get('custom_fields', {}))
            merged_video['title_preserved'] = True
            
            merged_videos.append(merged_video)
            del existing_map[filecode]
        else:
            new_video['title_preserved'] = False
            merged_videos.append(new_video)
    
    # Add remaining existing videos
    for existing_video in existing_map.values():
        existing_video['title_preserved'] = True
        existing_video['data_preserved'] = True
        merged_videos.append(existing_video)
    
    return merged_videos

def save_fetch_status(status_data: Dict):
    """Save fetch status to file"""
    status_file = Path('fetch_status.json')
    with open(status_file, 'w', encoding='utf-8') as f:
        json.dump(status_data, f, indent=2, ensure_ascii=False)



# ============================================================================
# MAIN ASYNC FUNCTIONS
# ============================================================================

async def fetch_from_source_async(source_name: str, config: Dict, existing_videos: List[Dict]) -> List[Dict]:
    """Async function to fetch data from a single source"""
    async with AsyncAPIClient() as client:
        print(f"🚀 Starting async fetch from {source_name}...")
        start_time = time.time()
        
        # Use concurrent fetching
        videos = await client.fetch_all_pages_concurrent(config, source_name, existing_videos)
        
        elapsed = time.time() - start_time
        print(f"✅ Completed async fetch from {source_name}: {len(videos)} videos in {elapsed:.2f} seconds")
        return videos

async def fetch_all_sources_concurrently(existing_videos: List[Dict]) -> List[Dict]:
    """Fetch from all sources concurrently"""
    print("🔄 Starting concurrent fetch from all sources...")
    
    # Create tasks for all sources
    tasks = []
    for source_name, config in CONFIGS.items():
        task = fetch_from_source_async(source_name, config, existing_videos)
        tasks.append(task)
    
    # Run all tasks concurrently with timeout
    try:
        results = await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True),
            timeout=300  # 5 minutes timeout
        )
    except asyncio.TimeoutError:
        print("⏰ Timeout: Fetch operation took too long")
        return []
    
    # Process results
    all_videos = []
    for idx, result in enumerate(results):
        source_name = list(CONFIGS.keys())[idx]
        if isinstance(result, Exception):
            print(f"❌ Error fetching from {source_name}: {str(result)}")
        elif result:
            all_videos.extend(result)
            print(f"✓ Successfully fetched {len(result)} videos from {source_name}")
        else:
            print(f"⚠️ No data fetched from {source_name}")
    
    return all_videos

def normalize_title_for_search(title: str) -> str:
    if not title:
        return ""
    t = title.lower()
    t = re.sub(r'[^a-z0-9]', '', t)
    return t

def get_prefix2(norm: str) -> str:
    if not norm:
        return "__"
    if len(norm) == 1:
        return norm + "_"
    return norm[:2]

def get_prefix3(norm: str) -> str:
    if len(norm) >= 3:
        return norm[:3]
    return (norm + "__")[:3]

def get_md5_shard(filecode: str) -> str:
    """Get SHA256-based shard hex (00-ff) untuk batch sharding"""
    import hashlib
    hash_obj = hashlib.sha256(filecode.encode())
    hex_digest = hash_obj.hexdigest()
    # Ambil 2 karakter pertama (00-ff)
    return hex_digest[:2]

def generate_static_indexes_sharded(videos: List[Dict], per_page: int):
    """Generate static indexes dengan batch sharding (256 files max untuk Cloudflare limit)"""
    output = Path("public/data")
    index_dir = output / "index"
    detail_dir = output / "detail"

    index_dir.mkdir(parents=True, exist_ok=True)
    detail_dir.mkdir(parents=True, exist_ok=True)

    # Batch sharding: gunakan MD5 hex (00-ff) untuk 256 shard files
    batch_shards: Dict[str, List[Dict]] = {}
    prefix2_map: Dict[str, List[Dict]] = {}

    for i, v in enumerate(videos):
        vid = v.get("filecode") or v.get("file_code")
        if not vid:
            continue

        title = v.get("title", "")
        norm = normalize_title_for_search(title)

        page = (i // per_page) + 1
        index = i % per_page

        # ===== BATCH SHARD (256 files max: 00.json - ff.json) =====
        shard_key = get_md5_shard(vid)  # Returns "00" to "ff"
        
        detail = {
            "f": vid,  # filecode
            "t": title,  # title
            "t_esc": v.get("t_esc"), # escaped title
            "ds": v.get("deskripsi"),  # deskripsi
            "ds_esc": v.get("ds_esc"), # escaped deskripsi
            "tg": v.get("tag"),  # tag
            "pe": v.get("protected_embed"),  # protected_embed
            "pd": v.get("protected_dl"),  # protected_dl
            "si": v.get("single_img"),  # single_img
            "sp": v.get("splash_img"),  # splash_img
            "sz": v.get("size"),  # size
            "ln": v.get("length"),  # length
            "dr": v.get("duration"),  # duration
            "vw": v.get("views", 0),  # views
            "vw_fmt": v.get("vw_fmt"), # formatted views
            "up": v.get("uploaded"),  # uploaded
            "up_fmt": v.get("up_fmt"), # formatted uploaded
            "up_short": v.get("up_short"), # formatted uploaded short
            "lv": v.get("last_view"),  # last_view
            "as": v.get("api_source"),  # api_source
            "kt": v.get("kategori"),  # kategori
            "kt_slug": v.get("kt_slug"), # kategori slug
            "kt_url": v.get("kt_url"), # kategori url
            "pg": page,  # page
            "ix": index  # index
        }
        
        batch_shards.setdefault(shard_key, []).append(detail)

        # ===== PREFIX-2 INDEX (RINGKAS dengan abbreviated keys) =====
        p2 = get_prefix2(norm)
        index_item = {
            "f": vid,  # filecode
            "t": title,  # title
            "t_esc": v.get("t_esc"),
            "ln": v.get("length"),  # length
            "sp": v.get("splash_img"),  # splash_img
            "si": v.get("single_img"),  # single_img
            "vw": v.get("views", 0),  # views
            "vw_fmt": v.get("vw_fmt"),
            "up": v.get("uploaded"),  # uploaded
            "up_fmt": v.get("up_fmt"),
            "up_short": v.get("up_short"),
            "pg": page  # page
        }
        prefix2_map.setdefault(p2, []).append(index_item)

    # ===== WRITE BATCH SHARDS (00.json - ff.json) =====
    print(f"💾 Writing {len(batch_shards)} batch shard files...")
    for shard_key in sorted(batch_shards.keys()):
        items = batch_shards[shard_key]
        shard_file = detail_dir / f"{shard_key}.json"
        
        with open(shard_file, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, separators=(",", ":"))
        
        if len(batch_shards) <= 10:
            print(f"   ✓ {shard_key}.json: {len(items)} videos")

    print(f"✅ Batch shards generated: {len(batch_shards)} files")

    # =========================
    # WRITE PREFIX INDEX (ADAPTIVE)
    # =========================
    for p2, items in prefix2_map.items():
        if len(items) <= PREFIX2_LIMIT:
            # Tulis langsung ke file prefix.json
            with open(index_dir / f"{p2}.json", "w", encoding="utf-8") as f:
                json.dump(items, f, ensure_ascii=False, separators=(",", ":"))
        else:
            # Jika items > PREFIX2_LIMIT, buat subdirectory dan split by prefix-3
            subdir = index_dir / p2
            subdir.mkdir(parents=True, exist_ok=True)
            bucket3: Dict[str, List[Dict]] = {}

            for item in items:
                # item sudah memiliki abbreviated keys (f, t, sz, ln, sp, si, vw, up, pg)
                title = item.get("t", "")  # Abbreviated key untuk title
                norm = normalize_title_for_search(title)
                p3 = get_prefix3(norm)  # Returns 3-char prefix like "via", "vic", etc.
                bucket3.setdefault(p3, []).append(item)

            # Tulis setiap bucket ke file subdirectory
            for p3, subitems in bucket3.items():
                with open(subdir / f"{p3}.json", "w", encoding="utf-8") as sf:
                    json.dump(subitems, sf, ensure_ascii=False, separators=(",", ":"))

    # =========================
    # GENERATE LOOKUP_SHARD.JSON (untuk client-side static lookup)
    # =========================
    # Mapping file_code -> shard untuk mengurangi function requests
    lookup_shard: Dict[str, str] = {}
    for video in videos:
        vid = video.get("filecode") or video.get("file_code")
        if vid:
            shard = get_md5_shard(vid)
            lookup_shard[vid] = shard
    
    with open(output / "lookup_shard.json", "w", encoding="utf-8") as lf:
        json.dump(lookup_shard, lf, ensure_ascii=False, separators=(",", ":"))
    
    print(f"✅ Lookup shard mapping generated: {len(lookup_shard)} entries")

    # =========================
    # META
    # =========================
    meta = {
        "total": len(videos),
        "per_page": per_page,
        "prefix_len": SEARCH_PREFIX_LEN,
        "prefix2_limit": PREFIX2_LIMIT,
        "detail_shard": "md5_hex[:2] (00-ff)",
        "batch_sharding": True,
        "max_files": 256,
        "lookup_shard_available": True
    }

    with open(output / "meta.json", "w", encoding="utf-8") as mf:
        json.dump(meta, mf, indent=2, ensure_ascii=False)

    # =========================
    # CONSTANTS (CONFIG, IMG_ERR)
    # =========================
    config_data = {
        "name": "VideoStream",
        "logo": "https://wsrv.nl/?url=https://videostream.pages.dev/images/apple-touch-icon.png",
        "description": "Situs streaming video viral terbaru dan terlengkap 2024",
        "foundingDate": "2024-01-01"
    }
    with open(output / "constants.json", "w", encoding="utf-8") as cf:
        json.dump(config_data, cf, indent=2, ensure_ascii=False)

    print("✅ Static batch-sharded index and constants generated")


def generate_static_list_files(videos: List[Dict], per_page: int = 100):
    output = Path("public/data")
    list_dir = output / "list"
    list_dir.mkdir(parents=True, exist_ok=True)

    total = len(videos)
    total_pages = (total + per_page - 1) // per_page

    for page in range(total_pages):
        chunk = videos[page * per_page : (page + 1) * per_page]

        items = []
        for v in chunk:
            vid = v.get("filecode") or v.get("file_code")
            if not vid:
                continue

            items.append({
                "download_url": v.get("protected_dl"),
                "single_img": v.get("single_img"),
                "file_code": vid,
                "length": v.get("length", ""),
                "views": str(v.get("views", 0)),
                "vw_fmt": v.get("vw_fmt"),
                "uploaded": v.get("uploaded"),
                "up_fmt": v.get("up_fmt"),
                "up_short": v.get("up_short"),
                "title": v.get("title"),
                "t_esc": v.get("t_esc")
            })

        server_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        page_data = {
            "msg": "OK",
            "server_time": server_time,
            "status": 200,
            "result": {
                "total_pages": total_pages,
                "files": items,
                "results_total": str(total),
                "results": len(items)
            }
        }

        with open(list_dir / f"{page+1}.json", "w", encoding="utf-8") as f:
            json.dump(page_data, f, ensure_ascii=False, separators=(",", ":"))

    print(f"✅ Static list files generated: {total_pages} pages ({per_page}/page)")

async def main_fetch_async():
    """Main async fetch function dengan optimasi untuk AGC.php"""
    start_time = datetime.now()
    start_time_str = start_time.strftime('%Y-%m-%d %H:%M:%S')
    
    print("=" * 60)
    print(f"🚀 ASYNC FETCH STARTED at {start_time_str}")
    print("=" * 60)
    
    try:
        # Load existing data for title preservation
        print("📂 Loading existing videos from detail files...")
        existing_videos = load_all_videos_from_detail_files()
        print(f"📊 Loaded {len(existing_videos)} existing videos for preservation")
        
        # Fetch from all sources concurrently
        print("\n🌐 Fetching data from all sources concurrently...")
        all_videos = await fetch_all_sources_concurrently(existing_videos)
        
        if not all_videos and not existing_videos:
            print("❌ No videos fetched and no existing videos found")
            return {
                'status': 'error',
                'error': 'No data available',
                'started_at': start_time_str
            }
        
        print(f"\n📈 Total fetched videos: {len(all_videos)}")
        
        # Merge with existing data
        print("🔄 Merging with existing data...")
        merged_videos = merge_video_data(all_videos, existing_videos)
        
        # Calculate statistics
        preserved_count = sum(1 for v in merged_videos if v.get('title_preserved', False))
        new_count = len(merged_videos) - preserved_count
        
        print(f"📊 Merge statistics:")
        print(f"   • Preserved titles: {preserved_count}")
        print(f"   • New videos: {new_count}")
        
        # Remove duplicates by filecode
        print("🧹 Removing duplicates...")
        unique_videos = []
        seen_filecodes = set()
        
        for video in merged_videos:
            filecode = video.get('filecode') or video.get('file_code', '')
            if filecode and filecode not in seen_filecodes:
                unique_videos.append(video)
                seen_filecodes.add(filecode)
        
        print(f"🎯 Unique videos after deduplication: {len(unique_videos)}")
        
        # Sort by uploaded date (newest first)
        print("📅 Sorting by uploaded date (newest first)...")
        unique_videos.sort(
            key=lambda x: parse_uploaded_timestamp(x.get('uploaded', '')),
            reverse=True
        )
        
        # ============================================================
        # SAVE DATA FILES
        # ============================================================
        print("\n💾 Saving processed data...")
        
        # (save_paginated_data_files removed as requested)
        
        # Save static indexes and list files
        print("\n⚡ Generating static indexes and list files...")
        generate_static_indexes_sharded(unique_videos, DATA_PER_PAGE)
        generate_static_list_files(unique_videos, DATA_PER_PAGE)
        
        # Calculate execution time
        end_time = datetime.now()
        end_time_str = end_time.strftime('%Y-%m-%d %H:%M:%S')
        execution_time = (end_time - start_time).total_seconds()
        
        print("\n" + "=" * 60)
        print(f"✅ ASYNC FETCH COMPLETED at {end_time_str}")
        print("=" * 60)
        print(f"📊 Final Statistics:")
        print(f"   • Total videos: {len(unique_videos)}")
        total_pages = (len(unique_videos) + DATA_PER_PAGE - 1) // DATA_PER_PAGE
        print(f"   • Total pages: {total_pages}")
        print(f"   • Preserved titles: {preserved_count}")
        print(f"   • New videos: {new_count}")
        print(f"   • Execution time: {execution_time:.2f} seconds")
        print(f"   • Sources: {', '.join(CONFIGS.keys())}")
        print("=" * 60)
        
        # Prepare result
        result = {
            'status': 'completed',
            'started_at': start_time_str,
            'completed_at': end_time_str,
            'execution_time_seconds': execution_time,
            'total_videos': len(unique_videos),
            'preserved_titles': preserved_count,
            'new_videos': new_count,
            'sources_fetched': list(CONFIGS.keys())
        }
        
        # Save status
        save_fetch_status(result)
        
        return result
        
    except asyncio.CancelledError:
        print("⏹️ Fetch operation cancelled")
        return {
            'status': 'cancelled',
            'started_at': start_time_str
        }
    except Exception as e:
        error_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"\n❌ ERROR: {str(e)}")
        
        result = {
            'status': 'error',
            'started_at': start_time_str,
            'completed_at': error_time,
            'error': str(e),
            'error_type': type(e).__name__
        }
        
        save_fetch_status(result)
        return result

async def main_fetch_async_for_php():
    """Versi khusus untuk integrasi PHP"""
    result = await main_fetch_async()
    
    # Print JSON untuk PHP
    print("\n===JSON_RESULT_START===")
    print(json.dumps(result, ensure_ascii=False))
    print("===JSON_RESULT_END===")
    
    return result


async def run_periodic_fetch(interval_hours: float = 24.0):
    """Run main_fetch_async in an infinite loop separated by the given interval (in hours)."""
    while True:
        print(f"🕒 Starting periodic fetch (interval {interval_hours}h)")
        result = await main_fetch_async()
        # store last run timestamp for external reference
        try:
            with open('last_fetch.txt', 'w') as f:
                f.write(datetime.now().isoformat())
        except Exception:
            pass

        if result.get('status') != 'completed':
            print(f"⚠️ Fetch finished with status {result.get('status')}")
        print(f"⏳ Sleeping for {interval_hours} hours before next fetch...\n")
        await asyncio.sleep(interval_hours * 3600)

def run_async_fetch():
    """Entry point for synchronous environments"""
    try:
        # Check if already running
        try:
            with open('fetch.lock', 'x') as lock_file:
                lock_file.write(str(os.getpid()))
        except FileExistsError:
            print("⚠️ Another fetch operation is already running")
            return {'status': 'already_running'}
        
        try:
            # Run async main function
            result = asyncio.run(main_fetch_async())
            return result
        finally:
            # Clean up lock file
            if os.path.exists('fetch.lock'):
                os.remove('fetch.lock')
    except Exception as e:
        print(f"❌ Fatal error: {str(e)}")
        return {'status': 'fatal_error', 'error': str(e)}



# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    print("🚀 Async Video Fetcher")
    print("=" * 50)
    
    # Handle command line arguments
    if len(sys.argv) > 1:
        if sys.argv[1] == '--php':
            # Mode khusus untuk PHP
            result = asyncio.run(main_fetch_async_for_php())
        elif sys.argv[1] == '--sync':
            # Synchronous entry point for compatibility
            result = run_async_fetch()
            print("\n===JSON_RESULT_START===")
            print(json.dumps(result, ensure_ascii=False))
            print("===JSON_RESULT_END===")
        elif sys.argv[1] == '--help':
            print("\nUsage:")
            print("  python sedot.py [OPTION]")
            print("\nOptions:")
            print("  --php       : Output JSON for PHP integration")
            print("  --sync      : Synchronous mode for compatibility")
            print("  --loop      : Run continuously, fetching every INTERVAL hours (default 24)")
            print("  --interval H:  Interval in hours when used with --loop")
            print("  --help      : Show this help")
            sys.exit(0)
        elif sys.argv[1] == '--loop':
            # continuous scheduling
            # check if interval supplied as second argument
            interval = 24.0
            if len(sys.argv) > 2:
                try:
                    interval = float(sys.argv[2])
                except ValueError:
                    pass
            result = asyncio.run(run_periodic_fetch(interval))
    else:
        # Mode normal
        result = asyncio.run(main_fetch_async())
        
        # Print JSON result
        print("\n===JSON_RESULT_START===")
        print(json.dumps(result, ensure_ascii=False))
        print("===JSON_RESULT_END===")
    
    # Exit with appropriate code
    if result.get('status') == 'completed':
        sys.exit(0)
    else:
        sys.exit(1)