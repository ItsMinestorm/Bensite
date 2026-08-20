const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';

// Hash password on startup
const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return res.status(401).json({ error: 'Token expired' });
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  if (!bcrypt.compareSync(password, passwordHash)) {
    return res.status(403).json({ error: 'Wrong password' });
  }

  // Simple token: base64 encoded payload + expiry
  const payload = {
    admin: true,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 // 24h
  };
  const token = `header.${Buffer.from(JSON.stringify(payload)).toString('base64')}.sig`;
  res.json({ token });
});

// Public: get all projects
app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY sort_order ASC, created_at DESC').all();
  res.json(projects);
});

// Admin: create project
app.post('/api/projects', auth, (req, res) => {
  const { title, category, url, description, featured } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const result = db.prepare(
    'INSERT INTO projects (title, category, url, description, featured) VALUES (?, ?, ?, ?, ?)'
  ).run(title, category || '', url || '', description || '', featured ? 1 : 0);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(project);
});

// Admin: update project
app.put('/api/projects/:id', auth, (req, res) => {
  const { id } = req.params;
  const { title, category, url, description, featured, sort_order } = req.body;

  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare(
    'UPDATE projects SET title = ?, category = ?, url = ?, description = ?, featured = ?, sort_order = ? WHERE id = ?'
  ).run(
    title ?? existing.title,
    category ?? existing.category,
    url ?? existing.url,
    description ?? existing.description,
    featured !== undefined ? (featured ? 1 : 0) : existing.featured,
    sort_order ?? existing.sort_order,
    id
  );

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.json(project);
});

// Admin: delete project
app.delete('/api/projects/:id', auth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  res.json({ success: true });
});

// SPA fallback for admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Seed default project if empty
const count = db.prepare('SELECT COUNT(*) as c FROM projects').get();
if (count.c === 0) {
  db.prepare(
    'INSERT INTO projects (title, category, url, description, featured, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('Wildtrek Overland', 'Overlanding & Travel', 'https://wildtrekoverland.com/demo', 'Bold, responsive website for an adventure travel brand. Built to inspire exploration and drive bookings.', 1, 0);
  console.log('Seeded Wildtrek Overland project');
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
