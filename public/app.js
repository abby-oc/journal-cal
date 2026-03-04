// ── State ──────────────────────────────────────────────────────────────────
let allTrades = [];
let activeFilter   = 'all';
let activeSymbol   = null;
let activeError    = null;
let currentRating  = 0;

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const today = () => new Date().toISOString().split('T')[0];
const fmtDate = d => { const x = new Date(d + 'T12:00:00'); return x.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }); };
const fmtNum = (n, d=2) => n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits:d, maximumFractionDigits:d });
const fmtPnl = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${fmtNum(n)}%`;

const ERROR_LABELS = {
  good_trade:      '✅ Good trade',
  fomo:            '😰 FOMO',
  early_exit:      '⏰ Early exit',
  held_too_long:   '📉 Held too long',
  no_stop:         '🚫 No stop',
  poor_sizing:     '⚖️ Poor sizing',
  ignored_signal:  '🙈 Ignored signal',
  overtrading:     '🔄 Overtrading',
  bad_entry:       '📍 Bad entry',
  news_event:      '📰 News event',
};

const EXIT_LABELS = {
  target_hit: '🎯 Target hit',
  stop_hit:   '🛑 Stop hit',
  manual:     '✋ Manual',
  cancelled:  '❌ Cancelled',
};

// ── Data ───────────────────────────────────────────────────────────────────
async function loadAll() {
  const [tradesRes, statsRes] = await Promise.all([
    fetch('/api/trades'),
    fetch('/api/stats'),
  ]);
  allTrades = await tradesRes.json();
  const stats = await statsRes.json();
  renderStats(stats);
  render();
}

// ── Stats sidebar ──────────────────────────────────────────────────────────
function renderStats(s) {
  const pnlClass = s.total_pnl >= 0 ? 'pos' : 'neg';
  const pnlSign  = s.total_pnl >= 0 ? '+' : '';
  $('stat-cards').innerHTML = `
    <div class="stat-card"><div class="sc-label">Total P&amp;L</div>
      <div class="sc-value ${pnlClass}">${pnlSign}$${fmtNum(s.total_pnl)}</div></div>
    <div class="stat-card"><div class="sc-label">Win Rate</div>
      <div class="sc-value ${s.win_rate >= 50 ? 'pos' : 'neg'}">${s.win_rate ?? '—'}%</div></div>
    <div class="stat-card"><div class="sc-label">Open</div>
      <div class="sc-value neutral">${s.open}</div></div>
    <div class="stat-card"><div class="sc-label">Closed</div>
      <div class="sc-value neutral">${s.closed}</div></div>
    <div class="stat-card"><div class="sc-label">Avg R:R</div>
      <div class="sc-value ${s.avg_rr >= 1.5 ? 'pos' : 'neg'}">${s.avg_rr || '—'}</div></div>
    <div class="stat-card"><div class="sc-label">Avg Rating</div>
      <div class="sc-value neutral">${s.avg_rating ? '★ ' + s.avg_rating : '—'}</div></div>
  `;

  // P&L summary in top bar
  $('pnl-summary').innerHTML = s.closed
    ? `${s.closed} closed · <span class="${pnlClass}">${pnlSign}$${fmtNum(s.total_pnl)}</span> · Win rate ${s.win_rate}% (${s.wins}W / ${s.losses}L)`
    : 'No closed trades yet.';

  // Symbol chips
  const symbols = [...new Set(allTrades.map(t => t.symbol))];
  $('symbol-filters').className = 'chip-group';
  $('symbol-filters').innerHTML = symbols.map(sym =>
    `<span class="chip ${activeSymbol === sym ? 'active' : ''}" data-sym="${sym}">${sym.replace('-PERP','')}</span>`
  ).join('');
  $('symbol-filters').querySelectorAll('.chip').forEach(c =>
    c.addEventListener('click', () => { activeSymbol = activeSymbol === c.dataset.sym ? null : c.dataset.sym; render(); })
  );

  // Error chips
  const errors = [...new Set(allTrades.filter(t => t.error_category).map(t => t.error_category))];
  $('error-filters').className = 'chip-group';
  $('error-filters').innerHTML = errors.map(e =>
    `<span class="chip ${activeError === e ? 'active' : ''}" data-err="${e}">${ERROR_LABELS[e] || e}</span>`
  ).join('');
  $('error-filters').querySelectorAll('.chip').forEach(c =>
    c.addEventListener('click', () => { activeError = activeError === c.dataset.err ? null : c.dataset.err; render(); })
  );
}

// ── Render trade list ──────────────────────────────────────────────────────
function render() {
  const q = $('search').value.toLowerCase();
  let trades = [...allTrades];

  if (activeFilter !== 'all') trades = trades.filter(t => t.status === activeFilter);
  if (activeSymbol) trades = trades.filter(t => t.symbol === activeSymbol);
  if (activeError)  trades = trades.filter(t => t.error_category === activeError);
  if (q) trades = trades.filter(t =>
    (t.thesis || '').toLowerCase().includes(q) ||
    (t.setup_notes || '').toLowerCase().includes(q) ||
    (t.lessons || '').toLowerCase().includes(q) ||
    t.symbol.toLowerCase().includes(q) ||
    (t.strategy || '').toLowerCase().includes(q)
  );

  trades.sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));

  if (!trades.length) {
    $('trade-list').innerHTML = `<div class="empty-state"><div class="icon">📭</div><div>No trades found. Hit <strong>+ Log Trade</strong> to start.</div></div>`;
    return;
  }

  // Group by date
  const groups = {};
  trades.forEach(t => { (groups[t.entry_date] = groups[t.entry_date] || []).push(t); });

  let html = '';
  for (const date of Object.keys(groups).sort().reverse()) {
    html += `<div class="date-header">${fmtDate(date)}</div>`;
    for (const t of groups[date]) html += tradeCard(t);
  }
  $('trade-list').innerHTML = html;

  $('trade-list').querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', () => openEdit(b.dataset.id)));
  $('trade-list').querySelectorAll('.open-btn').forEach(b => b.addEventListener('click', () => quickStatus(b.dataset.id, 'open')));
  $('trade-list').querySelectorAll('.close-btn').forEach(b => b.addEventListener('click', () => openClose(b.dataset.id)));
  $('trade-list').querySelectorAll('.cancel-btn').forEach(b => b.addEventListener('click', () => quickStatus(b.dataset.id, 'cancelled')));
  $('trade-list').querySelectorAll('.delete-btn').forEach(b => b.addEventListener('click', () => deleteTrade(b.dataset.id)));
}

function tradeCard(t) {
  const isWin   = (t.actual_pnl_usd ?? 0) > 0;
  const hasClose = t.status === 'closed';
  const statusClass = t.status === 'closed' ? (isWin ? 'status-closed-win' : 'status-closed-loss') : `status-${t.status}`;
  const stars   = t.rating ? '★'.repeat(t.rating) + '☆'.repeat(5 - t.rating) : '';

  // Price row
  const prices = [];
  if (t.entry_price)  prices.push({ l: 'Entry',  v: fmtNum(t.entry_price),  c: '' });
  if (t.stop_loss)    prices.push({ l: 'Stop',   v: fmtNum(t.stop_loss),    c: 'red' });
  if (t.target_price) prices.push({ l: 'Target', v: fmtNum(t.target_price), c: 'green' });
  if (t.expected_rr)  prices.push({ l: 'Exp R:R', v: t.expected_rr + 'R',  c: t.expected_rr >= 1.5 ? 'green' : '' });
  if (t.risk_amount)  prices.push({ l: '$ Risk',  v: '$' + fmtNum(t.risk_amount), c: '' });
  if (hasClose && t.actual_pnl_pct != null)
    prices.push({ l: 'P&L', v: fmtPnl(t.actual_pnl_pct) + (t.actual_pnl_usd != null ? ` ($${fmtNum(t.actual_pnl_usd)})` : ''), c: isWin ? 'green' : 'red' });
  if (hasClose && t.exit_reason)
    prices.push({ l: 'Exit', v: EXIT_LABELS[t.exit_reason] || t.exit_reason, c: '' });

  const priceHtml = prices.map(p => `
    <div class="price-item">
      <span class="pl">${p.l}</span>
      <span class="pv ${p.c}">${esc(p.v)}</span>
    </div>`).join('');

  return `
  <div class="trade-card ${statusClass}" data-id="${t.id}">
    <div class="trade-main">
      <div class="trade-header">
        <span class="trade-symbol">${esc(t.symbol.replace('-PERP',''))}</span>
        <span class="dir-badge ${t.direction}">${t.direction === 'LONG' ? '▲ LONG' : '▼ SHORT'}</span>
        <span class="badge ${t.status}">${t.status}</span>
        ${t.timeframe ? `<span style="font-size:.75rem;color:var(--muted)">${esc(t.timeframe)}</span>` : ''}
        ${t.strategy  ? `<span style="font-size:.75rem;color:var(--muted)">${esc(t.strategy.replace('_',' '))}</span>` : ''}
        ${t.leverage > 1 ? `<span style="font-size:.75rem;color:var(--orange)">${t.leverage}×</span>` : ''}
      </div>
      ${prices.length ? `<div class="trade-prices">${priceHtml}</div>` : ''}
      ${t.thesis ? `<div class="trade-thesis">${esc(t.thesis)}</div>` : ''}
      ${(t.error_category || t.rating) ? `
        <div class="trade-analysis">
          ${t.rating ? `<span class="stars">${stars}</span>` : ''}
          ${t.error_category ? `<span class="error-tag">${esc(ERROR_LABELS[t.error_category] || t.error_category)}</span>` : ''}
          ${t.lessons ? `<span style="font-size:.75rem;color:var(--muted);font-style:italic">"${esc(t.lessons.slice(0,80))}${t.lessons.length > 80 ? '…' : ''}"</span>` : ''}
        </div>` : ''}
    </div>
    <div class="trade-actions">
      <button class="btn-sm edit-btn" data-id="${t.id}">Edit</button>
      ${t.status === 'planned' ? `<button class="btn-sm open-btn" data-id="${t.id}">Open ▶</button>` : ''}
      ${t.status === 'open'    ? `<button class="btn-sm close-btn" data-id="${t.id}">Close ✓</button>` : ''}
      ${t.status !== 'cancelled' && t.status !== 'closed' ? `<button class="btn-sm cancel-btn" data-id="${t.id}">Cancel</button>` : ''}
      <button class="btn-sm danger delete-btn" data-id="${t.id}">Delete</button>
    </div>
  </div>`;
}

// ── Modal ──────────────────────────────────────────────────────────────────
function openNew() {
  $('modal-title').textContent = 'Log Trade';
  $('edit-id').value = '';
  $('trade-form').reset();
  $('f-entry-date').value = today();
  currentRating = 0;
  updateStars(0);
  switchTab('plan');
  $('modal').classList.remove('hidden');
  $('f-symbol').focus();
}

function openEdit(id) {
  const t = allTrades.find(x => x.id === id);
  if (!t) return;
  $('modal-title').textContent = 'Edit Trade';
  $('edit-id').value = t.id;
  // Plan tab
  $('f-symbol').value      = t.symbol || 'BTC-PERP';
  $('f-direction').value   = t.direction || 'LONG';
  $('f-timeframe').value   = t.timeframe || '';
  $('f-strategy').value    = t.strategy  || '';
  $('f-entry-date').value  = t.entry_date || today();
  $('f-entry-time').value  = t.entry_time || '';
  $('f-entry-price').value = t.entry_price || '';
  $('f-stop-loss').value   = t.stop_loss   || '';
  $('f-target-price').value= t.target_price|| '';
  $('f-position-size').value=t.position_size||'';
  $('f-leverage').value    = t.leverage    || 1;
  $('f-risk-amount').value = t.risk_amount || '';
  $('f-thesis').value      = t.thesis      || '';
  $('f-setup-notes').value = t.setup_notes || '';
  $('f-status').value      = t.status      || 'planned';
  // Outcome tab
  $('f-actual-entry').value= t.actual_entry|| '';
  $('f-actual-exit').value = t.actual_exit || '';
  $('f-exit-date').value   = t.exit_date   || '';
  $('f-exit-time').value   = t.exit_time   || '';
  $('f-pnl-pct').value     = t.actual_pnl_pct != null ? t.actual_pnl_pct : '';
  $('f-pnl-usd').value     = t.actual_pnl_usd != null ? t.actual_pnl_usd : '';
  $('f-exit-reason').value = t.exit_reason || '';
  // Analysis tab
  $('f-error-category').value = t.error_category || '';
  $('f-lessons').value        = t.lessons || '';
  currentRating = t.rating || 0;
  updateStars(currentRating);

  updateRRPreview();
  switchTab('plan');
  $('modal').classList.remove('hidden');
}

function openClose(id) {
  openEdit(id);
  $('f-status').value = 'closed';
  $('f-exit-date').value = today();
  switchTab('outcome');
}

function closeModal() { $('modal').classList.add('hidden'); }

// ── Tabs ──────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

// ── R:R Preview ───────────────────────────────────────────────────────────
function updateRRPreview() {
  const ep  = parseFloat($('f-entry-price').value);
  const sl  = parseFloat($('f-stop-loss').value);
  const tp  = parseFloat($('f-target-price').value);
  const ra  = parseFloat($('f-risk-amount').value);
  const dir = $('f-direction').value;
  const prev = $('rr-preview');

  if (!ep || !sl || !tp) { prev.classList.add('hidden'); return; }

  const risk   = Math.abs(ep - sl);
  const reward = Math.abs(tp - ep);
  const rr     = risk > 0 ? (reward / risk) : 0;
  const slPct  = (risk / ep * 100).toFixed(2);
  const tpPct  = (reward / ep * 100).toFixed(2);

  // Check direction consistency
  const dirOk = dir === 'LONG' ? (tp > ep && sl < ep) : (tp < ep && sl > ep);

  prev.classList.remove('hidden');
  prev.innerHTML = `
    <div class="rr-item"><span class="rl">R:R</span><span class="rv ${rr >= 1.5 ? 'good' : 'bad'}">${rr.toFixed(2)}R</span></div>
    <div class="rr-item"><span class="rl">Stop dist</span><span class="rv">${slPct}%</span></div>
    <div class="rr-item"><span class="rl">Target dist</span><span class="rv">${tpPct}%</span></div>
    ${ra ? `<div class="rr-item"><span class="rl">Max loss</span><span class="rv red">-$${fmtNum(ra)}</span></div>` : ''}
    ${ra && rr > 0 ? `<div class="rr-item"><span class="rl">Max gain</span><span class="rv good">+$${fmtNum(ra * rr)}</span></div>` : ''}
    ${!dirOk ? `<div class="rr-item"><span class="rv bad">⚠ Check direction vs prices</span></div>` : ''}
  `;
}

['f-entry-price','f-stop-loss','f-target-price','f-risk-amount','f-direction']
  .forEach(id => $(id).addEventListener('input', updateRRPreview));

// ── Star rating ───────────────────────────────────────────────────────────
function updateStars(n) {
  document.querySelectorAll('#star-rating button').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.star) <= n);
  });
  $('f-rating').value = n;
}
document.querySelectorAll('#star-rating button').forEach(b => {
  b.addEventListener('click', () => {
    currentRating = parseInt(b.dataset.star) === currentRating ? 0 : parseInt(b.dataset.star);
    updateStars(currentRating);
  });
});

// ── Form submit ───────────────────────────────────────────────────────────
$('trade-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('edit-id').value;

  const payload = {
    symbol:        $('f-symbol').value,
    direction:     $('f-direction').value,
    timeframe:     $('f-timeframe').value || null,
    strategy:      $('f-strategy').value  || null,
    entry_date:    $('f-entry-date').value,
    entry_time:    $('f-entry-time').value || null,
    entry_price:   parseFloat($('f-entry-price').value) || null,
    stop_loss:     parseFloat($('f-stop-loss').value)   || null,
    target_price:  parseFloat($('f-target-price').value)|| null,
    position_size: parseFloat($('f-position-size').value)||null,
    leverage:      parseFloat($('f-leverage').value)    || 1,
    risk_amount:   parseFloat($('f-risk-amount').value) || null,
    thesis:        $('f-thesis').value.trim()      || null,
    setup_notes:   $('f-setup-notes').value.trim() || null,
    status:        $('f-status').value,
    // Outcome
    actual_entry:  parseFloat($('f-actual-entry').value)|| null,
    actual_exit:   parseFloat($('f-actual-exit').value) || null,
    exit_date:     $('f-exit-date').value || null,
    exit_time:     $('f-exit-time').value || null,
    actual_pnl_pct:parseFloat($('f-pnl-pct').value)    || null,
    actual_pnl_usd:parseFloat($('f-pnl-usd').value)    || null,
    exit_reason:   $('f-exit-reason').value || null,
    // Analysis
    rating:        currentRating || null,
    error_category:$('f-error-category').value || null,
    lessons:       $('f-lessons').value.trim() || null,
  };

  const method = id ? 'PATCH' : 'POST';
  const url    = id ? `/api/trades/${id}` : '/api/trades';
  await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });

  closeModal();
  loadAll();
});

// ── Quick actions ─────────────────────────────────────────────────────────
async function quickStatus(id, status) {
  await fetch(`/api/trades/${id}`, {
    method: 'PATCH', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ status })
  });
  loadAll();
}

async function deleteTrade(id) {
  if (!confirm('Delete this trade?')) return;
  await fetch(`/api/trades/${id}`, { method: 'DELETE' });
  loadAll();
}

// ── Filter buttons ────────────────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    render();
  });
});

// ── Modal wiring ──────────────────────────────────────────────────────────
$('new-btn').addEventListener('click', openNew);
$('modal-close').addEventListener('click', closeModal);
$('cancel-btn').addEventListener('click', closeModal);
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
$('search').addEventListener('input', render);

// ── Boot ──────────────────────────────────────────────────────────────────
loadAll();


// ══════════════════════════════════════════════════════════════════════════
// SYSTEM LOG
// ══════════════════════════════════════════════════════════════════════════

const TYPE_META = {
  insight:    { icon: '🧠', color: '#6c8cff', label: 'Insight' },
  decision:   { icon: '⚙️', color: '#f59e0b', label: 'Decision' },
  alert:      { icon: '🚨', color: '#f87171', label: 'Alert' },
  experiment: { icon: '🧪', color: '#a78bfa', label: 'Experiment' },
  hypothesis: { icon: '💡', color: '#34d399', label: 'Hypothesis' },
  status:     { icon: '📊', color: '#6b7280', label: 'Status' },
};

async function loadSystemLog() {
  const type = document.getElementById('log-type-filter')?.value || '';
  const url = type ? `/api/system-log?limit=100&type=${type}` : '/api/system-log?limit=100';
  const res = await fetch(url);
  const entries = await res.json();
  renderSystemLog(entries);
}

function renderSystemLog(entries) {
  const el = document.getElementById('system-log-list');
  if (!entries.length) {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:#6b7280;">No entries yet. Analyst will post here on next heartbeat.</div>';
    return;
  }

  el.innerHTML = entries.map(e => {
    const meta = TYPE_META[e.type] || TYPE_META.status;
    const ts = new Date(e.created_at).toLocaleString('en-US', {
      month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
    });
    const content = (e.content || '').replace(/\n/g, '<br>');
    return `
      <div class="trade-card" style="border-left:3px solid ${meta.color}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:1.1rem">${meta.icon}</span>
            <span style="background:${meta.color}22;color:${meta.color};padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;text-transform:uppercase">${meta.label}</span>
            ${e.title ? `<span style="font-weight:600;color:#e2e6f0">${e.title}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="color:#6b7280;font-size:0.78rem">${ts}</span>
            <button onclick="deleteLogEntry('${e.id}')" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.85rem;padding:2px 4px" title="Delete">✕</button>
          </div>
        </div>
        <div style="color:#b0b8d0;font-size:0.88rem;line-height:1.6">${content}</div>
        ${e.tags?.length ? `<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">${e.tags.map(t => `<span style="background:#2e3350;color:#8892b0;padding:1px 7px;border-radius:10px;font-size:0.72rem">${t}</span>`).join('')}</div>` : ''}
      </div>`;
  }).join('');
}

async function deleteLogEntry(id) {
  if (!confirm('Delete this entry?')) return;
  await fetch(`/api/system-log/${id}`, { method: 'DELETE' });
  loadSystemLog();
}

// ── View toggle ───────────────────────────────────────────────────────────
function setView(view) {
  document.getElementById('view-trades').style.display = view === 'trades' ? '' : 'none';
  document.getElementById('view-log').style.display    = view === 'log'    ? '' : 'none';
  document.getElementById('view-trades-btn').classList.toggle('active', view === 'trades');
  document.getElementById('view-log-btn').classList.toggle('active', view === 'log');
  if (view === 'log') loadSystemLog();
}
