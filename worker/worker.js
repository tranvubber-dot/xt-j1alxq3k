// Máy chủ nhỏ cho app Xem Tiếp:
//  ?u=<link>    → đổi link rút gọn (share/v, fb.watch) ra link video thật + lấy tên phim, ảnh bìa
//  ?img=<link>  → chuyển ảnh bìa fbcdn kèm CORS để app thu nhỏ rồi cất trong máy
// Từ IP Cloudflare, Facebook hay đẩy sang trang đăng nhập → thử nhiều kiểu máy hỏi + đọc HTML.
const OK_ORIGINS = ['https://tranvubber-dot.github.io'];
const UAS = [
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'WhatsApp/2.24.20.80 A',
  'Twitterbot/1.0',
  'TelegramBot (like TwitterBot)',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
];
const VIDEO_RE = /facebook\.com\\?\/(?:reel|watch\/?\?v=|[^"'\s]*?\/videos)\\?\/?(?:[^"'\s\\]*?\\?\/)?(\d{8,})/;

const isShort = h => /facebook\.com\/share\/|fb\.watch\//.test(h);
const isLogin = h => /\/login|checkpoint|\/recover/.test(h);
const get = (url, ua) => fetch(url, { redirect: 'manual', headers: { 'User-Agent': ua, 'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8' } });

async function viaRedirect(url, ua) {
  let cur = url;
  for (let i = 0; i < 5; i++) {
    const r = await get(cur, ua);
    const loc = r.headers.get('Location');
    if (!loc) {
      if (r.status === 200 && !isShort(cur) && !isLogin(cur)) return cur;
      // Không chuyển hướng → tìm link video trong HTML (og:url, canonical…)
      if (r.status === 200) {
        const m = (await r.text()).match(VIDEO_RE);
        if (m) return 'https://www.facebook.com/reel/' + m[1] + '/';
      }
      return null;
    }
    cur = new URL(loc, cur).href;
    if (isLogin(cur)) return null;
    if (!isShort(cur)) return cur;
  }
  return null;
}

const decode = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/ /g, ' ');
const meta = (html, p) => { const m = html.match(new RegExp('<meta property="og:' + p + '" content="([^"]*)"')); return m ? decode(m[1]).trim() : ''; };

// "85K lượt xem · 1,8K cảm xúc | FULL Mùa 2 | Tên phim | Facebook" → "FULL Mùa 2 | Tên phim"
function cleanTitle(t) {
  const parts = t.split(/\s+\|\s+/).filter(p =>
    p && !/lượt xem|cảm xúc|views?\b|reactions?\b|^facebook$|^(by|của) /i.test(p));
  return parts.join(' | ')
    .replace(/#\S+/g, '').replace(/\([^)]*\)/g, '')   // bỏ hashtag, phần ghi chú trong ngoặc
    .replace(/\s+/g, ' ').replace(/[\s|·,-]+$/, '').trim().slice(0, 120);
}

async function info(url) {
  const urls = [url, url.replace('//www.', '//m.')];
  for (const u of urls) for (const ua of UAS) {
    try {
      const r = await get(u, ua);
      if (r.status !== 200) continue;
      const html = await r.text();
      const title = cleanTitle(meta(html, 'title') || meta(html, 'description'));
      const image = meta(html, 'image');
      // Facebook chặn thì trả tên chung chung kiểu "Khám phá các video phổ biến" → bỏ
      if (title && !/khám phá|phổ biến|explore|popular|đăng nhập|log ?in/i.test(title)) return { title, image };
    } catch {}
  }
  return {};
}

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': OK_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ? origin : OK_ORIGINS[0],
      'Vary': 'Origin',
    };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
    const q = new URL(req.url).searchParams;

    if (q.get('img')) {
      let iu;
      try { iu = new URL(q.get('img')); } catch { return json({ error: 'link ảnh hỏng' }, 400); }
      if (!/(^|\.)fbcdn\.net$/.test(iu.hostname)) return json({ error: 'chỉ nhận ảnh fbcdn' }, 400);
      const r = await fetch(iu.href);
      return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } });
    }

    let u;
    try { u = new URL(q.get('u') || ''); } catch { return json({ error: 'link hỏng' }, 400); }
    const host = u.hostname.replace(/^(www|m|web|mbasic)\./, '');
    if (!['facebook.com', 'fb.watch', 'fb.com'].includes(host)) return json({ error: 'không phải link Facebook' }, 400);

    let url = u.href;
    if (isShort(url)) {
      u.search = '';
      const hosts = host === 'fb.watch' ? [u.href] : ['www', 'm', 'mbasic'].map(h => u.href.replace(/\/\/[^/]+/, '//' + h + '.facebook.com'));
      url = null;
      outer: for (const h of hosts) for (const ua of UAS) {
        try { url = await viaRedirect(h, ua); } catch {}
        if (url) break outer;
      }
      if (!url) return json({ error: 'không đổi được' }, 502);
      const out = new URL(url);
      out.hostname = 'www.facebook.com';
      for (const k of ['share_url', 'rdid', 'fs', 'mibextid']) out.searchParams.delete(k);
      url = out.href;
    }
    return json({ url, ...(await info(url)) });
  },
};
