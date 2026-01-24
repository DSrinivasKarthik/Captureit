#!/usr/bin/env node
/* global process */
import express from 'express';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import probe from 'probe-image-size';

const app = express();
const PORT = process.env.PORT || 4000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ============================================================================
// URL & IMAGE FILTERS
// ============================================================================

const tryAbsoluteUrl = (src, baseUrl) => {
  if (!src) return null;
  try {
    return new URL(src.trim(), baseUrl).href;
  } catch {
    return null;
  }
};

// Junk image patterns - tracking pixels, spacers, ads
const isJunkUrl = (url) => {
  if (!url) return true;
  const s = url.toLowerCase();
  if (s.startsWith('data:') || s.startsWith('javascript:')) return true;
  if (s.endsWith('.svg') || s.endsWith('.gif')) return true;
  if (/(favicon|sprite|spacer|blank|pixel|tracking|1x1|transparent)/i.test(s)) return true;
  if (/(ads?[\-_]|doubleclick|googlesyndication|adservice|analytics|beacon)/i.test(s)) return true;
  return false;
};

// ULTRA AGGRESSIVE logo detection - reject anything suspicious
const isLikelyLogo = (url) => {
  if (!url) return true;
  const s = url.toLowerCase();
  
  // Common logo patterns in URL path/filename
  const logoPatterns = [
    /[\/\-_](logo|brand|icon|badge|avatar|favicon|site[-_]?icon|masthead)/i,
    /[\/\-_](header[-_]?img|nav[-_]?img|site[-_]?img)/i,
    /\/logos?\//i,
    /\/icons?\//i,
    /\/brand(ing)?\//i,
    /\/assets\/.*logo/i,
    /logo[-_]?\d*\.(png|jpe?g|webp)/i,
    /brand[-_]?\d*\.(png|jpe?g|webp)/i,
    // Common CDN patterns for site logos
    /static.*logo/i,
    /cdn.*logo/i,
    /core\/.*logo/i,
    /espn.*logo/i,
    /espncdn.*logo/i,
    /combiner.*logo/i,
    // Generic "site" images (usually logos)
    /[\/\-_]site[\/\-_]/i,
    // Single letter images (often logos like "E" for ESPN)
    /\/[a-z]\.(?:png|jpe?g|webp)/i,
    /\/[a-z][-_]\d+\.(?:png|jpe?g|webp)/i,
  ];
  
  return logoPatterns.some(p => p.test(s));
};

const bestFromSrcset = (srcset, baseUrl) => {
  if (!srcset) return null;
  const parts = String(srcset).split(',').map(p => p.trim()).filter(Boolean);
  
  let best = null;
  let bestW = 0;
  
  for (const part of parts) {
    const match = part.match(/^(\S+)\s+(\d+)w$/);
    if (match) {
      const url = tryAbsoluteUrl(match[1], baseUrl);
      const w = parseInt(match[2], 10);
      if (url && w > bestW) {
        bestW = w;
        best = url;
      }
    }
  }
  
  if (best) return best;
  const first = parts[0]?.split(/\s+/)[0];
  return tryAbsoluteUrl(first, baseUrl);
};

// ============================================================================
// IMAGE PROBING
// ============================================================================

const probeImage = async (imageUrl) => {
  if (!imageUrl || isJunkUrl(imageUrl)) return null;
  
  let res;
  try {
    res = await fetch(imageUrl, {
      method: 'GET',
      timeout: 5000,
      headers: {
        'User-Agent': UA,
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Range': 'bytes=0-65535'
      }
    });

    if (!res.ok) return null;
    
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/') || contentType.includes('svg')) return null;

    const info = await probe(res.body);
    if (!info?.width || !info?.height) return null;
    
    return {
      url: imageUrl,
      width: info.width,
      height: info.height,
      area: info.width * info.height,
      aspect: info.width / info.height
    };
  } catch {
    return null;
  } finally {
    try { res?.body?.destroy?.(); } catch { /* ignore */ }
  }
};

const probeMultiple = async (urls, limit = 6) => {
  const results = [];
  const queue = [...urls];
  
  const worker = async () => {
    while (queue.length > 0) {
      const url = queue.shift();
      const result = await probeImage(url);
      if (result) results.push(result);
    }
  };
  
  await Promise.all(Array(Math.min(limit, urls.length)).fill(0).map(() => worker()));
  return results;
};

// ============================================================================
// IMAGE QUALITY CHECKS
// ============================================================================

// Strict check for "good preview" quality
const isGoodPreviewImage = (img) => {
  if (!img) return false;
  
  // Must be reasonably large
  if (img.width < 400 || img.height < 200) return false;
  if (img.area < 120000) return false;
  
  // STRICT: Reject near-square (logos are almost always 1:1 or close)
  // Good preview images are typically 1.5:1 to 2:1
  if (img.aspect >= 0.8 && img.aspect <= 1.25) return false;
  
  // Reject extreme aspect ratios
  if (img.aspect > 4 || img.aspect < 0.4) return false;
  
  // Reject if URL looks like a logo
  if (isLikelyLogo(img.url)) return false;
  
  return true;
};

// Relaxed check for fallback
const isAcceptableImage = (img) => {
  if (!img) return false;
  if (img.width < 300 || img.height < 150) return false;
  if (isLikelyLogo(img.url)) return false;
  // Allow slightly square but not perfect square
  if (img.aspect >= 0.95 && img.aspect <= 1.05) return false;
  return true;
};

const scoreImage = (img, isFromContent = false) => {
  let score = 0;
  
  // Size with diminishing returns
  score += Math.min(Math.log10(img.area) * 10, 60);
  
  // Ideal preview aspect ratio ~1.91:1
  if (img.aspect >= 1.4 && img.aspect <= 2.2) {
    score += 30;
  } else if (img.aspect >= 1.2 && img.aspect <= 2.8) {
    score += 15;
  } else if (img.aspect >= 0.7 && img.aspect <= 1.3) {
    score -= 20; // Penalize square-ish
  }
  
  // Prefer larger images
  if (img.width >= 1200) score += 15;
  else if (img.width >= 800) score += 10;
  
  // BONUS for content images - this is the key change
  if (isFromContent) score += 25;
  
  // Penalty for logo-like URLs
  if (isLikelyLogo(img.url)) score -= 100;
  
  return score;
};

// ============================================================================
// TITLE EXTRACTION
// ============================================================================

const extractTitle = ($) => {
  const normalize = (t) => {
    if (!t) return null;
    const cleaned = String(t).replace(/\s+/g, ' ').trim();
    if (!cleaned || cleaned.length < 3) return null;
    if (/^(home|welcome|index|untitled|page|document)$/i.test(cleaned)) return null;
    return cleaned;
  };
  
  const og = $('meta[property="og:title"]').attr('content');
  const twitter = $('meta[name="twitter:title"]').attr('content');
  const title = $('title').first().text();
  
  return normalize(og) || normalize(twitter) || normalize(title) || null;
};

// ============================================================================
// IMAGE COLLECTION
// ============================================================================

const collectMetaImages = ($, baseUrl) => {
  const urls = [];
  
  $('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"]').each((_, el) => {
    const url = tryAbsoluteUrl($(el).attr('content'), baseUrl);
    if (url && !isJunkUrl(url)) urls.push(url);
  });
  
  $('meta[name="twitter:image"], meta[property="twitter:image"], meta[name="twitter:image:src"]').each((_, el) => {
    const url = tryAbsoluteUrl($(el).attr('content'), baseUrl);
    if (url && !isJunkUrl(url)) urls.push(url);
  });
  
  return [...new Set(urls)];
};

const collectJsonLdImages = ($, baseUrl) => {
  const urls = [];
  
  const extract = (obj) => {
    if (!obj) return;
    if (typeof obj === 'string') {
      const url = tryAbsoluteUrl(obj, baseUrl);
      if (url && !isJunkUrl(url) && /\.(jpe?g|png|webp|avif)/i.test(url)) {
        urls.push(url);
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach(extract);
      return;
    }
    if (typeof obj === 'object') {
      ['image', 'thumbnailUrl', 'contentUrl', 'primaryImageOfPage', 'thumbnail'].forEach(key => {
        if (obj[key]) extract(obj[key]);
      });
    }
  };
  
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      extract(JSON.parse($(el).contents().text()));
    } catch { /* ignore */ }
  });
  
  return [...new Set(urls)];
};

// THE KEY FUNCTION: Collect images from actual page content
const collectContentImages = ($, baseUrl) => {
  const urls = [];
  const seen = new Set();
  
  const addUrl = (url) => {
    if (!url || isJunkUrl(url) || isLikelyLogo(url) || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  
  const processImg = ($img) => {
    // Skip decorative images
    const alt = ($img.attr('alt') || '').toLowerCase();
    const cls = ($img.attr('class') || '').toLowerCase();
    const id = ($img.attr('id') || '').toLowerCase();
    const combined = alt + ' ' + cls + ' ' + id;
    
    if (/(logo|brand|icon|avatar|badge|sprite|nav|header|footer)/i.test(combined)) return;
    
    // Skip if inside header/nav/footer/sidebar
    if ($img.closest('header, nav, footer, aside, [role="banner"], [role="navigation"], [role="contentinfo"], .sidebar, #sidebar').length > 0) {
      return;
    }
    
    // Try srcset first
    const srcset = $img.attr('srcset') || $img.attr('data-srcset');
    const bestSrc = bestFromSrcset(srcset, baseUrl);
    if (bestSrc) {
      addUrl(bestSrc);
      return;
    }
    
    // Fallback to various src attributes
    const src = $img.attr('src') || 
                $img.attr('data-src') || 
                $img.attr('data-lazy-src') || 
                $img.attr('data-original') ||
                $img.attr('data-hi-res-src');
    addUrl(tryAbsoluteUrl(src, baseUrl));
  };
  
  // PRIORITY ORDER - content areas first (these contain the real images)
  // 1. Main article content
  $('article img, [role="article"] img').slice(0, 25).each((_, el) => processImg($(el)));
  $('main img, [role="main"] img').slice(0, 25).each((_, el) => processImg($(el)));
  
  // 2. Common content containers
  $('.content img, #content img, .post img, .entry img, .story img').slice(0, 20).each((_, el) => processImg($(el)));
  $('figure img, .figure img').slice(0, 15).each((_, el) => processImg($(el)));
  
  // 3. Hero/featured images
  $('[class*="hero"] img, [class*="featured"] img, [class*="cover"] img').slice(0, 10).each((_, el) => processImg($(el)));
  
  // 4. General body images as last resort
  $('body img').slice(0, 40).each((_, el) => {
    const $el = $(el);
    // Extra strict filtering for general body images
    if ($el.closest('header, nav, footer, aside, .nav, .header, .footer, .sidebar').length === 0) {
      processImg($el);
    }
  });
  
  return urls;
};

// ============================================================================
// MAIN IMAGE SELECTION - CONTENT-FIRST APPROACH
// ============================================================================

const selectBestImage = async ($, baseUrl) => {
  // Collect from all sources
  const contentUrls = collectContentImages($, baseUrl);
  const metaUrls = collectMetaImages($, baseUrl);
  const jsonLdUrls = collectJsonLdImages($, baseUrl);
  
  console.log(`[DEBUG] Found: ${contentUrls.length} content, ${metaUrls.length} meta, ${jsonLdUrls.length} jsonLd images`);
  
  // STRATEGY: Try content images FIRST (they're almost always correct)
  // Only fall back to meta images if no good content images found
  
  // Step 1: Probe content images (highest priority)
  if (contentUrls.length > 0) {
    const contentImages = await probeMultiple(contentUrls.slice(0, 15), 6);
    const goodContent = contentImages.filter(isGoodPreviewImage);
    
    console.log(`[DEBUG] Good content images: ${goodContent.length}`);
    
    if (goodContent.length > 0) {
      goodContent.forEach(img => { img.score = scoreImage(img, true); });
      goodContent.sort((a, b) => b.score - a.score);
      console.log(`[DEBUG] Selected content image: ${goodContent[0].url}`);
      return goodContent[0].url;
    }
  }
  
  // Step 2: Try JSON-LD images (often article-specific)
  if (jsonLdUrls.length > 0) {
    const jsonLdImages = await probeMultiple(jsonLdUrls.slice(0, 6), 4);
    const goodJsonLd = jsonLdImages.filter(isGoodPreviewImage);
    
    if (goodJsonLd.length > 0) {
      goodJsonLd.forEach(img => { img.score = scoreImage(img, false); });
      goodJsonLd.sort((a, b) => b.score - a.score);
      console.log(`[DEBUG] Selected JSON-LD image: ${goodJsonLd[0].url}`);
      return goodJsonLd[0].url;
    }
  }
  
  // Step 3: Try og:image/twitter:image (but filter out logos strictly)
  if (metaUrls.length > 0) {
    const metaImages = await probeMultiple(metaUrls.slice(0, 4), 4);
    const goodMeta = metaImages.filter(isGoodPreviewImage);
    
    if (goodMeta.length > 0) {
      goodMeta.forEach(img => { img.score = scoreImage(img, false); });
      goodMeta.sort((a, b) => b.score - a.score);
      console.log(`[DEBUG] Selected meta image: ${goodMeta[0].url}`);
      return goodMeta[0].url;
    }
  }
  
  // Step 4: Fallback - try ANY acceptable image
  const allUrls = [...new Set([...contentUrls, ...jsonLdUrls, ...metaUrls])];
  if (allUrls.length > 0) {
    const allImages = await probeMultiple(allUrls.slice(0, 20), 6);
    const acceptable = allImages.filter(isAcceptableImage);
    
    if (acceptable.length > 0) {
      acceptable.forEach(img => { img.score = scoreImage(img, contentUrls.includes(img.url)); });
      acceptable.sort((a, b) => b.score - a.score);
      console.log(`[DEBUG] Selected fallback image: ${acceptable[0].url}`);
      return acceptable[0].url;
    }
  }
  
  console.log(`[DEBUG] No suitable image found`);
  return null;
};

// ============================================================================
// EXPRESS SERVER
// ============================================================================

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url required' });
  
  console.log(`\n[FETCH] ${url}`);
  
  try {
    let html = null;
    
    // Try direct fetch
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 8000
      });
      if (response.ok) {
        html = await response.text();
        console.log(`[DEBUG] Direct fetch successful`);
      }
    } catch { /* fall through */ }
    
    // Fallback proxy
    if (!html) {
      try {
        const proxyUrl = 'https://r.jina.ai/' + url;
        const response = await fetch(proxyUrl, {
          headers: { 'User-Agent': UA },
          timeout: 10000
        });
        if (response.ok) {
          html = await response.text();
          console.log(`[DEBUG] Proxy fetch successful`);
        }
      } catch { /* ignore */ }
    }
    
    if (!html) {
      return res.status(502).json({ error: 'Could not fetch page' });
    }
    
    const $ = load(html);
    const title = extractTitle($);
    const image = await selectBestImage($, url);
    
    const result = {
      title: title || null,
      image: image || null,
      site: new URL(url).hostname.replace(/^www\./, '')
    };
    
    console.log(`[RESULT] title: "${result.title}", image: ${result.image ? 'found' : 'null'}`);
    
    res.json(result);
    
  } catch (err) {
    console.error(`[ERROR]`, err.message);
    res.status(500).json({ error: 'fetch failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Metadata proxy listening on http://localhost:${PORT}`);
});
