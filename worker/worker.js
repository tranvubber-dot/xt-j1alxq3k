// Đổi link Facebook rút gọn (share/v, share/r, fb.watch) ra link video thật.
// Facebook chỉ trả chuyển hướng cho máy chủ, trình duyệt không tự làm được.
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

async function viaRedirect(url, ua) {
  let cur = url;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(cur, { redirect: 'manual', headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9' } });
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

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': OK_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ? origin : OK_ORIGINS[0],
      'Vary': 'Origin',
    };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

    const raw = new URL(req.url).searchParams.get('u') || '';
    let u;
    try { u = new URL(raw); } catch { return json({ error: 'link hỏng' }, 400); }
    const host = u.hostname.replace(/^(www|m|web)\./, '');
    if (!((host === 'facebook.com' && /^\/share\//.test(u.pathname)) || host === 'fb.watch')) return json({ error: 'không phải link rút gọn' }, 400);
    u.search = '';

    const hosts = host === 'fb.watch' ? [u.href] : ['www', 'm', 'mbasic'].map(h => u.href.replace(/\/\/[^/]+/, '//' + h + '.facebook.com'));
    for (const url of hosts) for (const ua of UAS) {
      let got = null;
      try { got = await viaRedirect(url, ua); } catch {}
      if (got) {
        const out = new URL(got);
        out.hostname = 'www.facebook.com';
        for (const k of ['share_url', 'rdid', 'fs', 'mibextid']) out.searchParams.delete(k);
        return json({ url: out.href });
      }
    }
    return json({ error: 'không đổi được' }, 502);
  },
};
