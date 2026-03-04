const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3741;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET all events
app.get('/api/events', async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST new event
app.post('/api/events', async (req, res) => {
  const { title, notes, date, time, tags, status } = req.body;
  const parsedTags = Array.isArray(tags)
    ? tags
    : (tags || 'general').split(',').map(t => t.trim()).filter(Boolean);

  const { data, error } = await supabase
    .from('events')
    .insert([{ title, notes: notes || '', date, time: time || '', tags: parsedTags, status: status || 'active' }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH update event
app.patch('/api/events/:id', async (req, res) => {
  const patch = { ...req.body };
  if (patch.tags !== undefined) {
    const raw = patch.tags;
    patch.tags = Array.isArray(raw)
      ? raw
      : raw.split(',').map(t => t.trim()).filter(Boolean);
    if (!patch.tags.length) patch.tags = ['general'];
  }

  const { data, error } = await supabase
    .from('events')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE event
app.delete('/api/events/:id', async (req, res) => {
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Journal Cal running at http://localhost:${PORT}`);
});
