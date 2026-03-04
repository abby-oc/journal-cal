const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3741;
const DATA_FILE = path.join(__dirname, 'events.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadEvents() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveEvents(events) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(events, null, 2));
}

// GET all events
app.get('/api/events', (req, res) => {
  res.json(loadEvents());
});

// POST new event
app.post('/api/events', (req, res) => {
  const events = loadEvents();
  const rawTags = req.body.tags || req.body.tag || 'general';
  const tags = Array.isArray(rawTags)
    ? rawTags
    : rawTags.split(',').map(t => t.trim()).filter(Boolean);

  const event = {
    id: Date.now().toString(),
    title: req.body.title,
    notes: req.body.notes || '',
    date: req.body.date,
    time: req.body.time || '',
    tags: tags.length ? tags : ['general'],
    status: req.body.status || 'active',
    createdAt: new Date().toISOString()
  };
  events.push(event);
  saveEvents(events);
  res.json(event);
});

// PATCH update event
app.patch('/api/events/:id', (req, res) => {
  const events = loadEvents();
  const idx = events.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const patch = { ...req.body };
  if (patch.tags !== undefined) {
    const raw = patch.tags;
    patch.tags = Array.isArray(raw)
      ? raw
      : raw.split(',').map(t => t.trim()).filter(Boolean);
    if (!patch.tags.length) patch.tags = ['general'];
    delete patch.tag;
  }

  events[idx] = { ...events[idx], ...patch };
  saveEvents(events);
  res.json(events[idx]);
});

// DELETE event
app.delete('/api/events/:id', (req, res) => {
  let events = loadEvents();
  events = events.filter(e => e.id !== req.params.id);
  saveEvents(events);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Journal Cal running at http://localhost:${PORT}`);
});
