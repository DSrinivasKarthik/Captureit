#!/usr/bin/env node
import express from 'express';
import fetch from 'node-fetch';
const app = express();
const PORT = process.env.PORT || 4000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuietCapture/1.0)' }, timeout: 5000 });
    if (!r.ok) return res.status(502).json({ error: 'bad upstream' });
    const html = await r.text();
    // simple regex extraction (sufficient for common pages)
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    const twitterTitleMatch = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

    // Gather possible image candidates
    const candidates = new Set();
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    const twitterImageMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) || html.match(/<meta[^>]*property=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    const linkImageMatch = html.match(/<link[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/i);
    if (ogImageMatch && ogImageMatch[1]) candidates.add(ogImageMatch[1]);
    if (twitterImageMatch && twitterImageMatch[1]) candidates.add(twitterImageMatch[1]);
    if (linkImageMatch && linkImageMatch[1]) candidates.add(linkImageMatch[1]);

    // collect <img src> occurrences (first few)
    const imgMatches = Array.from(html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/ig)).map(m=>m[1]).slice(0, 12);
    imgMatches.forEach(s => {
      if (s && !/^(data:|javascript:)/i.test(s)) candidates.add(s);
    });

    // helper to validate an image candidate (HEAD and content-type)
    const validateImage = async (src) => {
      try {
        const abs = new URL(src, url).href;
        const rimg = await fetch(abs, { method: 'HEAD', timeout: 3000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuietCapture/1.0)' } });
        if (!rimg.ok) return null;
        const ct = rimg.headers.get('content-type') || '';
        if (!/image\//i.test(ct)) return null;
        return abs;
      } catch (e) {
        return null;
      }
    };

    // try to pick a suitable image (validate candidate list in order of preference)
    let chosenImage = null;
    const ranking = [ ...(ogImageMatch && ogImageMatch[1] ? [ogImageMatch[1]] : []), ...(twitterImageMatch && twitterImageMatch[1] ? [twitterImageMatch[1]] : []), ...(linkImageMatch && linkImageMatch[1] ? [linkImageMatch[1]] : []), ...imgMatches ];
    for (const c of ranking) {
      if (!c) continue;
      // skip obvious logos and icons
      if (/logo|icon|sprite|ads?|badge|googlesyndication/i.test(c)) continue;
      const ok = await validateImage(c);
      if (ok) { chosenImage = ok; break; }
    }

    const json = {
      title: (ogTitleMatch && ogTitleMatch[1]) || (twitterTitleMatch && twitterTitleMatch[1]) || (titleMatch && titleMatch[1]) || null,
      image: chosenImage || null,
      site: (new URL(url)).hostname.replace(/^www\./,'')
    };

    res.json(json);
  } catch (e) {
    res.status(500).json({ error: 'fetch failed' });
  }
});

app.listen(PORT, () => console.log(`Metadata proxy listening on http://localhost:${PORT}`));
