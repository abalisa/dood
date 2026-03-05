// functions/[[path]].js
// Cloudflare Pages Functions format

export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === "/" || p === "") return withCache(request, () => list(url, env, "1"));
    if (p === "/robots.txt") return robots();
    if (p === "/sitemap.xml") return sitemap(url, env);
    if (p === "/video-sitemap.xml") return videoSitemap(url, env);

    if (p.startsWith("/e/")) return withCache(request, () => detail(url, env));
    if (p.startsWith("/f/")) return withCache(request, () => search(url, env));
    if (p.startsWith("/page/")) return withCache(request, () => list(url, env));

    return next();
}

async function withCache(req, fn) {
    const url = new URL(req.url);
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const noCache = url.searchParams.has("nocache");

    if (isLocal || noCache) return fn();

    const cache = caches.default;
    let res = await cache.match(req);
    if (res) return res;
    res = await fn();
    res = new Response(res.body, res);
    res.headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
    await cache.put(req, res.clone());
    return res;
}

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

const norm = (t) => (t || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const h = (t) => (t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const p2 = (t) => {
    const n = norm(t).replace(/\s+/g, "");
    return !n ? "__" : n.length === 1 ? n + "_" : n.slice(0, 2);
};
const p3 = (t) => {
    const n = norm(t).replace(/\s+/g, "");
    return !n ? "___" : n.length === 1 ? n + "__" : n.length === 2 ? n + "_" : n.slice(0, 3);
};

const CONFIG = {
    name: "VideoStream",
    logo: "/images/apple-touch-icon.png",
};

const IMG_ERR = "this.onerror=null;this.src='data:image/svg+xml,%3Csvg%20width=%22200%22%20height=%22200%22%20viewBox=%220%200%20100%20100%22%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Crect%20width=%22100%22%20height=%22100%22%20fill=%22%23FEF2F2%22/%3E%3Ctext%20x=%2250%22%20y=%2250%22%20text-anchor=%22middle%22%20dominant-baseline=%22middle%22%20fill=%22%23F87171%22%20style=%22font-family:sans-serif;font-size:10px;font-weight:bold%22%3EIMAGE%20ERROR%3C/text%3E%3C/svg%3E';";

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

    const publisherId = `${origin}/#organization`;
    const siteId = `${origin}/#website`;

    const catName = v.kt || "Video";
    const catSlug = norm(catName).replace(/\s+/g, "-");
    const catUrl = `${origin}/f/${catSlug}`;

    const schema = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Organization",
                "@id": publisherId,
                name: CONFIG.name,
                url: origin,
                logo: { "@type": "ImageObject", url: CONFIG.logo },
                sameAs: [
                    "https://www.facebook.com/videostream",
                    "https://twitter.com/videostream",
                    "https://www.instagram.com/videostream"
                ]
            },
            {
                "@type": "WebSite",
                "@id": siteId,
                url: origin,
                name: CONFIG.name,
                publisher: { "@id": publisherId },
                description: "Situs streaming video viral terbaru dan terlengkap 2024",
                inLanguage: "id-ID"
            },
            {
                "@type": "WebPage",
                "@id": origin + url.pathname,
                url: origin + url.pathname,
                name: h(v.t),
                isPartOf: { "@id": siteId },
                description: v.ds || `Nonton streaming video ${v.t} kualitas HD gratis.`,
                primaryImageOfPage: {
                    "@type": "ImageObject",
                    url: v.sp || v.si,
                    width: 1280,
                    height: 720
                }
            },
            {
                "@type": "VideoObject",
                "@id": origin + url.pathname + "#video",
                name: h(v.t),
                description: v.ds || `Tonton video ${v.t} terbaru.`,
                thumbnailUrl: v.sp || v.si,
                uploadDate: v.up || new Date().toISOString(),
                duration: v.dr || `PT${v.d || 0}S`,
                contentUrl: v.pe,
                embedUrl: v.pe,
                interactionStatistic: {
                    "@type": "InteractionCounter",
                    interactionType: { "@type": "WatchAction" },
                    userInteractionCount: v.vw || 0,
                },
                genre: ["Komedi", "Viral", "Lucu"],
                publisher: { "@id": publisherId }
            },
            {
                "@type": "Article",
                "@id": origin + url.pathname + "#article",
                headline: h(v.t),
                description: v.ds || `Nonton streaming video ${v.t} kualitas HD gratis.`,
                image: {
                    "@type": "ImageObject",
                    url: v.sp || v.si,
                    width: 1280,
                    height: 720
                },
                datePublished: v.up || new Date().toISOString(),
                dateModified: v.up || new Date().toISOString(),
                author: { "@id": publisherId },
                publisher: { "@id": publisherId },
                mainEntityOfPage: { "@id": origin + url.pathname },
                video: { "@id": origin + url.pathname + "#video" }
            },
            {
                "@type": "BreadcrumbList",
                "@id": origin + url.pathname + "#breadcrumb",
                itemListElement: [
                    { "@type": "ListItem", position: 1, name: "Beranda", item: origin },
                    { "@type": "ListItem", position: 2, name: catName, item: catUrl },
                    { "@type": "ListItem", position: 3, name: v.t, item: origin + url.pathname }
                ]
            }
        ],
    };

    const breadcrumbsHtml = `
    <nav class="breadcrumbs" aria-label="Breadcrumb">
        <a href="/">Beranda</a> / 
        <a href="${catUrl}">${h(catName)}</a> / 
        <span>${h(v.t)}</span>
    </nav>
    `;

    const formatNumber = (num) => {
        if (!num) return '0';
        if (num >= 1000000) return (num/1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num/1000).toFixed(1) + 'K';
        return num.toString();
    };

    const duration = v.ln || (v.d ? `${Math.floor(v.d/60)}:${(v.d%60).toString().padStart(2,'0')}` : '10:30');

    const body = `
    ${breadcrumbsHtml}
    
    <div class="player-section">
        <div class="video-wrapper" id="videoContainer">
            <img src="${v.sp || v.si}" alt="${h(v.t)} - VideoStream"
                 class="video-placeholder" id="mainThumbnail"
                 width="1280" height="720" loading="lazy" onerror="${IMG_ERR}">
            <button class="play-overlay" id="playTrigger" aria-label="Putar Video" data-video-url="${v.pe}">
                <div class="play-btn-large"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
            </button>
            <div id="playerFrameContainer" style="display:none; width:100%; height:100%;"></div>
        </div>

        <div class="video-info">
            <h1 class="video-title">${h(v.t)}</h1>
            <div class="video-meta">
                <span class="badge"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${duration}</span>
                <span class="badge"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${formatNumber(v.vw)}</span>
                <span class="badge"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${new Date(v.up).toLocaleDateString('id-ID', {day:'numeric', month:'short', year:'numeric'})}</span>
                <span class="badge"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${CONFIG.name}</span>
            </div>
            
            <div class="video-description">
                <p><strong>${h(v.t)}</strong> - ${v.ds || `Streaming video viral terbaru ${v.t}. Video ini menyajikan konten menarik yang wajib Anda saksikan hingga akhir.`}</p>
                <p>Durasi: ${duration} | Ukuran: ${v.sz || '125 MB'} | Kualitas: HD 720p | Genre: ${v.kt || 'Komedi, Viral'}</p>
                <p>${v.tags ? v.tags.map(t => '#' + t.replace(/\s+/g, '')).join(' ') : '#VideoViral #Lucu #Ngakak #Komedi2024'}</p>
            </div>
            
            <div class="btn-group">
                <a href="${v.dl || '#'}" class="btn btn-primary" download><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download Video</a>
                <button class="btn btn-outline" onclick="copyVideoUrl()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h4"/><path d="M18 13v6a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3z"/></svg> Like (${formatNumber(v.vw)})</button>
                <button class="btn btn-outline" onclick="shareVideo()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share</button>
            </div>
        </div>
    </div>

    <section>
        <h2 class="section-title"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="8" y1="2" x2="8" y2="22"/><line x1="16" y1="2" x2="16" y2="22"/><line x1="2" y1="8" x2="22" y2="8"/><line x1="2" y1="16" x2="22" y2="16"/></svg> Video Terkait Lainnya</h2>
        <div class="video-grid">
            ${related.map((rv, i) => {
                const rvDuration = rv.ln || (rv.d ? `${Math.floor(rv.d/60)}:${(rv.d%60).toString().padStart(2,'0')}` : '10:30');
                return `
                <div class="video-card">
                    <a href="/e/${rv.f}" class="video-card-link">
                        <div class="card-thumb">
                            <img src="${rv.si || rv.sp}" alt="${h(rv.t)}" loading="lazy" decoding="async" width="320" height="180" onerror="${IMG_ERR}">
                            <div class="card-hover-overlay"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
                            <span class="card-duration">${rvDuration}</span>
                        </div>
                    </a>
                    <div class="card-content">
                        <a href="/e/${rv.f}" style="text-decoration: none;">
                            <h3 class="card-title">${h(rv.t)}</h3>
                        </a>
                        <div class="card-stats">${formatNumber(rv.vw)} views • ${rv.up ? new Date(rv.up).toLocaleDateString('id-ID', {day:'numeric', month:'short'}) : 'baru'}</div>
                    </div>
                </div>
                `;
            }).join("")}
        </div>
    </section>
    `;

    const meta = {
        description: v.ds || `Nonton video ${v.t} terbaru. Streaming video viral dan terbaru hanya di ${CONFIG.name}.`,
        image: v.sp || v.si,
        canonical: `${origin}/e/${v.f}`,
        type: "video.other",
        robots: "index, follow",
    };

    return render(v.t, body, schema, url, meta);
}

async function search(url, env) {
    const parts = url.pathname.split("/");
    let rawQ = parts[2] || url.searchParams.get("q") || "";
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

    const res = scoredResults
        .sort((a, b) => b._score - a._score || b._views - a._views)
        .slice(0, 50);

    const formatNumber = (num) => {
        if (!num) return '0';
        if (num >= 1000000) return (num/1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num/1000).toFixed(1) + 'K';
        return num.toString();
    };

    const body = `
    <div class="player-section" style="padding:1.5rem">
        <h1 class="video-title" style="margin-bottom:1rem">Hasil Pencarian: "${h(rawQ)}"</h1>
        <p style="color: #666; margin-bottom:1.5rem">Ditemukan ${res.length} video</p>
        
        <div class="video-grid">
            ${res.map((v) => {
                const duration = v.ln || (v.d ? `${Math.floor(v.d/60)}:${(v.d%60).toString().padStart(2,'0')}` : '10:30');
                return `
                <div class="video-card">
                    <a href="/e/${v.f}" class="video-card-link">
                        <div class="card-thumb">
                            <img src="${v.si || v.sp}" alt="${h(v.t)}" loading="lazy" decoding="async" width="320" height="180" onerror="${IMG_ERR}">
                            <div class="card-hover-overlay"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
                            <span class="card-duration">${duration}</span>
                        </div>
                    </a>
                    <div class="card-content">
                        <a href="/e/${v.f}" style="text-decoration: none;">
                            <h3 class="card-title">${h(v.t)}</h3>
                        </a>
                        <div class="card-stats">${formatNumber(v.vw)} views</div>
                    </div>
                </div>
                `;
            }).join("")}
        </div>
    </div>
    `;

    const escapedQ = h(rawQ);
    const seoMeta = {
        description: `Hasil pencarian video untuk '${escapedQ}' di ${CONFIG.name}. Temukan video viral dan terbaru.`,
        canonical: `${url.origin}/f/${encodeURIComponent(rawQ.replace(/\s+/g, "-"))}`,
        robots: "index, follow",
    };

    return render(`Pencarian: ${escapedQ}`, body, null, url, seoMeta);
}

async function list(url, env, pageParam) {
    const p = pageParam || url.pathname.split("/")[2];
    const page = parseInt(p || "1");
    const meta = await get(url, env, "/data/meta.json");
    if (!meta) return notFound(url);
    const data = await get(url, env, `/data/list/${page}.json`);
    if (!data) return notFound(url);

    const files = data.result?.files || [];

    const formatNumber = (num) => {
        if (!num) return '0';
        if (num >= 1000000) return (num/1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num/1000).toFixed(1) + 'K';
        return num.toString();
    };

    const body = `
    <div class="player-section" style="padding:1.5rem">
        <h1 class="video-title" style="margin-bottom:1rem">Video Terbaru - Halaman ${page}</h1>
        
        <div class="video-grid">
            ${files.map((v) => {
                return `
                <div class="video-card">
                    <a href="/e/${v.file_code}" class="video-card-link">
                        <div class="card-thumb">
                            <img src="${v.single_img}" alt="${h(v.title)}" loading="lazy" decoding="async" width="320" height="180" onerror="${IMG_ERR}">
                            <div class="card-hover-overlay"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
                            <span class="card-duration">${v.length || '10:30'}</span>
                        </div>
                    </a>
                    <div class="card-content">
                        <a href="/e/${v.file_code}" style="text-decoration: none;">
                            <h3 class="card-title">${h(v.title)}</h3>
                        </a>
                        <div class="card-stats">${formatNumber(v.views)} views</div>
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
    };

    return render(`Daftar Video - Hal ${page}`, body, null, url, seoMeta);
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

function robots() {
    return new Response("User-agent: *\nAllow: /\nSitemap: https://" + new URL(arguments[0]?.url).hostname + "/sitemap.xml", { headers: { "content-type": "text/plain" } });
}

function render(t, b, schema, url, meta = {}) {
    const origin = url.origin;
    const canonical = meta.canonical || url.href;
    const description = meta.description || `Situs streaming video viral dan terbaru terlengkap. Nonton video HD gratis hanya di ${CONFIG.name}.`;
    const image = meta.image || CONFIG.logo;
    const siteTitle = `${t} - ${CONFIG.name}`;

    const isDark = true; // Default dark theme

    const style = `
        :root {
            --background: 240 10% 3.9%;
            --foreground: 0 0% 98%;
            --card: 240 10% 6%;
            --primary: 24 100% 50%;
            --primary-foreground: 240 5.9% 10%;
            --secondary: 240 3.7% 15.9%;
            --secondary-foreground: 0 0% 98%;
            --muted: 240 3.7% 15.9%;
            --muted-foreground: 240 5% 64.9%;
            --border: 240 3.7% 15.9%;
            --radius: 0.5rem;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
            background-color: hsl(var(--background));
            color: hsl(var(--foreground));
            line-height: 1.4;
            font-size: 0.9375rem;
        }

        body.mobile-menu-open {
            overflow: hidden;
            position: fixed;
            width: 100%;
            height: 100%;
        }

        .container {
            max-width: 1000px;
            margin: 0 auto;
            padding: 0 0.75rem;
        }

        header {
            position: sticky;
            top: 0;
            z-index: 100;
            background-color: hsla(240, 10%, 3.9%, 0.9);
            backdrop-filter: blur(8px);
            border-bottom: 1px solid hsl(var(--border));
        }

        .header-content {
            height: 50px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .logo {
            display: flex;
            align-items: center;
            gap: 0.35rem;
            text-decoration: none;
            color: hsl(var(--foreground));
            font-weight: 700;
            font-size: 1.1rem;
        }

        .logo svg {
            color: hsl(var(--primary));
            height: 22px;
            width: 22px;
        }

        .logo img {
            height: 30px;
            width: auto;
        }

        .nav-links {
            display: none;
            gap: 1rem;
        }

        @media (min-width: 768px) {
            .nav-links {
                display: flex;
            }
        }

        .nav-links a {
            text-decoration: none;
            color: hsl(var(--muted-foreground));
            font-size: 0.8125rem;
            font-weight: 500;
            transition: color 0.2s;
        }

        .nav-links a:hover {
            color: hsl(var(--primary));
        }

        .actions {
            display: flex;
            align-items: center;
            gap: 0.25rem;
        }

        button.icon-btn {
            background: none;
            border: none;
            padding: 0.4rem;
            border-radius: calc(var(--radius) - 2px);
            color: hsl(var(--foreground));
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }

        button.icon-btn:hover {
            background-color: hsl(var(--secondary));
        }

        button.icon-btn svg {
            width: 18px;
            height: 18px;
        }

        .mobile-menu-btn {
            display: flex !important;
        }

        @media (min-width: 768px) {
            .mobile-menu-btn {
                display: none !important;
            }
        }

        .mobile-menu {
            position: fixed;
            top: 0;
            left: -300px;
            width: 280px;
            height: 100vh;
            background-color: hsl(var(--card));
            border-right: 1px solid hsl(var(--border));
            z-index: 1000;
            transition: left 0.3s ease-in-out;
            display: flex;
            flex-direction: column;
            padding: 1rem;
            box-shadow: 2px 0 10px rgba(0, 0, 0, 0.3);
        }

        .mobile-menu.active {
            left: 0;
        }

        .mobile-menu-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid hsl(var(--border));
        }

        .mobile-menu-title {
            font-weight: 700;
            font-size: 1rem;
            color: hsl(var(--foreground));
            display: flex;
            align-items: center;
        }

        .mobile-menu-links {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            flex: 1;
        }

        .mobile-menu-links a {
            text-decoration: none;
            color: hsl(var(--foreground));
            font-size: 0.9375rem;
            padding: 0.75rem;
            border-radius: var(--radius);
            transition: background-color 0.2s, color 0.2s;
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .mobile-menu-links a:hover {
            background-color: hsl(var(--primary));
            color: white;
        }

        .mobile-menu-links a svg {
            width: 18px;
            height: 18px;
        }

        .mobile-menu-footer {
            margin-top: auto;
            padding-top: 1rem;
            border-top: 1px solid hsl(var(--border));
            font-size: 0.75rem;
            color: hsl(var(--muted-foreground));
            text-align: center;
        }

        .menu-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 999;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s, visibility 0.3s;
            backdrop-filter: blur(2px);
        }

        .menu-overlay.active {
            opacity: 1;
            visibility: visible;
        }

        main {
            padding: 0.75rem 0;
            transition: filter 0.3s;
        }

        main.menu-open {
            filter: blur(2px);
        }

        .breadcrumbs {
            padding: 0.5rem 0;
            font-size: 0.75rem;
            color: hsl(var(--muted-foreground));
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .breadcrumbs a {
            color: inherit;
            text-decoration: none;
        }

        .player-section {
            background-color: hsl(var(--card));
            border-radius: var(--radius);
            border: 1px solid hsl(var(--border));
            overflow: hidden;
            margin-bottom: 1.25rem;
        }

        .video-wrapper {
            position: relative;
            aspect-ratio: 16/9;
            background-color: #000;
        }

        .video-placeholder {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }

        .play-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.3);
            cursor: pointer;
            border: 0;
            width: 100%;
            text-align: center;
        }

        .play-overlay:focus {
            outline: 2px solid hsl(var(--primary));
        }

        .play-btn-large {
            width: 60px;
            height: 60px;
            background: hsl(var(--primary));
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            pointer-events: none;
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
        }

        .play-overlay:hover .play-btn-large {
            transform: scale(1.1);
        }

        .play-btn-large svg {
            width: 28px;
            height: 28px;
            margin-left: 3px;
            fill: white;
            color: white;
        }

        .video-info {
            padding: 0.75rem 1rem;
        }

        .video-title {
            font-size: 1.125rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            line-height: 1.3;
        }

        .video-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            margin-bottom: 0.5rem;
        }

        .badge {
            background-color: hsl(var(--secondary));
            color: hsl(var(--secondary-foreground));
            padding: 0.15rem 0.5rem;
            border-radius: 4px;
            font-size: 0.6875rem;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
        }

        .badge svg {
            width: 12px;
            height: 12px;
        }

        .video-description {
            margin: 0.75rem 0 0.5rem 0;
            padding: 0.75rem;
            background-color: hsl(var(--secondary));
            border-radius: var(--radius);
            border-left: 4px solid hsl(var(--primary));
            font-size: 0.8125rem;
            line-height: 1.5;
            color: hsl(var(--secondary-foreground));
        }

        .video-description p {
            margin-bottom: 0.25rem;
        }

        .video-description strong {
            color: hsl(var(--primary));
        }

        .btn-group {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            margin-top: 0.75rem;
        }

        .btn {
            padding: 0.4rem 0.8rem;
            border-radius: var(--radius);
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            border: 1px solid transparent;
            font-size: 0.75rem;
            text-decoration: none;
            transition: opacity 0.2s;
        }

        .btn:hover {
            opacity: 0.9;
        }

        .btn svg {
            width: 14px;
            height: 14px;
        }

        .btn-primary {
            background-color: hsl(var(--primary));
            color: hsl(var(--primary-foreground));
        }

        .btn-outline {
            background: transparent;
            border-color: hsl(var(--border));
            color: hsl(var(--foreground));
        }

        .section-title {
            font-size: 0.9375rem;
            font-weight: 700;
            margin-bottom: 0.75rem;
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }

        .section-title svg {
            width: 16px;
            height: 16px;
            color: hsl(var(--primary));
        }

        .video-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 0.75rem;
        }

        .video-card {
            background-color: hsl(var(--card));
            border-radius: var(--radius);
            border: 1px solid hsl(var(--border));
            overflow: hidden;
            transition: border-color 0.2s, transform 0.2s;
            text-decoration: none;
            color: inherit;
            display: block;
        }

        .video-card:hover {
            border-color: hsl(var(--primary));
            transform: translateY(-2px);
        }

        .video-card-link {
            text-decoration: none;
            color: inherit;
            display: block;
        }

        .card-thumb {
            position: relative;
            aspect-ratio: 16/9;
            background-color: hsl(var(--muted));
        }

        .card-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .card-duration {
            position: absolute;
            bottom: 4px;
            right: 4px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            font-size: 0.625rem;
            padding: 1px 4px;
            border-radius: 2px;
        }

        .card-hover-overlay {
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, 0.3);
            opacity: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.2s;
            color: white;
        }

        .video-card:hover .card-hover-overlay {
            opacity: 1;
        }

        .card-hover-overlay svg {
            width: 2.5rem;
            height: 2.5rem;
        }

        .card-content {
            padding: 0.5rem;
        }

        .card-title {
            font-size: 0.8125rem;
            font-weight: 600;
            margin-bottom: 0.15rem;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            line-height: 1.3;
            color: hsl(var(--foreground));
            text-decoration: none;
        }

        .card-stats {
            font-size: 0.6875rem;
            color: hsl(var(--muted-foreground));
        }

        .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 1rem;
            margin-top: 2rem;
        }

        .pagination-link {
            padding: 0.5rem 1rem;
            background-color: hsl(var(--secondary));
            color: hsl(var(--foreground));
            text-decoration: none;
            border-radius: var(--radius);
            font-size: 0.875rem;
            transition: background-color 0.2s;
        }

        .pagination-link:hover {
            background-color: hsl(var(--primary));
            color: white;
        }

        .pagination-current {
            color: hsl(var(--muted-foreground));
            font-size: 0.875rem;
        }

        .pagination-next {
            background-color: hsl(var(--primary));
            color: white;
        }

        footer {
            margin-top: 2rem;
            padding: 1rem 0;
            border-top: 1px solid hsl(var(--border));
            text-align: center;
            color: hsl(var(--muted-foreground));
            font-size: 0.75rem;
        }

        .modal {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            z-index: 2000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 1rem;
        }

        .modal.active {
            display: flex;
        }

        .modal-content {
            background-color: hsl(var(--background));
            width: 100%;
            max-width: 400px;
            border-radius: var(--radius);
            padding: 1rem;
            border: 1px solid hsl(var(--border));
            position: relative;
        }

        .close-modal {
            position: absolute;
            top: 0.5rem;
            right: 0.5rem;
            background: none;
            border: none;
            cursor: pointer;
            color: hsl(var(--muted-foreground));
        }

        .search-form {
            display: flex;
            gap: 0.5rem;
            margin-top: 0.75rem;
        }

        .search-input {
            flex: 1;
            padding: 0.5rem;
            border-radius: var(--radius);
            border: 1px solid hsl(var(--border));
            background: hsl(var(--secondary));
            color: inherit;
            font-size: 0.875rem;
        }

        .search-input:focus {
            outline: 2px solid hsl(var(--primary));
        }

        @media (max-width: 480px) {
            .video-grid {
                grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            }
            
            .video-description {
                font-size: 0.75rem;
            }
            
            .badge {
                font-size: 0.625rem;
            }
        }
    `;

    const script = `
        function initIcons() { 
            if (typeof lucide !== 'undefined') {
                lucide.createIcons(); 
            }
        }

        function copyVideoUrl() {
            const url = window.location.href;
            navigator.clipboard.writeText(url).then(() => {
                alert('URL video berhasil disalin!');
            }).catch(() => {
                alert('Gagal menyalin URL');
            });
        }

        function shareVideo() {
            if (navigator.share) {
                navigator.share({
                    title: document.title,
                    text: document.querySelector('meta[name="description"]')?.content || 'Nonton video viral di VideoStream',
                    url: window.location.href
                }).catch(() => {});
            } else {
                copyVideoUrl();
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            // Elements
            const themeToggle = document.getElementById('themeToggle');
            const themeIcon = document.getElementById('themeIcon');
            const searchBtn = document.getElementById('searchBtn');
            const searchModal = document.getElementById('searchModal');
            const closeSearch = document.getElementById('closeSearch');
            const playTrigger = document.getElementById('playTrigger');
            const playerFrameContainer = document.getElementById('playerFrameContainer');
            const mainThumbnail = document.getElementById('mainThumbnail');
            const mainContent = document.getElementById('mainContent');

            // Mobile Menu Elements
            const mobileMenuBtn = document.getElementById('mobileMenuBtn');
            const mobileMenu = document.getElementById('mobileMenu');
            const menuOverlay = document.getElementById('menuOverlay');
            const closeMobileMenu = document.getElementById('closeMobileMenu');

            // Fungsi toggle mobile menu
            function openMobileMenu() {
                if (mobileMenu) mobileMenu.classList.add('active');
                if (menuOverlay) menuOverlay.classList.add('active');
                document.body.classList.add('mobile-menu-open');
                if (mainContent) mainContent.classList.add('menu-open');
            }

            function closeMobileMenuFunc() {
                if (mobileMenu) mobileMenu.classList.remove('active');
                if (menuOverlay) menuOverlay.classList.remove('active');
                document.body.classList.remove('mobile-menu-open');
                if (mainContent) mainContent.classList.remove('menu-open');
            }

            // Event listeners untuk mobile menu
            if (mobileMenuBtn) {
                mobileMenuBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openMobileMenu();
                });
            }
            
            if (closeMobileMenu) {
                closeMobileMenu.addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeMobileMenuFunc();
                });
            }
            
            if (menuOverlay) {
                menuOverlay.addEventListener('click', () => {
                    closeMobileMenuFunc();
                });
            }

            // Tutup menu jika resize ke desktop
            window.addEventListener('resize', () => {
                if (window.innerWidth >= 768) {
                    closeMobileMenuFunc();
                }
            });

            // Theme Logic
            if (themeToggle) {
                themeToggle.addEventListener('click', () => {
                    document.documentElement.classList.toggle('dark');
                    const isDark = document.documentElement.classList.contains('dark');
                    
                    if (themeIcon) {
                        themeIcon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
                    }
                    
                    initIcons();
                    localStorage.setItem('theme', isDark ? 'dark' : 'light');
                });
            }

            // Search Modal Logic
            if (searchBtn) {
                searchBtn.addEventListener('click', () => {
                    if (searchModal) searchModal.classList.add('active');
                });
            }
            
            if (closeSearch) {
                closeSearch.addEventListener('click', () => {
                    if (searchModal) searchModal.classList.remove('active');
                });
            }
            
            if (searchModal) {
                searchModal.addEventListener('click', (e) => { 
                    if (e.target === searchModal) searchModal.classList.remove('active'); 
                });
            }

            // Play Video Logic
            if (playTrigger && playerFrameContainer && mainThumbnail) {
                playTrigger.addEventListener('click', () => {
                    const videoUrl = playTrigger.getAttribute('data-video-url') || 'https://dodl.pages.dev/ogvc3le77dvv';
                    playTrigger.style.display = 'none';
                    mainThumbnail.style.display = 'none';
                    playerFrameContainer.style.display = 'block';
                    playerFrameContainer.innerHTML = \`<iframe src="\${videoUrl}" frameborder="0" allow="autoplay; fullscreen" style="width:100%; height:100%;" title="Video Player - \${document.title}"></iframe>\`;
                });
            }

            // Load Theme
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme === 'light') {
                document.documentElement.classList.remove('dark');
                if (themeIcon) {
                    themeIcon.setAttribute('data-lucide', 'moon');
                }
                initIcons();
            } else if (!savedTheme) {
                document.documentElement.classList.add('dark');
                if (themeIcon) {
                    themeIcon.setAttribute('data-lucide', 'sun');
                }
            }
        });
    `;

    return new Response(
        `<!doctype html><html lang="id" class="dark"><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${siteTitle}</title>
    <meta name="description" content="${description}">
    <meta name="keywords" content="video viral, lucu, ngakak, 2024, kompilasi, prank, kucing, challenge">
    <meta name="robots" content="${meta.robots || "index, follow"}">
    <link rel="canonical" href="${canonical}">
    <link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/images/favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/images/apple-touch-icon.png">
    <link rel="shortcut icon" href="/images/favicon.ico">
    
    <!-- Open Graph -->
    <meta property="og:site_name" content="${CONFIG.name}">
    <meta property="og:title" content="${siteTitle}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${image}">
    <meta property="og:type" content="${meta.type || "website"}">
    
    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${siteTitle}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${image}">

    ${schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ""}
    
    <script src="https://unpkg.com/lucide@latest"></script>
    
    <style>${style}</style>
    </head><body>
    
    <!-- Overlay untuk Mobile Menu -->
    <div class="menu-overlay" id="menuOverlay"></div>

    <!-- Mobile Sidebar Menu -->
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
        
        <nav class="mobile-menu-links">
            <a href="/">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                Beranda
            </a>
            <a href="/">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8 10 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                Populer
            </a>
            <a href="/">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                Kategori
            </a>
            <a href="/">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Terbaru
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

            <!-- Desktop Nav -->
            <nav class="nav-links">
                <a href="/">Beranda</a>
                <a href="/">Populer</a>
                <a href="/">Kategori</a>
                <a href="/">Terbaru</a>
            </nav>

            <div class="actions">
                <button class="icon-btn" id="searchBtn" aria-label="Cari video">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
                <button class="icon-btn" id="themeToggle" aria-label="Ganti Tema">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="themeIcon"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                </button>
                <button class="icon-btn mobile-menu-btn" id="mobileMenuBtn" aria-label="Menu">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
            </div>
        </div>
    </header>

    <main class="container" id="mainContent">${b}</main>

    <!-- Search Modal -->
    <div class="modal" id="searchModal" role="dialog" aria-modal="true">
        <div class="modal-content">
            <button class="close-modal" id="closeSearch" aria-label="Tutup">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <h3 style="font-weight: 700; font-size: 0.9375rem;">Cari Video</h3>
            <form class="search-form" action="/f/" method="get" onsubmit="event.preventDefault(); var v=this.q.value.trim().replace(/\\s+/g,'-'); if(v) window.location.href='/f/'+encodeURIComponent(v)">
                <input type="search" name="q" class="search-input" placeholder="Ketik kata kunci..." autofocus>
                <button type="submit" class="btn btn-primary">Cari</button>
            </form>
        </div>
    </div>

    <footer>
        <div class="container">&copy; 2024 ${CONFIG.name}. All rights reserved. - Platform Video Viral No.1 di Indonesia</div>
    </footer>

    <script>${script}</script>
    </body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
    );
}

function notFound(url, meta = {}) {
    const res = render("Halaman Tidak Ditemukan", '<div class="player-section" style="padding:2rem; text-align:center"><h1>404 - Halaman Tidak Ditemukan</h1><p>Maaf, halaman yang Anda cari tidak ada.</p><a href="/" class="btn btn-primary" style="margin-top:1rem; display:inline-block">Kembali ke Beranda</a></div>', null, url, meta);
    return new Response(res.body, { ...res, status: 404 });
}