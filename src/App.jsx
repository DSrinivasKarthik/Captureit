import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { Plus, ArrowLeft, Trash2, ExternalLink, X, Image as ImageIcon, Link as LinkIcon, CheckCircle2, Clipboard, LayoutGrid, List, Camera, Archive, RotateCcw, PenLine, FileDown, MoreVertical } from 'lucide-react';

// --- UTILS ---

const generateId = () => Math.random().toString(36).substr(2, 9);

const getDomain = (url) => {
  try {
    const domain = new URL(url).hostname;
    return domain.replace('www.', '');
  } catch (e) {
    return url ? 'link' : 'image';
  }
};

const getFavicon = (url) => {
  if (!url) return null;
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch (e) {
    return null;
  }
};

const generateGradient = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash % 360);
  return `linear-gradient(135deg, hsl(${h}, 70%, 90%) 0%, hsl(${(h + 40) % 360}, 70%, 95%) 100%)`;
};

// --- Metadata & Title inference helpers ---

const normalizeTitle = (raw, domain) => {
  if (!raw) return null;
  let title = String(raw).toLowerCase();

  // remove content after separators like "|" commonly used for site suffix
  title = title.replace(/\|.*$/,'');

  // Remove site tokens
  if (domain) {
    const site = domain.replace(/^www\./, '').replace(/\.(com|in|co|org|net)$/,'');
    try { title = title.replace(new RegExp(site, 'g'), ''); } catch(e) {}
  }

  // Remove common boilerplate words
  const boilerplate = ['price','images','mileage','specs','features','overview','review','reviews','news','blogs','blog','updated','latest','model','india','official','on-road','on road'];
  boilerplate.forEach(w => {
    title = title.replace(new RegExp('\\b' + w + '\\b','g'), '');
  });

  // Replace various separators with space
  title = title.replace(/[-|•:\/]/g, ' ');

  // Remove duplicate tokens (preserve order)
  const seen = new Set();
  title = title.split(/\s+/).filter(Boolean).filter(w => {
    if (seen.has(w)) return false; seen.add(w); return true;
  }).join(' ');

  // Clean spacing and trim
  title = title.replace(/\s+/g, ' ').trim();
  if (!title) return null;

  // Capitalize words
  title = title.replace(/\b\w/g, c => c.toUpperCase());

  // Length guard
  if (title.length < 3) return null;

  return title;
};

const inferTitleFromUrl = (url) => {
  try {
    const ignore = ['blogs','blog','news','reviews','colors','specs','gallery','images','price','posts','category','categories','tag','tags'];
    const parts = new URL(url).pathname.split('/').filter(Boolean).filter(p => !ignore.includes(p.toLowerCase()));

    if (parts.length >= 2) {
      const brand = parts[parts.length - 2];
      const model = parts[parts.length - 1];
      const combined = `${brand} ${model}`.replace(/[-_]/g, ' ');
      return normalizeTitle(combined, new URL(url).hostname);
    }

    if (parts.length === 1) {
      const candidate = parts[0].replace(/[-_]/g, ' ');
      return normalizeTitle(candidate, new URL(url).hostname);
    }

    return null;
  } catch (e) {
    return null;
  }
};

const getInitial = (title) => {
  if (!title) return '';
  const first = title.split(/\s+/).filter(Boolean)[0] || title;
  const ch = (first.replace(/[^a-zA-Z0-9]/g, '').charAt(0) || first.charAt(0) || title.charAt(0));
  return (ch || '').toUpperCase();
};

const tryFetchHtml = async (url) => {
  try {
    const res = await fetch(url, { headers: { 'Accept': 'text/html' } });
    if (!res.ok) throw new Error('Network error');
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) throw new Error('Not HTML');
    return await res.text();
  } catch (err) { throw err; }
};

const fetchPageMetadata = async (url) => {
  // Try direct fetch first
  try {
    const html = await tryFetchHtml(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.content;
    const metaTitle = doc.querySelector('title')?.textContent;
    const description = doc.querySelector('meta[name="description"]')?.content || doc.querySelector('meta[property="og:description"]')?.content;
    let ogImage = doc.querySelector('meta[property="og:image"]')?.content || doc.querySelector('meta[name="twitter:image"]')?.content || doc.querySelector('link[rel="image_src"]')?.href || null;

    // If ogImage is relative, resolve it
    if (ogImage) {
      try { ogImage = new URL(ogImage, url).href; } catch(e) {}
    }

    // If no OG image, try to pick a reasonable <img>
    if (!ogImage) {
      const imgs = Array.from(doc.querySelectorAll('img')).map(img => img.getAttribute('src') || img.getAttribute('data-src')).filter(Boolean);
      const candidate = imgs.find(src => /\.(png|jpe?g|webp|gif|avif)$/i.test(src)) || imgs[0] || null;
      if (candidate) {
        try { ogImage = new URL(candidate, url).href; } catch(e) { ogImage = candidate; }
      }
    }

    const rawTitle = ogTitle || metaTitle || description;
    const title = normalizeTitle(rawTitle, new URL(url).hostname) || null;
    return { title, image: ogImage || null };
  } catch (err) {
    // try proxy fallback (r.jina.ai as a lightweight fetch proxy)
    try {
      const proxy = 'https://r.jina.ai/http://';
      const html = await tryFetchHtml(proxy + url.replace(/^https?:\/\//, ''));
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const ogTitle = doc.querySelector('meta[property="og:title"]')?.content;
      const metaTitle = doc.querySelector('title')?.textContent;
      let ogImage = doc.querySelector('meta[property="og:image"]')?.content || doc.querySelector('meta[name="twitter:image"]')?.content || doc.querySelector('link[rel="image_src"]')?.href || null;
      if (ogImage) {
        try { ogImage = new URL(ogImage, url).href; } catch(e) {}
      }
      if (!ogImage) {
        const imgs = Array.from(doc.querySelectorAll('img')).map(img => img.getAttribute('src') || img.getAttribute('data-src')).filter(Boolean);
        const candidate = imgs.find(src => /\.(png|jpe?g|webp|gif|avif)$/i.test(src)) || imgs[0] || null;
        if (candidate) {
          try { ogImage = new URL(candidate, url).href; } catch(e) { ogImage = candidate; }
        }
      }
      const rawTitle = ogTitle || metaTitle;
      const title = normalizeTitle(rawTitle, new URL(url).hostname) || null;
      return { title, image: ogImage || null };
    } catch (err2) {
      // failed enrichment
      return null;
    }
  }
};

const enrichUrlMetadata = async (id, url) => {
  try {
    const cacheKey = 'meta_cache_v1';
    const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
    if (cache[url]) {
      const currentItem = data.items.find(i => i.id === id);
      const inferred = inferTitleFromUrl(url);
      const shouldSetTitle = !currentItem?.userEditedTitle && (
        !currentItem?.title || currentItem.title === 'Untitled link' || currentItem.title === inferred || (currentItem.title && currentItem.title.length < 3)
      );
      const shouldSetImage = !currentItem?.userEditedImage && !currentItem?.image && cache[url].image;
      const updateObj = { site: cache[url].site, metaStatus: 'done' };
      if (shouldSetTitle && cache[url].title) updateObj.title = cache[url].title;
      if (shouldSetImage) updateObj.image = cache[url].image;
      updateItem(id, updateObj);
      return;
    }

    const result = await fetchPageMetadata(url);
    if (result) {
      const site = new URL(url).hostname.replace('www.', '');
      const payload = { title: result.title, image: result.image, site };
      // Update cache
      cache[url] = payload;
      localStorage.setItem(cacheKey, JSON.stringify(cache));

      // Determine if it's safe to overwrite title
      const currentItem = data.items.find(i => i.id === id);
      const inferred = inferTitleFromUrl(url);
      const shouldSetTitle = !currentItem?.userEditedTitle && (
        !currentItem?.title || currentItem.title === 'Untitled link' || currentItem.title === inferred || (currentItem.title && currentItem.title.length < 3)
      );

      const shouldSetImage = !currentItem?.userEditedImage && !currentItem?.image && payload.image;
      const updateObj = { site: payload.site, metaStatus: 'done' };
      if (shouldSetTitle && payload.title) updateObj.title = payload.title;
      if (shouldSetImage) updateObj.image = payload.image;

      // Add a transient flash marker so UI can animate
      updateObj.enrichFlash = true;
      updateItem(id, updateObj);

      // Clear enrichFlash after short delay
      setTimeout(() => updateItem(id, { enrichFlash: false }), 1400);
    } else {
      // mark as failed so we can fallback gracefully
      updateItem(id, { metaStatus: 'failed' });
    }
  } catch (e) {
    updateItem(id, { metaStatus: 'failed' });
  }
};
// --- COMPONENTS ---

const Button = ({ children, onClick, variant = 'primary', className = '', ...props }) => {
  const baseStyle = "px-4 py-3 rounded-xl font-medium transition-all active:scale-95 flex items-center justify-center gap-2";
  const variants = {
    primary: "bg-stone-800 text-stone-50 hover:bg-stone-900 shadow-sm",
    secondary: "bg-stone-200 text-stone-800 hover:bg-stone-300",
    ghost: "text-stone-500 hover:bg-stone-100",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
    archive: "bg-amber-50 text-amber-700 hover:bg-amber-100",
  };
  return (
    <button onClick={onClick} className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

const Input = React.forwardRef(({ ...props }, ref) => (
  <input 
    ref={ref}
    className="w-full bg-stone-100 border-none rounded-xl px-4 py-3 text-stone-900 placeholder-stone-400 focus:ring-2 focus:ring-stone-400 focus:outline-none transition-all"
    {...props}
  />
));

// --- MAIN APP ---

export default function App() {
  // --- STATE ---
  const [data, setData] = useState(() => {
    const saved = localStorage.getItem('capture_app_db_v5');
    return saved ? JSON.parse(saved) : {
      buckets: [
        { id: 'b1', name: 'Inspiration', emoji: '💡', viewMode: 'calm', intent: '', createdAt: Date.now() },
        { id: 'b2', name: 'Read Later', emoji: '📚', viewMode: 'compact', intent: 'Things that make me smarter.', createdAt: Date.now() },
        { id: 'b3', name: 'Gear', emoji: '📷', viewMode: 'calm', intent: 'Buy only after 30 days of wanting.', createdAt: Date.now() },
      ],
      items: [],
      lastUsedBucketId: 'b1'
    };
  });

  const [view, setView] = useState('home'); 
  const [activeBucketId, setActiveBucketId] = useState(null);
  const [activeItemId, setActiveItemId] = useState(null);
  const [modalMode, setModalMode] = useState(null); 
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [showArchive, setShowArchive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingIntent, setEditingIntent] = useState(false);

  useEffect(() => {
    setEditingIntent(false);
  }, [activeBucketId, view]);

  useEffect(() => {
    localStorage.setItem('capture_app_db_v5', JSON.stringify(data));
  }, [data]);

  // --- ACTIONS ---

  const addBucket = (name, emoji) => {
    const newBucket = { id: generateId(), name, emoji, viewMode: 'calm', intent: '', createdAt: Date.now() };
    setData(prev => ({ ...prev, buckets: [...prev.buckets, newBucket] }));
    setModalMode(null);
  };

  const updateBucketIntent = (id, intent) => {
    setData(prev => ({
      ...prev,
      buckets: prev.buckets.map(b => b.id === id ? { ...b, intent } : b)
    }));
  };

  const toggleBucketDensity = (bucketId) => {
    setData(prev => ({
      ...prev,
      buckets: prev.buckets.map(b => 
        b.id === bucketId ? { ...b, viewMode: b.viewMode === 'calm' ? 'compact' : 'calm' } : b
      )
    }));
  };

  const addItem = (content, targetBucketId, type = 'url') => {
    const isUrl = type === 'url' || content.startsWith('http');
    const site = isUrl ? getDomain(content) : '';

    // Layer 2: try to infer title from url immediately for speed
    const inferredTitle = isUrl ? inferTitleFromUrl(content) : null;
    const normalizedInferred = isUrl ? normalizeTitle(inferredTitle || '', site) : null;
    const initialTitle = isUrl ? (normalizedInferred || 'Untitled link') : 'Pasted Image';

    const newItem = {
      id: generateId(),
      bucketId: targetBucketId,
      url: isUrl ? content : '',
      // Title: prefer normalized inferred title; never default to domain as identity
      title: initialTitle,
      domain: site,
      image: type === 'image' ? content : (content.match(/\.(jpeg|jpg|gif|png|webp)$/i) ? content : null),
      notes: '',
      price: '',
      status: 'saved',
      isArchived: false,
      visitCount: 0,
      metaStatus: isUrl ? 'pending' : 'done',
      site: site,
      createdAt: Date.now()
    };
    setData(prev => ({ 
      ...prev, 
      items: [newItem, ...prev.items],
      lastUsedBucketId: targetBucketId 
    }));

    // Start background enrichment when it's a URL
    if (isUrl) enrichUrlMetadata(newItem.id, content);
  };

  const updateItem = (id, updates) => {
    setData(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, ...updates } : item)
    }));
  };

  const archiveItem = (id) => {
    updateItem(id, { isArchived: true });
    setView('bucket');
  };

  const restoreItem = (id) => {
    updateItem(id, { isArchived: false });
  };

  const deleteItemPermanently = (id) => {
    setData(prev => ({ ...prev, items: prev.items.filter(i => i.id !== id) }));
  };

  const deleteBucket = (id) => {
    setData(prev => ({
      ...prev,
      buckets: prev.buckets.filter(b => b.id !== id),
      items: prev.items.filter(i => i.bucketId !== id)
    }));
    setView('home');
    setShowSettings(false);
  };

  const reorderItems = (draggedId, targetId) => {
    if (draggedId === targetId) return;
    setData(prev => {
      const items = [...prev.items];
      const draggedIndex = items.findIndex(i => i.id === draggedId);
      const targetIndex = items.findIndex(i => i.id === targetId);
      const [draggedItem] = items.splice(draggedIndex, 1);
      items.splice(targetIndex, 0, draggedItem);
      return { ...prev, items };
    });
  };

  const exportDecisionSnapshot = (bucketId) => {
    const bucket = data.buckets.find(b => b.id === bucketId);
    const items = data.items.filter(i => i.bucketId === bucketId && !i.isArchived);
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Snapshot: ${bucket.name}</title>
        <style>
          body { font-family: -apple-system, sans-serif; color: #1c1917; line-height: 1.6; padding: 40px; max-width: 800px; margin: 0 auto; background: #fafaf9; }
          .header { margin-bottom: 40px; border-bottom: 2px solid #e7e5e4; padding-bottom: 20px; }
          .emoji { font-size: 48px; }
          h1 { margin: 10px 0; font-size: 32px; font-weight: 900; }
          .intent { font-style: italic; color: #78716c; margin-bottom: 20px; }
          .item { background: white; border: 1px solid #e7e5e4; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
          .item-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
          .item-title { font-weight: bold; font-size: 18px; }
          .status { font-size: 10px; font-weight: 800; text-transform: uppercase; background: #1c1917; color: white; padding: 2px 8px; border-radius: 4px; }
          .domain { font-size: 12px; color: #a8a29e; }
          .notes { background: #f5f5f4; padding: 15px; border-radius: 8px; margin-top: 10px; font-size: 14px; white-space: pre-wrap; }
          .footer { margin-top: 60px; font-size: 12px; color: #a8a29e; text-align: center; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="emoji">${bucket.emoji}</div>
          <h1>${bucket.name}</h1>
          <p class="intent">${bucket.intent || 'No intent specified.'}</p>
          <p>Exported: ${new Date().toLocaleDateString()}</p>
        </div>
        ${items.map(i => `
          <div class="item">
            <div class="item-header">
              <div>
                <div class="item-title">${i.title}</div>
                <div class="domain">${i.domain}</div>
              </div>
              <div class="status">${i.status}</div>
            </div>
            ${i.notes ? `<div class="notes"><strong>Thought Log:</strong><br/>${i.notes}</div>` : ''}
          </div>
        `).join('')}
        <div class="footer">Captured with Intent.</div>
      </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Snapshot-${bucket.name.replace(/\s+/g, '-')}.html`;
    a.click();
    setShowSettings(false);
  };

  // --- SUB-COMPONENTS ---

  const QuickCapture = () => {
    const [selectedBucketId, setSelectedBucketId] = useState(activeBucketId || data.lastUsedBucketId || data.buckets[0]?.id);
    const [inputValue, setInputValue] = useState('');
    const [pastedImage, setPastedImage] = useState(null);
    const [isClipboardDetected, setIsClipboardDetected] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
      const checkClipboard = async () => {
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
              const blob = await item.getType(item.types.find(t => t.startsWith('image/')));
              const reader = new FileReader();
              reader.onload = (e) => setPastedImage(e.target.result);
              reader.readAsDataURL(blob);
              setIsClipboardDetected(true);
            } else if (item.types.includes('text/plain')) {
              const textBlob = await item.getType('text/plain');
              const text = await textBlob.text();
              if (text && (text.startsWith('http') || text.startsWith('www'))) {
                setInputValue(text);
                setIsClipboardDetected(true);
              }
            }
          }
        } catch (err) { console.log("Clipboard skip"); }
      };
      if (inputRef.current) inputRef.current.focus();
      checkClipboard();
    }, []);

    const handleSubmit = (e) => {
      e.preventDefault();
      if (!inputValue.trim() && !pastedImage) return;

      if (pastedImage) {
        addItem(pastedImage, selectedBucketId, 'image');
      } else {
        addItem(inputValue, selectedBucketId, 'url');
      }
      
      setInputValue('');
      setPastedImage(null);
      setIsClipboardDetected(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
      if (inputRef.current) inputRef.current.focus();
    };

    return (
      <div className="fixed inset-x-0 bottom-0 z-50 animate-in slide-in-from-bottom-10 duration-300">
        <div className="fixed inset-0 bg-stone-900/30 backdrop-blur-[2px]" onClick={() => setModalMode(null)} />
        <div className="relative bg-white border-t border-stone-100 shadow-[0_-15px_50px_rgba(0,0,0,0.15)] p-4 pb-10 rounded-t-[2.5rem]">
          <div className="flex justify-between items-center mb-4 px-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-stone-400">Capture Now</h2>
            <button onClick={() => setModalMode(null)} className="p-1.5 bg-stone-100 rounded-full text-stone-400"><X size={16} /></button>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              {pastedImage ? (
                <div className="relative group rounded-xl overflow-hidden bg-stone-100 border-2 border-dashed border-stone-200 p-2">
                  <img src={pastedImage} className="h-20 w-auto rounded-lg mx-auto shadow-sm" alt="Pasted" />
                  <button type="button" onClick={() => setPastedImage(null)} className="absolute top-1 right-1 bg-white p-1 rounded-full shadow-md text-stone-500"><X size={14} /></button>
                </div>
              ) : (
                <Input 
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Paste URL or text..." 
                />
              )}
              {isClipboardDetected && !pastedImage && !inputValue && (
                <div className="absolute right-3 top-3 flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
                  <Clipboard size={10} /> DETECTED
                </div>
              )}
            </div>
            
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {data.buckets.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedBucketId(b.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all border whitespace-nowrap ${
                    selectedBucketId === b.id ? 'bg-stone-800 text-white border-stone-800 shadow-md scale-105' : 'bg-white text-stone-500 border-stone-200'
                  }`}
                >
                  <span>{b.emoji}</span> <span className="font-medium">{b.name}</span>
                </button>
              ))}
            </div>

            <Button type="submit" className={`w-full ${justSaved ? 'bg-green-600' : 'bg-stone-900'}`} disabled={!inputValue && !pastedImage}>
              {justSaved ? <><CheckCircle2 size={18} /> Captured</> : "Capture"}
            </Button>
          </form>
        </div>
      </div>
    );
  };

  // --- VIEWS ---

  if (view === 'home') {
    return (
      <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col items-center">
        <div className="w-full max-w-md min-h-screen flex flex-col relative px-6">
          <header className="pt-16 pb-6">
            <h1 className="text-3xl font-black tracking-tight text-stone-800">Spaces</h1>
            <p className="text-stone-400 text-sm font-medium">Capture everything. Edit later.</p>
          </header>

          <div className="grid grid-cols-2 gap-4 pb-24">
            {data.buckets.map(bucket => (
              <button
                key={bucket.id}
                onClick={() => { setActiveBucketId(bucket.id); setView('bucket'); }}
                className="aspect-square bg-white rounded-3xl p-5 flex flex-col justify-between items-start shadow-sm border border-stone-100 active:scale-95 transition-all hover:shadow-md space-card"
              >
                <div className="flex justify-between w-full">
                  <span className="text-4xl">{bucket.emoji}</span>
                  <span className="bg-stone-100 text-stone-400 px-2 py-0.5 rounded-full text-[10px] font-bold space-count">
                    {data.items.filter(i => i.bucketId === bucket.id && !i.isArchived).length}
                  </span>
                </div>
                <span className="font-bold text-stone-700 text-lg leading-tight text-left space-title">{bucket.name}</span>
              </button>
            ))}
            <button onClick={() => setModalMode('bucket')} className="aspect-square rounded-3xl p-5 flex flex-col justify-center items-center border-2 border-dashed border-stone-200 text-stone-300 hover:bg-stone-100 transition-colors">
              <Plus size={32} />
              <span className="text-xs font-bold mt-2 uppercase tracking-widest">New Space</span>
            </button>
          </div>

          {!modalMode && (
            <div className="fixed bottom-10 left-0 right-0 flex justify-center z-10">
              <button onClick={() => setModalMode('item')} className="bg-stone-900 text-stone-50 rounded-full px-8 py-4 shadow-2xl flex items-center gap-2 active:scale-90 transition-all hover:bg-black ring-8 ring-stone-50 capture-button">
                <Plus size={24} /> <span className="font-bold text-lg">Capture</span>
              </button>
            </div>
          )}

          {modalMode === 'bucket' && (
            <div className="fixed inset-0 bg-stone-50/95 backdrop-blur-sm z-50 flex items-center justify-center p-6">
              <div className="w-full max-w-xs bg-white p-6 rounded-3xl shadow-xl border border-stone-100">
                <h2 className="text-lg font-bold mb-4">Create Space</h2>
                <form onSubmit={(e) => { e.preventDefault(); addBucket(new FormData(e.target).get('name'), new FormData(e.target).get('emoji')); }}>
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <Input name="emoji" placeholder="🚀" className="w-16 text-center text-xl" maxLength={2} required />
                      <Input name="name" placeholder="Name" autoFocus required />
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="ghost" onClick={() => setModalMode(null)} className="flex-1">Cancel</Button>
                      <Button type="submit" className="flex-1">Create</Button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}
          {modalMode === 'item' && <QuickCapture />}
        </div>
      </div>
    );
  }

  if (view === 'bucket') {
    const bucket = data.buckets.find(b => b.id === activeBucketId);
    const activeItems = data.items.filter(i => i.bucketId === activeBucketId && !i.isArchived);
    const archivedItems = data.items.filter(i => i.bucketId === activeBucketId && i.isArchived);
    const isCompact = bucket?.viewMode === 'compact';

    if (!bucket) return setView('home');

    return (
      <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col items-center">
        <div className="w-full max-w-md min-h-screen flex flex-col relative px-4">
          <header className="pt-10 pb-4 flex items-center justify-between sticky top-0 bg-stone-50/90 backdrop-blur-md z-20">
            <button onClick={() => setView('home')} className="p-2 -ml-2 rounded-full hover:bg-stone-200"><ArrowLeft size={24} /></button>
            <h1 className="text-lg font-bold flex items-center gap-2"><span>{bucket.emoji}</span> {bucket.name}</h1>
            <div className="flex items-center gap-1 relative">
              <button onClick={() => toggleBucketDensity(bucket.id)} className="p-2 rounded-full hover:bg-stone-200 text-stone-400">
                {isCompact ? <LayoutGrid size={20} /> : <List size={20} />}
              </button>
              <button onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-full hover:bg-stone-200 text-stone-400">
                <MoreVertical size={20} />
              </button>

              {showSettings && (
                <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-stone-100 p-2 z-30 animate-in fade-in zoom-in-95 duration-100">
                  <button 
                    onClick={() => exportDecisionSnapshot(bucket.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-stone-600 hover:bg-stone-50 transition-colors"
                  >
                    <FileDown size={18} /> Decision Snapshot (HTML)
                  </button>
                  <div className="h-px bg-stone-100 my-1" />
                  <button 
                    onClick={() => deleteBucket(bucket.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={18} /> Delete Space
                  </button>
                </div>
              )}
            </div>
          </header>

          {showSettings && <div className="fixed inset-0 z-20" onClick={() => setShowSettings(false)} />}

          {/* Intent Header */}
          <div className="mb-8 px-2">
            <div
              onClick={() => setEditingIntent(true)}
              className="group cursor-text intent-group"
            >
              {!editingIntent ? (
                <p
                  className={`text-sm leading-relaxed transition-colors ${
                    bucket.intent
                      ? "text-slate-600"
                      : "text-slate-400"
                  }`}
                >
                  {bucket.intent || "Why does this space exist?"}
                  <PenLine size={12} className="ml-2 inline pen-icon" />
                </p>
              ) : (
                <textarea
                  autoFocus
                  value={bucket.intent}
                  onChange={(e) => updateBucketIntent(bucket.id, e.target.value)}
                  onBlur={() => setEditingIntent(false)}
                  rows={2}
                  className="w-full bg-transparent border-none p-0 text-sm leading-relaxed text-slate-700 resize-none focus:ring-0"
                  placeholder="Why does this space exist?"
                />
              )}
            </div>
          </div>

          <div className={`flex-1 grid gap-3 content-start pb-20 ${isCompact ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {activeItems.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-stone-300 space-y-4 text-center empty-state">
                 <div className="p-6 bg-stone-100 rounded-full"><Plus size={32} /></div>
                 <p className="small-meta empty-state-title">This space is ready.</p>
              </div>
            )}
            {activeItems.map(item => (
              <div
                key={item.id}
                draggable="true"
                onDragStart={(e) => { setDraggedItemId(item.id); e.currentTarget.style.opacity = '0.5'; }}
                onDragEnd={(e) => { setDraggedItemId(null); e.currentTarget.style.opacity = '1'; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (draggedItemId) reorderItems(draggedItemId, item.id); }}
                className={`transition-all ${draggedItemId === item.id ? 'scale-95' : ''}`}
              >
                <button
                  onClick={() => { 
                    updateItem(item.id, { visitCount: (item.visitCount || 0) + 1 });
                    setActiveItemId(item.id); 
                    setView('item'); 
                  }}
                  className={`w-full bg-white rounded-2xl overflow-hidden shadow-sm border border-stone-100 active:scale-[0.98] transition-all text-left flex item-card ${isCompact ? 'flex-col' : 'flex-row h-24'}`}
                >
                  <div 
                    className={`relative overflow-hidden shrink-0 flex items-center justify-center ${isCompact ? 'aspect-[4/3] w-full' : 'w-24 h-full'} ${item.image ? '' : 'no-image'}`}
                    style={{ background: item.image ? 'transparent' : generateGradient(item.url || item.title || item.domain) }}
                  >
                    {item.image ? <img src={item.image} className="w-full h-full object-cover" alt="" /> : <span className="text-2xl font-black text-stone-900/10 uppercase">{getInitial(item.title)}</span>}
                    {/* metadata badges */}
                    <div className="absolute top-2 right-2">
                      {item.metaStatus === 'pending' && <span className="meta-dot" />}
                      {item.enrichFlash && <span className="enrich-flash" />}
                    </div>
                  </div>
                  <div className={`p-3 flex flex-col justify-center min-w-0 ${isCompact ? '' : 'flex-1'}`}>
                    <h3 className={`font-bold text-stone-800 leading-tight truncate ${isCompact ? 'text-sm' : 'text-base'}`}>{item.title}</h3>
                    <p className="text-[10px] text-stone-400 font-bold uppercase mt-1 flex items-center gap-1">
                      {item.url ? <img src={getFavicon(item.url)} className="w-3 h-3 rounded-sm" /> : <Camera size={10} />}
                      <span className="truncate">{item.domain}</span>
                    </p>
                  </div>
                </button>
              </div>
            ))}

            {/* Local Archive Toggle */}
            {archivedItems.length > 0 && (
              <div className="mt-8">
                <button 
                  onClick={() => setShowArchive(!showArchive)}
                  className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-stone-300 hover:text-stone-500 transition-colors px-2"
                >
                  <Archive size={14} />
                  {showArchive ? 'Hide Archive' : `Show Archive (${archivedItems.length})`}
                </button>
                
                {showArchive && (
                  <div className="mt-4 space-y-2 opacity-60">
                    {archivedItems.map(item => (
                      <div key={item.id} className="bg-stone-100 rounded-xl p-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-stone-200">
                             {item.image && <img src={item.image} className="w-full h-full object-cover opacity-50 grayscale" alt="" />}
                          </div>
                          <span className="text-sm font-medium text-stone-500 truncate">{item.title}</span>
                        </div>
                        <div className="flex items-center gap-1">
                           <button onClick={() => restoreItem(item.id)} className="p-2 text-stone-400 hover:text-stone-800 transition-colors"><RotateCcw size={16} /></button>
                           <button onClick={() => deleteItemPermanently(item.id)} className="p-2 text-stone-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {!modalMode && (
            <div className="fixed bottom-10 left-0 right-0 flex justify-center z-10 pointer-events-none">
              <button onClick={() => setModalMode('item')} className="pointer-events-auto bg-stone-900 text-stone-50 rounded-full px-8 py-4 shadow-xl flex items-center gap-2 active:scale-90 transition-transform ring-8 ring-stone-50/50 capture-button">
                <Plus size={20} /> <span className="font-bold">Capture</span>
              </button>
            </div>
          )}
          {modalMode === 'item' && <QuickCapture />}
        </div>
      </div>
    );
  }

  if (view === 'item') {
    const item = data.items.find(i => i.id === activeItemId);
    const showNudge = item?.visitCount >= 3 && !item?.notes;

    if (!item) return setView('bucket');

    return (
      <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col items-center">
        <div className="w-full max-w-md min-h-screen bg-white shadow-2xl flex flex-col relative">
          <header className="p-4 flex items-center justify-between border-b border-stone-100 sticky top-0 bg-white/80 backdrop-blur-md z-20">
             <button onClick={() => setView('bucket')} className="p-2 rounded-full hover:bg-stone-100"><ArrowLeft size={24} /></button>
             <div className="text-center">
                <p className="text-[10px] font-black uppercase text-stone-400 tracking-[0.2em]">Item Insight</p>
                <p className="text-xs text-stone-300 font-medium">Revisit #{item.visitCount}</p>
             </div>
             <button onClick={() => archiveItem(item.id)} className="p-2 rounded-full hover:bg-amber-50 text-stone-200 hover:text-amber-600" title="Archive">
              <Archive size={20} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto pb-10">
            <div className="w-full relative bg-stone-50 flex items-center justify-center p-8 overflow-hidden">
                <div className="absolute inset-0 opacity-10 blur-3xl scale-150" style={{ background: generateGradient(item.domain) }} />
                {item.image ? (
                   <img src={item.image} alt="" className="relative z-10 w-full rounded-2xl shadow-2xl max-h-[350px] object-contain" />
                ) : (
                  <div className="relative z-10 h-48 w-full flex items-center justify-center text-stone-200">
                     <LinkIcon size={64} className="opacity-20" />
                  </div>
                )}
            </div>

            <div className="p-8 space-y-10">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-stone-300 uppercase tracking-widest">Identify</label>
                <input 
                  value={item.title}
                  onChange={(e) => updateItem(item.id, { title: e.target.value, userEditedTitle: true })}
                  autoFocus={item.title === 'Untitled link' || !item.title || item.title.length < 3}
                  className="w-full text-2xl font-bold text-stone-800 bg-transparent border-none p-0 focus:ring-0 placeholder-stone-200"
                  placeholder="The Name"
                />
                 {item.url && (
                   <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-500 font-medium text-sm hover:underline">
                      <ExternalLink size={14} /> {item.domain}
                   </a>
                 )}
              </div>

              <div className="space-y-4">
                 <label className="text-[10px] font-black text-stone-300 uppercase tracking-widest">Decision Status</label>
                 <div className="flex gap-2">
                    {['saved', 'shortlisted', 'rejected'].map(status => (
                      <button
                        key={status}
                        onClick={() => updateItem(item.id, { status })}
                        className={`flex-1 py-3 rounded-2xl text-xs font-bold transition-all border ${
                          item.status === status ? 'bg-stone-900 border-stone-900 text-white shadow-lg scale-105' : 'bg-white border-stone-100 text-stone-400'
                        }`}
                      >
                        {status.toUpperCase()}
                      </button>
                    ))}
                 </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black text-stone-300 uppercase tracking-widest">Thought Log</label>
                  {showNudge && <span className="text-[10px] font-bold text-amber-500 animate-pulse">💡 Reflection Prompt</span>}
                </div>
                <div className="relative">
                  <textarea 
                    value={item.notes}
                    onChange={(e) => updateItem(item.id, { notes: e.target.value })}
                    className={`w-full bg-stone-50 rounded-2xl px-5 py-5 text-stone-800 min-h-[160px] resize-none focus:ring-2 focus:ring-stone-100 transition-all leading-relaxed ${showNudge && !item.notes ? 'border-2 border-amber-100' : 'border-none'}`}
                    placeholder={showNudge ? "You've looked at this 3 times now... why did you save it? What's the goal?" : "Jot down context..."}
                  />
                  {showNudge && !item.notes && <div className="absolute top-5 left-5 pointer-events-none text-amber-500 font-serif italic text-lg opacity-30">“Why this?”</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}