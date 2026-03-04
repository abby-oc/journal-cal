let allEvents = [];
let activeFilter = 'all';
let activeTag = null;

const modal = document.getElementById('modal');
const form = document.getElementById('event-form');
const eventList = document.getElementById('event-list');
const tagList = document.getElementById('tag-list');
const searchInput = document.getElementById('search');

// Helpers
const getTags = e => {
  if (Array.isArray(e.tags) && e.tags.length) return e.tags;
  if (typeof e.tags === 'string' && e.tags) return e.tags.split(',').map(t => t.trim()).filter(Boolean);
  if (typeof e.tag === 'string' && e.tag) return e.tag.split(',').map(t => t.trim()).filter(Boolean);
  return ['general'];
};

const fmt = dateStr => {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};
const today = () => new Date().toISOString().split('T')[0];

// Load
async function loadEvents() {
  const res = await fetch('/api/events');
  allEvents = await res.json();
  render();
}

// Render
function render() {
  const q = searchInput.value.toLowerCase();

  let events = [...allEvents];

  if (activeFilter !== 'all') events = events.filter(e => e.status === activeFilter);
  if (activeTag) events = events.filter(e => getTags(e).includes(activeTag));
  if (q) events = events.filter(e =>
    e.title.toLowerCase().includes(q) ||
    (e.notes || '').toLowerCase().includes(q) ||
    getTags(e).join(' ').toLowerCase().includes(q)
  );

  // Sort by date desc
  events.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  // Build tag list from all events
  const tags = [...new Set(allEvents.flatMap(e => getTags(e)))];
  tagList.innerHTML = tags.map(t =>
    `<span class="tag-chip ${activeTag === t ? 'active' : ''}" data-tag="${t}">${t}</span>`
  ).join('');
  tagList.querySelectorAll('.tag-chip').forEach(el => {
    el.addEventListener('click', () => {
      activeTag = activeTag === el.dataset.tag ? null : el.dataset.tag;
      render();
    });
  });

  if (!events.length) {
    eventList.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <div>No entries yet. Hit <strong>+ New Entry</strong> to start your log.</div>
      </div>`;
    return;
  }

  // Group by date
  const groups = {};
  events.forEach(e => {
    if (!groups[e.date]) groups[e.date] = [];
    groups[e.date].push(e);
  });

  let html = '';
  for (const date of Object.keys(groups)) {
    html += `<div class="date-group-header">${fmt(date)}</div>`;
    for (const e of groups[date]) {
      const timeStr = e.time ? ` · ${e.time}` : '';
      html += `
        <div class="event-card status-${e.status}" data-id="${e.id}">
          <div class="event-main">
            <div class="event-title">${esc(e.title)}</div>
            <div class="event-meta">
              <span>${fmt(e.date)}${timeStr}</span>
              ${getTags(e).map(t => `<span class="event-tag">${esc(t)}</span>`).join('')}
              <span class="status-pill ${e.status}">${e.status}</span>
            </div>
            ${e.notes ? `<div class="event-notes">${esc(e.notes)}</div>` : ''}
          </div>
          <div class="event-actions">
            <button class="btn-sm edit-btn" data-id="${e.id}">Edit</button>
            ${e.status !== 'completed'
              ? `<button class="btn-sm complete-btn" data-id="${e.id}">✓ Done</button>`
              : ''}
            <button class="btn-sm danger delete-btn" data-id="${e.id}">Delete</button>
          </div>
        </div>`;
    }
  }

  eventList.innerHTML = html;

  eventList.querySelectorAll('.edit-btn').forEach(b =>
    b.addEventListener('click', () => openEdit(b.dataset.id)));
  eventList.querySelectorAll('.complete-btn').forEach(b =>
    b.addEventListener('click', () => markDone(b.dataset.id)));
  eventList.querySelectorAll('.delete-btn').forEach(b =>
    b.addEventListener('click', () => deleteEvent(b.dataset.id)));
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Modal
function openNew() {
  document.getElementById('modal-title').textContent = 'New Entry';
  document.getElementById('edit-id').value = '';
  form.reset();
  document.getElementById('f-date').value = today();
  modal.classList.remove('hidden');
  document.getElementById('f-title').focus();
}

function openEdit(id) {
  const e = allEvents.find(x => x.id === id);
  if (!e) return;
  document.getElementById('modal-title').textContent = 'Edit Entry';
  document.getElementById('edit-id').value = e.id;
  document.getElementById('f-title').value = e.title;
  document.getElementById('f-date').value = e.date;
  document.getElementById('f-time').value = e.time || '';
  document.getElementById('f-tag').value = getTags(e).join(', ');
  document.getElementById('f-status').value = e.status;
  document.getElementById('f-notes').value = e.notes || '';
  modal.classList.remove('hidden');
}

function closeModal() { modal.classList.add('hidden'); }

document.getElementById('new-btn').addEventListener('click', openNew);
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('cancel-btn').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

// Form submit
form.addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const data = {
    title: document.getElementById('f-title').value.trim(),
    date: document.getElementById('f-date').value,
    time: document.getElementById('f-time').value,
    tags: document.getElementById('f-tag').value || 'general',
    status: document.getElementById('f-status').value,
    notes: document.getElementById('f-notes').value.trim()
  };

  if (id) {
    await fetch(`/api/events/${id}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  } else {
    await fetch('/api/events', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  }

  closeModal();
  loadEvents();
});

// Actions
async function markDone(id) {
  await fetch(`/api/events/${id}`, {
    method: 'PATCH', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ status: 'completed' })
  });
  loadEvents();
}

async function deleteEvent(id) {
  if (!confirm('Delete this entry?')) return;
  await fetch(`/api/events/${id}`, { method: 'DELETE' });
  loadEvents();
}

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    render();
  });
});

searchInput.addEventListener('input', render);

// Init
loadEvents();
