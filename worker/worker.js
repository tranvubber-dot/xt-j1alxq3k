// Đổi link Facebook rút gọn (share/v, share/r, fb.watch) ra link video thật.
// Facebook chỉ trả chuyển hướng cho máy chủ, trình duyệt không tự làm được.
const OK_ORIGINS = ['https://tranvubber-dot.github.io'];

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
    const shortLink = (host === 'facebook.com' && /^\/share\//.test(u.pathname)) || host === 'fb.watch';
    if (!shortLink) return json({ error: 'không phải link rút gọn' }, 400);

    let cur = u.href;
    for (let i = 0; i < 5; i++) {
      const r = await fetch(cur, { redirect: 'manual', headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
      const loc = r.headers.get('Location');
      if (!loc) break;
      cur = new URL(loc, cur).href;
      if (!/\/share\/|fb\.watch/.test(cur)) break;
    }
    const out = new URL(cur);
    for (const k of ['share_url', 'rdid', 'fs', 'mibextid']) out.searchParams.delete(k);
    if (out.href === u.href) return json({ error: 'không đổi được' }, 502);
    return json({ url: out.href });
  },
};
