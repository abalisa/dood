// functions/[[path]].js
// Cloudflare Pages Functions format dengan CACHE OPTIMIZED dan Schema.org Lengkap

export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);
    const p = url.pathname;

    // Route handlers dengan cache
    if (p === "/" || p === "") return withCache(request, () => list(url, env, "1"));
    if (p === "/robots.txt") return withCache(request, () => robots(request));
    if (p === "/sitemap.xml") return withCache(request, () => sitemap(url, env));
    if (p === "/video-sitemap.xml") return withCache(request, () => videoSitemap(url, env));
    if (p.startsWith("/e/")) return withCache(request, () => detail(url, env));
    if (p.startsWith("/f/")) return withCache(request, () => search(url, env));
    if (p.startsWith("/page/")) return withCache(request, () => list(url, env));

    // Optimization: Serve CSS with optimized headers
    if (p === '/css/main.css') {
        const cssResponse = await env.ASSETS.fetch(new URL('/css/main.css', url.origin));
        if (cssResponse.ok) {
            return new Response(cssResponse.body, {
                headers: {
                    "Content-Type": "text/css",
                    "Cache-Control": "public, max-age=31536000, immutable"
                }
            });
        }
    }

    const res = await next();
    if (res.status === 404) {
        return notFound(url);
    }
    return res;
}

// ==================== OPTIMIZED CACHE FUNCTION ====================
async function withCache(req, fn) {
    const url = new URL(req.url);

    // Hanya cache GET requests
    if (req.method !== 'GET') return fn();

    // DEV MODE - bypass cache untuk local development
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        console.log(`🔧 DEV MODE: ${url.pathname}`);
        const res = await fn();
        res.headers.set("X-Cache", "BYPASS-DEV");
        return res;
    }

    // Buat cache key yang konsisten (normalisasi URL)
    const cacheKey = new Request(url.toString(), {
        method: 'GET',
        headers: {
            'accept': req.headers.get('accept')?.split(',')[0] || '*/*'
        }
    });

    const cache = caches.default;

    // COBA AMBIL DARI CACHE DULU
    let res = await cache.match(cacheKey);
    if (res) {
        console.log(`⚡ CACHE HIT: ${url.pathname}`);
        // Refresh response untuk menambahkan header
        res = new Response(res.body, res);
        res.headers.set("X-Cache", "HIT");
        res.headers.set("X-Cache-Age", getCacheAge(res));
        return res;
    }

    // CACHE MISS - eksekusi function
    console.log(`🔄 CACHE MISS: ${url.pathname}`);
    res = await fn();

    // Jangan cache response error (kecuali redirect)
    if (!res.ok && ![301, 302].includes(res.status)) {
        return res;
    }

    // Clone response untuk cache
    res = new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: new Headers(res.headers)
    });

    // SET CACHE HEADER berdasarkan tipe konten
    const isStatic = url.pathname.match(/\.(css|js|jpg|jpeg|png|ico|svg|woff2?|webp|mp4|gif)$/i);
    const isVideoPage = url.pathname.startsWith('/e/');
    const isSearchPage = url.pathname.startsWith('/f/');
    const isListingPage = url.pathname.startsWith('/page/') || url.pathname === '/';

    if (isStatic) {
        // Static assets: cache 1 tahun
        res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
        res.headers.set("X-Cache-Type", "static");
    } else if (isVideoPage) {
        // Halaman video: cache 1 jam di browser, 24 jam di edge
        res.headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400");
        res.headers.set("X-Cache-Type", "video");
    } else if (isSearchPage) {
        // Halaman search: cache 30 menit (karena dinamis)
        res.headers.set("Cache-Control", "public, max-age=1800, s-maxage=3600, stale-while-revalidate=3600");
        res.headers.set("X-Cache-Type", "search");
    } else if (isListingPage) {
        // Halaman listing: cache 1 jam
        res.headers.set("Cache-Control", "public, max-age=3600, s-maxage=7200, stale-while-revalidate=7200");
        res.headers.set("X-Cache-Type", "listing");
    } else {
        // Default: cache 1 jam
        res.headers.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
        res.headers.set("X-Cache-Type", "default");
    }

    // Security Headers
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    res.headers.set("X-XSS-Protection", "1; mode=block");

    // Header tambahan untuk monitoring
    res.headers.set('X-Cache', 'MISS');
    res.headers.set('X-Cache-Date', new Date().toISOString());
    res.headers.set('X-Cache-Key', url.pathname);

    // Simpan ke cache
    await cache.put(cacheKey, res.clone());

    return res;
}

// Helper untuk menghitung umur cache
function getCacheAge(response) {
    const date = response.headers.get('date');
    if (!date) return 'unknown';
    const age = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    return `${age}s`;
}

// ==================== DATA FETCHING ====================
async function get(url, env, path) {
    try {
        const r = await env.ASSETS.fetch(new URL(path, url.origin));
        if (!r.ok) return null;

        const contentType = r.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            console.warn(`Expected JSON for ${path} but got ${contentType}`);
            return null;
        }

        return await r.json();
    } catch (e) {
        console.error(`Error fetching/parsing ${path}:`, e);
    }
    return null;
}

// ==================== UTILITY FUNCTIONS ====================
const norm = (t) => (t || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

function generateSrcset(imageUrl, widths = [320, 640, 960, 1280]) {
    if (!imageUrl) return "";
    return widths
        .map(w => `https://wsrv.nl/?url=${imageUrl}&w=${w}&q=${w > 800 ? 80 : 90}&output=webp&fit=cover ${w}w`)
        .join(', ');
}

function h(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const p2 = (t) => {
    const n = norm(t).replace(/\s+/g, "");
    return !n ? "__" : n.length === 1 ? n + "_" : n.slice(0, 2);
};

const p3 = (t) => {
    const n = norm(t).replace(/\s+/g, "");
    return !n ? "___" : n.length === 1 ? n + "__" : n.length === 2 ? n + "_" : n.slice(0, 3);
};

// ==================== CONFIGURATION ====================
const CONFIG = {
    name: "VideoSite",
    logo: "/images/logo.png",
    description: "Platform nomor satu untuk inspirasi gaya hijab modern, tutorial kecantikan, dan gaya hidup muslimah masa kini.",
    foundingDate: "2026-01-01",
    version: "1.0.1"
};



// ==================== PAGE HANDLERS ====================
async function detail(url, env) {
    const origin = url.origin;
    const id = url.pathname.split("/")[2];
    const lookup = await get(url, env, "/data/lookup_shard.json");
    if (!lookup || !lookup[id]) return notFound(url);

    const shardKey = lookup[id];
    const data = await get(url, env, `/data/detail/${shardKey}.json`);
    if (!data) return notFound(url);

    const v = data.find((x) => x.f === id);
    if (!v) return notFound(url);

    const titleWords = norm(v.t).split(" ").filter(w => w.length >= 3);
    const related = data
        .filter((x) => x.f !== id)
        .map((x) => {
            let score = 0;
            if (v.kt && x.kt && norm(v.kt) === norm(x.kt)) score += 20;

            const nt = norm(x.t);
            const matches = titleWords.filter((w) => nt.includes(w));
            score += matches.length * 10;

            if (matches.length >= 2) score += 30;

            return { ...x, _score: score };
        })
        .sort((a, b) => b._score - a._score || (parseInt(b.vw) || 0) - (parseInt(a.vw) || 0))
        .slice(0, 16);

    // Schema.org IDs
    const publisherId = `${origin}/#organization`;
    const websiteId = `${origin}/#website`;
    const webpageId = origin + url.pathname;
    const videoId = origin + url.pathname + "#video";
    const articleId = origin + url.pathname + "#article";
    const breadcrumbId = origin + url.pathname + "#breadcrumb";
    const itemListId = origin + url.pathname + "#related";

    const catName = v.kt || "Video";
    const catUrl = v.kt_url || `${origin}/f/video`;

    const durationISO = v.dr || "PT10M30S";
    const uploadDate = v.up || new Date().toISOString();
    const viewCount = parseInt(v.vw) || 0;
    const viewsFormatted = v.vw_fmt || v.vw || "0";
    const uploadFormatted = v.up_fmt || v.up || "";

    // Schema.org Graph dengan semua tipe yang diminta
    const schema = {
        "@context": "https://schema.org",
        "@graph": [
            // Organization
            {
                "@type": "Organization",
                "@id": publisherId,
                "name": CONFIG.name,
                "url": origin,
                "logo": {
                    "@type": "ImageObject",
                    "url": CONFIG.logo,
                    "width": 180,
                    "height": 180
                },
                "sameAs": CONFIG.socialMedia,
                "foundingDate": CONFIG.foundingDate,
                "description": CONFIG.description,
            },
            // WebSite dengan SiteNavigationElement
            {
                "@type": "WebSite",
                "@id": websiteId,
                "url": origin,
                "name": CONFIG.name,
                "publisher": { "@id": publisherId },
                "description": CONFIG.description,
                "inLanguage": "id-ID",
                "potentialAction": {
                    "@type": "SearchAction",
                    "target": {
                        "@type": "EntryPoint",
                        "urlTemplate": `${origin}/f/{search_term_string}`
                    },
                    "query-input": "required name=search_term_string"
                }
            },
            // WebPage
            {
                "@type": "WebPage",
                "@id": webpageId,
                "url": webpageId,
                "name": v.t_esc || h(v.t),
                "isPartOf": { "@id": websiteId },
                "description": v.ds_esc || v.ds || `Nonton streaming video ${v.t_esc || h(v.t)} kualitas HD gratis.`,
                "primaryImageOfPage": {
                    "@type": "ImageObject",
                    "url": v.sp || v.si,
                    "width": 1280,
                    "height": 720
                },
                "breadcrumb": { "@id": breadcrumbId },
                "datePublished": uploadDate,
                "dateModified": uploadDate,
                "inLanguage": "id-ID"
            },
            // VideoObject
            {
                "@type": "VideoObject",
                "@id": videoId,
                "name": v.t_esc || h(v.t),
                "description": v.ds_esc || v.ds || `Tonton video ${v.t_esc || h(v.t)} terbaru. Video viral dengan kualitas HD.`,
                "thumbnailUrl": [v.sp || v.si],
                "uploadDate": uploadDate,
                "duration": durationISO,
                "contentUrl": v.pe,
                "embedUrl": v.pe,
                "interactionStatistic": [
                    {
                        "@type": "InteractionCounter",
                        "interactionType": { "@type": "WatchAction" },
                        "userInteractionCount": viewCount
                    },
                    {
                        "@type": "InteractionCounter",
                        "interactionType": { "@type": "LikeAction" },
                        "userInteractionCount": Math.floor(viewCount * 0.1)
                    }
                ],
                "genre": v.kt ? [v.kt, "Viral", "Hiburan"] : ["Viral", "Hiburan", "Komedi"],
                "publisher": { "@id": publisherId },
                "regionsAllowed": "ID",
                "isFamilyFriendly": true,
                "keywords": v.tags ? v.tags.join(", ") : "video viral, konten lucu, hiburan",
                "potentialAction": {
                    "@type": "SeekToAction",
                    "target": `${webpageId}?t={seek_to_second_number}`,
                    "startOffset-input": "required name=seek_to_second_number"
                }
            },
            // BreadcrumbList dengan ListItem
            {
                "@type": "BreadcrumbList",
                "@id": breadcrumbId,
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": 1,
                        "name": "Beranda",
                        "item": origin
                    },
                    {
                        "@type": "ListItem",
                        "position": 2,
                        "name": catName,
                        "item": catUrl
                    },
                    {
                        "@type": "ListItem",
                        "position": 3,
                        "name": v.t,
                        "item": webpageId
                    }
                ]
            },
            // CreativeWork untuk konten utama
            {
                "@type": "CreativeWork",
                "@id": webpageId + "#creativework",
                "name": v.t_esc || h(v.t),
                "description": v.ds_esc || v.ds || `Nonton streaming video ${v.t_esc || h(v.t)} kualitas HD gratis.`,
                "about": v.kt || "Video",
                "keywords": v.tags ? v.tags.join(", ") : "video viral, konten lucu, hiburan",
                "datePublished": uploadDate,
                "dateModified": uploadDate,
                "author": { "@id": publisherId },
                "publisher": { "@id": publisherId }
            }
        ]
    };

    // ItemList untuk related videos dengan ListItem
    if (related.length > 0) {
        schema["@graph"].push({
            "@type": "ItemList",
            "@id": itemListId,
            "name": "Video Terkait Lainnya",
            "description": `Video-video terkait dengan ${v.t}`,
            "numberOfItems": related.length,
            "itemListElement": related.map((rv, index) => ({
                "@type": "ListItem",
                "position": index + 1,
                "item": {
                    "@type": "VideoObject",
                    "name": rv.t,
                    "url": `${origin}/e/${rv.f}`,
                    "thumbnailUrl": [rv.si || rv.sp],
                    "uploadDate": rv.up || uploadDate,
                    "description": rv.ds || `Nonton video ${rv.t} terbaru.`,
                    "duration": rv.dr || "PT10M30S"
                }
            }))
        });
    }

    // hentry microformat untuk artikel
    const breadcrumbsHtml = `
    <nav class="breadcrumbs" aria-label="Breadcrumb">
        <a href="/">Beranda</a> / 
        <a href="${catUrl}">${h(catName)}</a> / 
        <span>${h(v.t)}</span>
    </nav>
    `;

    const formatNumber = (num) => {
        if (!num) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    };

    const duration = v.ln || (v.d ? `${Math.floor(v.d / 60)}:${(v.d % 60).toString().padStart(2, '0')}` : '10:30');

    // Body dengan hentry microformat
    const body = `
    ${breadcrumbsHtml}
    
    <div class="player-section hentry" itemscope itemtype="https://schema.org/Article">
        <meta itemprop="headline" content="${v.t_esc}">
        <meta itemprop="description" content="${v.ds_esc || v.ds || `Nonton video ${v.t_esc} terbaru.`}">
        <meta itemprop="image" content="${v.sp || v.si}">
        <meta itemprop="datePublished" content="${uploadDate}">
        <meta itemprop="dateModified" content="${uploadDate}">
        <div itemprop="author" itemscope itemtype="https://schema.org/Person" style="display:none"><meta itemprop="name" content="Admin"></div>
        <div itemprop="publisher" itemscope itemtype="https://schema.org/Organization" style="display:none">
            <meta itemprop="name" content="${CONFIG.name}">
            <div itemprop="logo" itemscope itemtype="https://schema.org/ImageObject"><meta itemprop="url" content="${CONFIG.logo}"></div>
        </div>

        <div itemprop="video" itemscope itemtype="https://schema.org/VideoObject">
            <meta itemprop="name" content="${v.t_esc}">
            <meta itemprop="description" content="${v.ds_esc || v.ds || `Tonton video ${v.t_esc} terbaru.`}">
            <meta itemprop="thumbnailUrl" content="${v.sp || v.si}">
            <meta itemprop="uploadDate" content="${uploadDate}">
            <meta itemprop="duration" content="${durationISO}">
            <meta itemprop="contentUrl" content="${v.pe}">
            <meta itemprop="embedUrl" content="${v.pe}">
            <meta itemprop="interactionCount" content="${viewCount}">
        </div>
        
        <div class="video-wrapper" id="videoContainer">
            <img srcset="${generateSrcset(v.sp || v.si)}"
                 sizes="(max-width: 1000px) 100vw, 1000px"
                 src="https://wsrv.nl/?url=${v.sp || v.si}&w=1280&q=80&fit=cover&output=webp" 
                 alt="${h(v.t)} - VideoStream"
                 class="video-placeholder" id="mainThumbnail"
                 width="1280" height="720" loading="lazy">
            <button class="play-overlay" id="playTrigger" aria-label="Putar Video" data-video-url="${v.pe}">
                <div class="play-btn-large"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
            </button>
            <div id="playerFrameContainer" style="display:none; width:100%; height:100%;"></div>
        </div>

        <div class="video-info">
            <h1 class="video-title entry-title" itemprop="headline">${v.t_esc}</h1>
            <div class="video-meta entry-meta">
                <span class="badge"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${duration}</span>
                <span class="badge"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${v.vw_fmt}</span>
                <span class="badge"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="22" y2="10"/></svg> <span class="published" datetime="${uploadDate}">${v.up_fmt}</span></span>
                <span class="badge"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${CONFIG.name}</span>
            </div>
            
            <div class="video-description entry-content" itemprop="description">
                <p><strong>${v.t_esc}</strong> - ${v.ds_esc || `Streaming video viral terbaru ${v.t_esc}. Video ini menyajikan konten menarik yang wajib Anda saksikan hingga akhir.`}situs bokep terlengkap yang menyediakan ribuan akses video bokep gratis. Selain itu koleksi lengkap video AV terpopuler seperti video bokep AVTUB Bokepsin RajaColi Bokepsegar Playbokep Bokep IND ada disini.</p>
                <p>Durasi: ${duration} | Ukuran: ${v.sz || '125 MB'} | Kualitas: HD 720p | Genre: ${v.kt || 'Video, Viral'}</p>
                <p>${v.tags ? v.tags.map(t => '#' + t.replace(/\s+/g, '')).join(' ') : '#VideoViral #Lucu #Ngakak #Komedi2024'}</p>
            </div>
            
            <div class="btn-group" id="downloadGroup">
                <button class="btn btn-primary" id="generateBtn" onclick="showDownloadLink()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download Video</button>
                <div id="downloadContainer" style="display:none; width:100%;">
                    <a href="${v.pd || '#'}" class="btn btn-download-final pulse" target="_blank" rel="nofollow">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Klik untuk Download
                    </a>
                </div>
                <button class="btn btn-outline" onclick="copyVideoUrl()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h4"/><path d="M18 13v6a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3z"/></svg> Like (${formatNumber(v.vw)})</button>
                <button class="btn btn-outline" onclick="shareVideo()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share</button>
            </div>
        </div>
    </div>

    <section itemscope itemtype="https://schema.org/ItemList">
        <meta itemprop="name" content="Video Terkait Lainnya">
        <meta itemprop="description" content="Video-video terkait dengan ${h(v.t)}">
        <meta itemprop="numberOfItems" content="${related.length}">
        
        <h2 class="section-title"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="8" y1="2" x2="8" y2="22"/><line x1="16" y1="2" x2="16" y2="22"/><line x1="2" y1="8" x2="22" y2="8"/><line x1="2" y1="16" x2="22" y2="16"/></svg> Video Terkait Lainnya</h2>
        
        <div class="video-grid">
            ${related.map((rv, i) => {
        const rvDuration = rv.ln || (rv.d ? `${Math.floor(rv.d / 60)}:${(rv.d % 60).toString().padStart(2, '0')}` : '10:30');
        return `
                <div class="video-card" itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
                    <meta itemprop="position" content="${i + 1}">
                    <a href="/e/${rv.f}" itemprop="url" class="video-card-link">
                        <div class="card-thumb">
                            <img srcset="${generateSrcset(rv.si || rv.sp, [320, 640])}"
                                 sizes="(max-width: 600px) 100vw, (max-width: 1000px) 33vw, 300px"
                                 src="https://wsrv.nl/?url=${rv.si || rv.sp}&w=320&q=100&fit=cover&output=webp" 
                                 alt="${h(rv.t)}" loading="lazy" decoding="async" width="320" height="180">
                            <div class="card-hover-overlay"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
                            <span class="card-duration">${rvDuration}</span>
                        </div>
                    </a>
                    <div class="card-content">
                        <a href="/e/${rv.f}" style="text-decoration: none;">
                            <h3 class="card-title">${h(rv.t)}</h3>
                        </a>
                        <div class="card-stats">${formatNumber(rv.vw)} views • ${rv.up ? new Date(rv.up).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : 'baru'}</div>
                    </div>
                </div>
                `;
    }).join("")}
        </div>
    </section>
    `;

    const meta = {
        description: v.ds_esc || v.ds || `Nonton video ${v.t_esc || h(v.t)} terbaru. Streaming video viral dan terbaru hanya di ${CONFIG.name}.`,
        image: v.sp || v.si,
        canonical: `${origin}/e/${v.f}`,
        type: "article",
        robots: "index, follow",
        keywords: v.tags ? v.tags.join(", ") : "video viral, streaming video, konten lucu"
    };

    return render(v.t, body, schema, url, meta);
}

async function search(url, env) {
    const parts = url.pathname.split("/");
    const slug = parts[2] || "";
    const pathPage = parts[3];

    // Redirect lowercase normalization
    if (slug && slug !== slug.toLowerCase()) {
        const target = `/f/${slug.toLowerCase()}${pathPage ? '/' + pathPage : ''}${url.search}`;
        return Response.redirect(`${url.origin}${target}`, 301);
    }

    // Redirect /1 to clean URL
    if (pathPage === "1") {
        return Response.redirect(`${url.origin}/f/${slug}${url.search}`, 301);
    }

    let rawQ = slug || url.searchParams.get("q") || "";
    rawQ = decodeURIComponent(rawQ).replace(/-/g, " ").trim();

    if (rawQ.length < 2) return render("Search", '<div class="player-section" style="padding:2rem; text-align:center"><p>Minimal 2 karakter untuk mencari</p></div>', null, url);

    const qNorm = norm(rawQ);
    const keywords = qNorm.split(/\s+/).filter(w => w.length > 0);

    if (keywords.length === 0) return render("Search", '<div class="player-section" style="padding:2rem; text-align:center"><p>Minimal 2 karakter untuk mencari</p></div>', null, url);

    const prefixes = [...new Set(keywords.slice(0, 5).map((k) => p2(k)))];
    const dataPromises = prefixes.map(async (prefix) => {
        let d = await get(url, env, `/data/index/${prefix}.json`);
        if (!d) {
            const k = keywords.find((kw) => p2(kw) === prefix);
            if (k) {
                const prefix3 = p3(k);
                d = await get(url, env, `/data/index/${prefix}/${prefix3}.json`);
            }
        }
        return d || [];
    });

    const datasets = await Promise.all(dataPromises);
    const scoredResults = [];
    const seen = new Set();

    for (const dataset of datasets) {
        for (const item of dataset) {
            if (seen.has(item.f)) continue;
            seen.add(item.f);

            const tNorm = norm(item.t);
            let score = 0;
            let matchCount = 0;

            if (tNorm === qNorm) score += 10000;
            else if (tNorm.includes(qNorm)) score += 5000;

            for (const kw of keywords) {
                if (tNorm.includes(kw)) {
                    matchCount++;
                    score += 100;
                    if (tNorm.startsWith(kw) || tNorm.includes(" " + kw)) {
                        score += 50;
                    }
                }
            }

            if (matchCount === 0) continue;
            if (matchCount === keywords.length) score += 2000;

            const views = parseInt(item.vw) || 0;
            score += Math.log10(views + 1) * 10;

            scoredResults.push({
                ...item,
                _score: score,
                _views: views
            });
        }
    }

    if (scoredResults.length === 0) {
        return render(`Pencarian: ${h(rawQ)}`,
            `<div class="player-section" style="padding:2rem; text-align:center">
                <p>Tidak ditemukan video untuk "${h(rawQ)}"</p>
                <a href="/" class="btn btn-primary" style="margin-top:1rem; display:inline-block">Kembali ke Beranda</a>
            </div>`,
            null, url, { robots: "noindex, follow" }
        );
    }

    const totalResults = scoredResults.length;
    const totalPages = Math.ceil(totalResults / 50);

    // Extract page from path or query param
    const p = pathPage || url.searchParams.get("p") || "1";
    let currentPage = parseInt(p);
    if (isNaN(currentPage) || currentPage < 1) currentPage = 1;
    if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;

    const res = scoredResults
        .sort((a, b) => b._score - a._score || b._views - a._views)
        .slice((currentPage - 1) * 50, currentPage * 50);

    const offset = (currentPage - 1) * 50;

    const origin = url.origin;
    const publisherId = `${origin}/#organization`;
    const websiteId = `${origin}/#website`;
    const webpageId = origin + url.pathname;
    const itemListId = webpageId + "#itemlist";

    const searchSchema = {
        "@context": "https://schema.org",
        "@graph": [
            // Organization
            {
                "@type": "Organization",
                "@id": publisherId,
                "name": CONFIG.name,
                "url": origin,
                "logo": { "@type": "ImageObject", "url": CONFIG.logo },
                "sameAs": CONFIG.socialMedia
            },
            // WebSite dengan SiteNavigationElement
            {
                "@type": "WebSite",
                "@id": websiteId,
                "url": origin,
                "name": CONFIG.name,
                "publisher": { "@id": publisherId },
                "potentialAction": {
                    "@type": "SearchAction",
                    "target": `${origin}/f/{search_term_string}`,
                    "query-input": "required name=search_term_string"
                }
            },
            // WebPage
            {
                "@type": "WebPage",
                "@id": webpageId,
                "url": webpageId,
                "name": currentPage === 1 ? `Hasil Pencarian: ${h(rawQ)} - ${CONFIG.name}` : `Hasil Pencarian: ${h(rawQ)} (Halaman ${currentPage}) - ${CONFIG.name}`,
                "isPartOf": { "@id": websiteId },
                "description": `Hasil pencarian video untuk '${h(rawQ)}' di ${CONFIG.name} - Halaman ${currentPage}. Temukan video viral dan terbaru.`
            },
            // ItemList dengan ListItem
            {
                "@type": "ItemList",
                "@id": itemListId,
                "name": `Hasil Pencarian: ${h(rawQ)}`,
                "description": `Ditemukan ${totalResults} video untuk kata kunci "${h(rawQ)}"`,
                "numberOfItems": totalResults,
                "itemListElement": res.map((v, index) => ({
                    "@type": "ListItem",
                    "position": offset + index + 1,
                    "url": `${origin}/e/${v.f}`,
                    "name": v.t,
                    "image": v.si || v.sp
                }))
            }
        ]
    };

    const searchUrlPart = encodeURIComponent(rawQ.replace(/\s+/g, '-'));

    const body = `
    <div class="player-section" style="padding:1.5rem" itemscope itemtype="https://schema.org/ItemList">
        <meta itemprop="name" content="Hasil Pencarian: ${h(rawQ)}">
        <meta itemprop="description" content="Ditemukan ${totalResults} video untuk kata kunci '${h(rawQ)}'">
        <meta itemprop="numberOfItems" content="${totalResults}">
        
        <h1 class="video-title" style="margin-bottom:1rem" itemprop="name">Hasil Pencarian: "${h(rawQ)}"</h1>
        <p style="color: #666; margin-bottom:1.5rem">Ditemukan ${totalResults} video - Halaman ${currentPage} dari ${totalPages}</p>
        
        <div class="video-grid">
            ${res.map((v, index) => {
        const duration = v.ln || "10:30";
        return `
                <div class="video-card" itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
                    <meta itemprop="position" content="${offset + index + 1}">
                    <a href="/e/${v.f}" itemprop="url" class="video-card-link">
                        <div class="card-thumb">
                            <img srcset="${generateSrcset(v.si || v.sp, [320, 640])}"
                                 sizes="(max-width: 600px) 100vw, (max-width: 1000px) 33vw, 300px"
                                 src="https://wsrv.nl/?url=${v.si || v.sp}&w=320&q=100&fit=cover&output=webp" 
                                 alt="${v.t_esc || h(v.t)}" loading="lazy" decoding="async" width="320" height="180">
                            <div class="card-hover-overlay"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
                            <span class="card-duration">${duration}</span>
                        </div>
                    </a>
                    <div class="card-content">
                        <a href="/e/${v.f}" style="text-decoration: none;">
                            <h3 class="card-title">${v.t_esc || h(v.t)}</h3>
                        </a>
                        <div class="card-stats">${v.vw_fmt || v.vw || "0"} views</div>
                    </div>
                </div>
                `;
    }).join("")}
        </div>

        <div class="pagination">
            ${currentPage > 1 ? `<a href="/f/${searchUrlPart}${currentPage === 2 ? '' : '/' + (currentPage - 1)}" class="pagination-link">← Sebelumnya</a>` : ""}
            <span class="pagination-current">Halaman ${currentPage} dari ${totalPages}</span>
            ${currentPage < totalPages ? `<a href="/f/${searchUrlPart}/${currentPage + 1}" class="pagination-link pagination-next">Berikutnya →</a>` : ""}
        </div>
    </div>
    `;

    const escapedQ = h(rawQ);
    const seoMeta = {
        description: `Hasil pencarian video untuk '${escapedQ}' di ${CONFIG.name} - Halaman ${currentPage}. Temukan video viral dan terbaru.`,
        canonical: currentPage === 1 ? `${url.origin}/f/${searchUrlPart}` : `${url.origin}/f/${searchUrlPart}/${currentPage}`,
        robots: currentPage === 1 ? "index, follow" : "noindex, follow",
        type: "website",
    };

    return render(`Pencarian: ${escapedQ}`, body, searchSchema, url, seoMeta);
}

async function list(url, env, pageParam) {
    const p = pageParam || url.pathname.split("/")[2];
    const page = parseInt(p || "1");
    const meta = await get(url, env, "/data/meta.json");
    if (!meta) return notFound(url);
    const data = await get(url, env, `/data/list/${page}.json`);
    if (!data) return notFound(url);

    const files = data.result?.files || [];

    const origin = url.origin;
    const publisherId = `${origin}/#organization`;
    const websiteId = `${origin}/#website`;
    const webpageId = origin + url.pathname;
    const itemListId = webpageId + "#itemlist";

    const listSchema = {
        "@context": "https://schema.org",
        "@graph": [
            // Organization
            {
                "@type": "Organization",
                "@id": publisherId,
                "name": CONFIG.name,
                "url": origin,
                "logo": { "@type": "ImageObject", "url": CONFIG.logo },
                "sameAs": CONFIG.socialMedia
            },
            // WebSite dengan SiteNavigationElement
            {
                "@type": "WebSite",
                "@id": websiteId,
                "url": origin,
                "name": CONFIG.name,
                "publisher": { "@id": publisherId },
                "description": CONFIG.description
            },
            // WebPage
            {
                "@type": "WebPage",
                "@id": webpageId,
                "url": webpageId,
                "name": page === 1 ? `${CONFIG.name} - Video Terbaru` : `Video Terbaru - Halaman ${page}`,
                "isPartOf": { "@id": websiteId },
                "description": `Daftar video terbaru koleksi ${CONFIG.name} - Halaman ${page}. Platform streaming video viral terlengkap.`
            },
            // ItemList dengan ListItem
            {
                "@type": "ItemList",
                "@id": itemListId,
                "name": page === 1 ? "Video Terbaru" : `Video Terbaru - Halaman ${page}`,
                "description": `Koleksi video terbaru di ${CONFIG.name} - Halaman ${page}`,
                "numberOfItems": files.length,
                "itemListElement": files.map((v, index) => ({
                    "@type": "ListItem",
                    "position": index + 1,
                    "url": `${origin}/e/${v.file_code}`,
                    "name": v.title,
                    "image": v.single_img
                }))
            }
        ]
    };

    const body = `
    <div class="player-section" style="padding:1.5rem" itemscope itemtype="https://schema.org/ItemList">
        <meta itemprop="name" content="${page === 1 ? 'Video Terbaru' : `Video Terbaru - Halaman ${page}`}">
        <meta itemprop="description" content="Koleksi video terbaru di ${CONFIG.name} - Halaman ${page}">
        <meta itemprop="numberOfItems" content="${files.length}">
        
        <h1 class="video-title" style="margin-bottom:1rem" itemprop="name">Video Terbaru - Halaman ${page}</h1>
        
        <div class="video-grid">
            ${files.map((v, index) => {
        return `
                <div class="video-card" itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
                    <meta itemprop="position" content="${index + 1}">
                    <a href="/e/${v.file_code}" itemprop="url" class="video-card-link">
                        <div class="card-thumb">
                            <img srcset="${generateSrcset(v.single_img, [320, 640])}"
                                 sizes="(max-width: 600px) 100vw, (max-width: 1000px) 33vw, 300px"
                                 src="https://wsrv.nl/?url=${v.single_img}&w=320&q=100&fit=cover&output=webp" 
                                 alt="${v.t_esc || h(v.title)}" loading="lazy" decoding="async" width="320" height="180">
                            <div class="card-hover-overlay"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
                            <span class="card-duration">${v.length || '10:30'}</span>
                        </div>
                    </a>
                    <div class="card-content">
                        <a href="/e/${v.file_code}" style="text-decoration: none;">
                            <h3 class="card-title">${v.t_esc || h(v.title)}</h3>
                        </a>
                        <div class="card-stats">${v.vw_fmt || v.views || "0"} views</div>
                    </div>
                </div>
                `;
    }).join("")}
        </div>
        
        <div class="pagination">
            ${page > 1 ? `<a href="${page === 2 ? "/" : `/page/${page - 1}`}" class="pagination-link">← Sebelumnya</a>` : ""}
            <span class="pagination-current">Halaman ${page}</span>
            ${page < Math.ceil(meta.total / 200) ? `<a href="/page/${page + 1}" class="pagination-link pagination-next">Berikutnya →</a>` : ""}
        </div>
    </div>
    `;

    const seoMeta = {
        description: `Daftar video terbaru koleksi ${CONFIG.name} - Halaman ${page}. Platform streaming video viral terlengkap.`,
        canonical: page === 1 ? url.origin : `${url.origin}/page/${page}`,
        robots: page === 1 ? "index, follow" : "noindex, follow",
        type: "website",
    };

    return render(`Daftar Video - Hal ${page}`, body, listSchema, url, seoMeta);
}

async function sitemap(url, env) {
    const meta = await get(url, env, "/data/meta.json");
    let out = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
    out += `<url><loc>${url.origin}</loc></url>`;
    for (let i = 1; i <= Math.ceil((meta?.total || 0) / 200); i++) {
        const loc = i === 1 ? url.origin : `${url.origin}/page/${i}`;
        out += `<url><loc>${loc}</loc></url>`;
    }
    return new Response(out + "</urlset>", { headers: { "content-type": "application/xml" } });
}

async function videoSitemap(url, env) {
    const lookup = await get(url, env, "/data/lookup_shard.json");
    let out = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">`;
    let c = 0;
    for (let id in lookup) {
        if (c++ > 1000) break;
        out += `<url><loc>${url.origin}/e/${id}</loc><video:video><video:title>Video ${id}</video:title></video:video></url>`;
    }
    return new Response(out + "</urlset>", { headers: { "content-type": "application/xml" } });
}

function robots(req) {
    const url = new URL(req.url);
    return new Response("User-agent: *\nAllow: /\nSitemap: https://" + url.hostname + "/sitemap.xml", { headers: { "content-type": "text/plain" } });
}

function render(t, b, schema, url, meta = {}) {
    const origin = url.origin;
    const canonical = meta.canonical || url.href;
    const description = meta.description || `Situs streaming video viral dan terbaru terlengkap. Nonton video HD gratis hanya di ${CONFIG.name}.`;
    const image = meta.image || CONFIG.logo;
    const keywords = meta.keywords || "video viral, streaming video, video lucu, hiburan, konten viral 2024";
    const siteTitle = `${t} - ${CONFIG.name}`;



    const script = `
      function initIcons(){"undefined"!=typeof lucide&&lucide.createIcons()}function copyVideoUrl(){const e=window.location.href;navigator.clipboard.writeText(e).then((()=>{alert("URL video berhasil disalin!")})).catch((()=>{alert("Gagal menyalin URL")}))}function showDownloadLink(){const e=document.getElementById("generateBtn"),t=document.getElementById("downloadContainer");e&&t&&(e.disabled=!0,e.innerHTML='<svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Generating Link...',setTimeout((()=>{e.style.display="none",t.style.display="block"}),2e3))}function shareVideo(){navigator.share?navigator.share({title:document.title,text:document.querySelector('meta[name="description"]')?.content||"Nonton video viral di VideoStream",url:window.location.href}).catch((()=>{})):copyVideoUrl()}document.addEventListener("DOMContentLoaded",(()=>{const e=document.getElementById("themeToggle"),t=(document.getElementById("themeIcon"),document.getElementById("searchBtn")),n=document.getElementById("searchModal"),i=document.getElementById("closeSearch"),o=document.getElementById("playTrigger"),a=document.getElementById("playerFrameContainer"),d=document.getElementById("mainThumbnail"),s=document.getElementById("mainContent"),c=document.getElementById("mobileMenuBtn"),l=document.getElementById("mobileMenu"),r=document.getElementById("menuOverlay"),m=document.getElementById("closeMobileMenu");function g(){l&&l.classList.remove("active"),r&&r.classList.remove("active"),document.body.classList.remove("mobile-menu-open"),s&&s.classList.remove("menu-open")}c&&c.addEventListener("click",(e=>{e.stopPropagation(),l&&l.classList.add("active"),r&&r.classList.add("active"),document.body.classList.add("mobile-menu-open"),s&&s.classList.add("menu-open")})),m&&m.addEventListener("click",(e=>{e.stopPropagation(),g()})),r&&r.addEventListener("click",(()=>{g()})),window.addEventListener("resize",(()=>{window.innerWidth>=768&&g()})),e&&e.addEventListener("click",(()=>{const t=document.documentElement.classList.toggle("dark");e&&(e.innerHTML='<i data-lucide="'+(t?"sun":"moon")+'"></i>'),initIcons(),localStorage.setItem("theme",t?"dark":"light")})),t&&t.addEventListener("click",(()=>{n&&n.classList.add("active")})),i&&i.addEventListener("click",(()=>{n&&n.classList.remove("active")})),n&&n.addEventListener("click",(e=>{e.target===n&&n.classList.remove("active")})),o&&a&&d&&o.addEventListener("click",(()=>{const e=o.getAttribute("data-video-url")||"#";o.style.display="none",d.style.display="none",a.style.display="block",a.innerHTML='<iframe src="'+e+'" frameborder="0" allow="autoplay; fullscreen" style="width:100%; height:100%;" title="Video Player - '+document.title+'"></iframe>'}));const u=localStorage.getItem("theme");"light"===u?(document.documentElement.classList.remove("dark"),e&&(e.innerHTML='<i data-lucide="moon"></i>'),initIcons()):u&&"dark"!==u||(document.documentElement.classList.add("dark"),e&&(e.innerHTML='<i data-lucide="sun"></i>'),initIcons()),"serviceWorker"in navigator&&window.addEventListener("load",(()=>{navigator.serviceWorker.register("/sw.js").then((e=>{console.log("SW registered:",e.scope)})).catch((e=>{console.log("SW registration failed:",e)}))})),document.addEventListener("error",(e=>{const t=e.target;if("IMG"===t.tagName){const e="/images/placeholder.webp",n="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%231f1f1f'/%3E%3Cpath d='M30 40 L70 40 L50 70 Z' fill='%23333'/%3E%3C/svg%3E";t.src.includes(e)?t.src=n:t.src.startsWith("data:")||(t.style.opacity="0.7",t.src=e,t.classList.add("img-error"))}}),!0)}));
    `;

    return new Response(
        `<!doctype html><html lang="id" class="dark"><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script>
        (function() {
            const theme = localStorage.getItem('theme');
            if (theme === 'light') {
                document.documentElement.classList.remove('dark');
            } else {
                document.documentElement.classList.add('dark');
            }
        })();
    </script>
    <title>${siteTitle}</title>
    <meta name="description" content="${description}">
    <meta name="keywords" content="${keywords}">
    <meta name="robots" content="${meta.robots || "index, follow"}">
    <link rel="canonical" href="${canonical}">
    <link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/images/favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/images/apple-touch-icon.png">
    <link rel="shortcut icon" href="/images/favicon.ico">
    
    <meta property="og:site_name" content="${CONFIG.name}">
    <meta property="og:title" content="${siteTitle}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${image}">
    <meta property="og:type" content="${meta.type || "website"}">
    
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${siteTitle}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${image}">
    ${schema ? `<script type="application/ld+json">${JSON.stringify(schema, null, 2)}</script>` : ""}
    
    <link rel="stylesheet" href="/css/main.css?v=${CONFIG.version}">
    </head><body>
    
    <div class="menu-overlay" id="menuOverlay"></div>

    <aside class="mobile-menu" id="mobileMenu">
        <div class="mobile-menu-header">
            <span class="mobile-menu-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                Menu
            </span>
            <button class="icon-btn" id="closeMobileMenu" aria-label="Tutup Menu">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
        
        <nav class="mobile-menu-links" itemscope itemtype="https://schema.org/SiteNavigationElement">
            <a href="/" itemprop="url">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                <span itemprop="name">Beranda</span>
            </a>
            <a href="/" itemprop="url">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8 10 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                <span itemprop="name">Populer</span>
            </a>
            <a href="/" itemprop="url">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                <span itemprop="name">Kategori</span>
            </a>
            <a href="/" itemprop="url">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span itemprop="name">Terbaru</span>
            </a>
        </nav>
        
        <div class="mobile-menu-footer">
            <p>&copy; 2024 VideoStream</p>
            <p style="font-size: 0.7rem; margin-top: 4px;">v1.0.0</p>
        </div>
    </aside>

    <header>
        <div class="container header-content">
            <a href="/" class="logo">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>${CONFIG.name}</span>
            </a>

            <nav class="nav-links" itemscope itemtype="https://schema.org/SiteNavigationElement">
                <a href="/" itemprop="url"><span itemprop="name">Beranda</span></a>
                <a href="/" itemprop="url"><span itemprop="name">Populer</span></a>
                <a href="/" itemprop="url"><span itemprop="name">Kategori</span></a>
                <a href="/" itemprop="url"><span itemprop="name">Terbaru</span></a>
            </nav>

            <div class="actions">
                <button class="icon-btn" id="searchBtn" aria-label="Cari video">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
                <button class="icon-btn" id="themeToggle" aria-label="Ganti Tema">
                    <i data-lucide="sun"></i>
                </button>
                <button class="icon-btn mobile-menu-btn" id="mobileMenuBtn" aria-label="Menu">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
            </div>
        </div>
    </header>

    <main class="container" id="mainContent">${b}</main>

    <div class="modal" id="searchModal" role="dialog" aria-modal="true">
        <div class="modal-content">
            <button class="close-modal" id="closeSearch" aria-label="Tutup">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <h3 style="font-weight: 700; font-size: 0.9375rem;">Cari Video</h3>
            <form class="search-form" action="/f/" method="get" onsubmit="event.preventDefault(); var v=this.q.value.trim().toLowerCase().replace(/\\s+/g,'-'); if(v) window.location.href='/f/'+encodeURIComponent(v)">
                <input type="search" name="q" class="search-input" placeholder="Ketik kata kunci..." autofocus>
                <button type="submit" class="btn btn-primary">Cari</button>
            </form>
        </div>
    </div>

    <footer>
        <div class="container">&copy; 2024 ${CONFIG.name}. All rights reserved. - Platform Video Viral No.1 di Indonesia</div>
    </footer>

    <script>${script}</script>
    <input type="checkbox" id="ad-closer">
    <div class="ad-container-auto">
        <label for="ad-closer" class="close-ad-btn" title="Tutup Iklan">✕</label>
        <div>
            <script async data-cfasync="false" data-clbaid="" src="//deductgreedyheadroom.com/bn.js"></script>
            <div data-cl-spot="1869256"></div>
        </div>
    </div>
    
    </body></html>`,
        {
            headers: {
                "content-type": "text/html; charset=utf-8",
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "Referrer-Policy": "strict-origin-when-cross-origin",
                "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
                "X-XSS-Protection": "1; mode=block"
            }
        }
    );
}

function notFound(url, meta = {}) {
    const res = render("Halaman Tidak Ditemukan", '<div class="player-section" style="padding:2rem; text-align:center"><h1>404 - Halaman Tidak Ditemukan</h1><p>Maaf, halaman yang Anda cari tidak ada.</p><a href="/" class="btn btn-primary" style="margin-top:1rem; display:inline-block">Kembali ke Beranda</a></div>', null, url, { ...meta, robots: "noindex, nofollow" });
    return new Response(res.body, { ...res, status: 404 });
}