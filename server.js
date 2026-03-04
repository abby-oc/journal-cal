const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3741;

app.use(express.urlencoded({ extended: false }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const crypto = require('crypto');

const PASS      = process.env.JOURNAL_PASS || 'vest2026';
const SECRET    = process.env.JOURNAL_SECRET || 'tJ8x#mQ2$vR9kL4n';
const COOKIE    = 'tj_session';

function sign(val) {
  return crypto.createHmac('sha256', SECRET).update(val).digest('hex');
}
function validCookie(cookieHeader) {
  if (!cookieHeader) return false;
  const match = cookieHeader.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!match) return false;
  const [ts, sig] = match[1].split('.');
  if (!ts || !sig) return false;
  if (Date.now() - parseInt(ts) > 7 * 24 * 60 * 60 * 1000) return false; // 7-day expiry
  return sig === sign(ts);
}

// ── Login page ────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  const err = req.headers.referer?.includes('/login') ? '' : '';
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Trade Journal</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f1117;color:#e2e6f0;font-family:system-ui,sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh}
  .box{background:#1a1d27;border:1px solid #2e3350;border-radius:12px;
       padding:36px 40px;width:320px;display:flex;flex-direction:column;gap:16px}
  h2{font-size:1.1rem;font-weight:700;text-align:center}
  .brand{text-align:center;font-size:1.4rem;margin-bottom:4px}
  input{background:#22263a;border:1px solid #2e3350;color:#e2e6f0;
        padding:10px 12px;border-radius:8px;font-size:0.95rem;width:100%;outline:none}
  input:focus{border-color:#6c8cff}
  button{background:#6c8cff;color:#fff;border:none;padding:10px;
         border-radius:8px;font-size:0.95rem;font-weight:600;cursor:pointer;width:100%}
  button:hover{opacity:.85}
  .err{color:#f87171;font-size:0.82rem;text-align:center}
</style></head><body>
<div class="box">
  <div class="brand">📒</div>
  <h2>Trade Journal</h2>
  ${req.query.err ? '<div class="err">Wrong password — try again</div>' : ''}
  <form method="POST" action="/login">
    <div style="display:flex;flex-direction:column;gap:10px">
      <input type="password" name="pass" placeholder="Password" autofocus autocomplete="current-password"/>
      <button type="submit">Enter →</button>
    </div>
  </form>
</div></body></html>`);
});

app.post('/login', (req, res) => {
  if (req.body.pass === PASS) {
    const ts  = Date.now().toString();
    const tok = `${ts}.${sign(ts)}`;
    res.setHeader('Set-Cookie', `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7*24*3600}`);
    return res.redirect('/');
  }
  res.redirect('/login?err=1');
});

// ── Auth gate ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (validCookie(req.headers.cookie)) return next();
  res.redirect('/login');
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── GET all trades ────────────────────────────────────────────────────────
app.get('/api/trades', async (req, res) => {
  const { status, symbol, strategy } = req.query;
  let q = supabase.from('trades').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false });
  if (status)   q = q.eq('status', status);
  if (symbol)   q = q.eq('symbol', symbol);
  if (strategy) q = q.eq('strategy', strategy);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── POST new trade ────────────────────────────────────────────────────────
app.post('/api/trades', async (req, res) => {
  const t = req.body;
  // Compute expected R:R if we have the numbers
  let expected_rr = t.expected_rr || null;
  if (!expected_rr && t.entry_price && t.stop_loss && t.target_price) {
    const risk   = Math.abs(t.entry_price - t.stop_loss);
    const reward = Math.abs(t.target_price - t.entry_price);
    if (risk > 0) expected_rr = parseFloat((reward / risk).toFixed(2));
  }

  const { data, error } = await supabase
    .from('trades')
    .insert([{
      symbol:       t.symbol,
      direction:    t.direction,
      timeframe:    t.timeframe || null,
      strategy:     t.strategy  || null,
      tags:         Array.isArray(t.tags) ? t.tags : (t.tags || '').split(',').map(s => s.trim()).filter(Boolean),
      entry_date:   t.entry_date,
      entry_time:   t.entry_time || null,
      entry_price:  t.entry_price  || null,
      stop_loss:    t.stop_loss    || null,
      target_price: t.target_price || null,
      position_size:t.position_size|| null,
      leverage:     t.leverage     || 1,
      risk_amount:  t.risk_amount  || null,
      expected_rr,
      thesis:       t.thesis       || null,
      setup_notes:  t.setup_notes  || null,
      status:       t.status       || 'planned',
    }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── PATCH trade ───────────────────────────────────────────────────────────
app.patch('/api/trades/:id', async (req, res) => {
  const patch = { ...req.body };

  // Recompute expected_rr if plan fields updated
  if ((patch.entry_price || patch.stop_loss || patch.target_price) && !patch.expected_rr) {
    // Fetch current to fill missing fields
    const { data: cur } = await supabase.from('trades').select('entry_price,stop_loss,target_price').eq('id', req.params.id).single();
    if (cur) {
      const ep = patch.entry_price  ?? cur.entry_price;
      const sl = patch.stop_loss    ?? cur.stop_loss;
      const tp = patch.target_price ?? cur.target_price;
      if (ep && sl && tp) {
        const risk   = Math.abs(ep - sl);
        const reward = Math.abs(tp - ep);
        if (risk > 0) patch.expected_rr = parseFloat((reward / risk).toFixed(2));
      }
    }
  }

  // Compute actual P&L when closing
  if (patch.actual_exit && patch.actual_entry && !patch.actual_pnl_pct) {
    const { data: cur } = await supabase.from('trades').select('direction,risk_amount,actual_entry').eq('id', req.params.id).single();
    if (cur) {
      const entry  = patch.actual_entry ?? cur.actual_entry;
      const exit   = patch.actual_exit;
      const dir    = cur.direction === 'LONG' ? 1 : -1;
      const pnlPct = dir * (exit - entry) / entry * 100;
      patch.actual_pnl_pct = parseFloat(pnlPct.toFixed(3));
      if (cur.risk_amount) {
        patch.actual_pnl_usd = parseFloat((cur.risk_amount * pnlPct / 100).toFixed(2));
      }
    }
  }

  if (patch.tags !== undefined && !Array.isArray(patch.tags)) {
    patch.tags = patch.tags.split(',').map(s => s.trim()).filter(Boolean);
  }

  const { data, error } = await supabase
    .from('trades').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── DELETE trade ──────────────────────────────────────────────────────────
app.delete('/api/trades/:id', async (req, res) => {
  const { error } = await supabase.from('trades').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── GET stats summary ─────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  const { data, error } = await supabase.from('trades').select('*');
  if (error) return res.status(500).json({ error: error.message });

  const closed  = data.filter(t => t.status === 'closed');
  const wins    = closed.filter(t => (t.actual_pnl_usd ?? 0) > 0);
  const losses  = closed.filter(t => (t.actual_pnl_usd ?? 0) <= 0);
  const totalPnl = closed.reduce((s, t) => s + (t.actual_pnl_usd ?? 0), 0);
  const avgRR   = closed.filter(t => t.expected_rr).reduce((s,t,_,a) => s + t.expected_rr/a.length, 0);
  const avgRating = closed.filter(t => t.rating).reduce((s,t,_,a) => s + t.rating/a.length, 0);

  // Error category breakdown
  const errorCounts = {};
  closed.filter(t => t.error_category).forEach(t => {
    errorCounts[t.error_category] = (errorCounts[t.error_category] || 0) + 1;
  });

  res.json({
    total:      data.length,
    open:       data.filter(t => t.status === 'open').length,
    planned:    data.filter(t => t.status === 'planned').length,
    closed:     closed.length,
    wins:       wins.length,
    losses:     losses.length,
    win_rate:   closed.length ? parseFloat((wins.length / closed.length * 100).toFixed(1)) : null,
    total_pnl:  parseFloat(totalPnl.toFixed(2)),
    avg_rr:     parseFloat(avgRR.toFixed(2)),
    avg_rating: parseFloat(avgRating.toFixed(1)),
    error_counts: errorCounts,
  });
});

app.listen(PORT, () => console.log(`Trade Journal running at http://localhost:${PORT}`));
