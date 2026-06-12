const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const mongoose = require('mongoose');
const User = require('./models/User');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const adminRoutes = require('./routes/admin');
const { isAuthenticated } = require('./middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'super-secret-key-change-me',
  resave: false,
  saveUninitialized: true
}));

global.users = [];

async function initializeDatabase() {
  console.log('Database initialized with in-memory store');
  console.log('No default users - registration required');
}

app.use('/auth', authRoutes);
app.use('/profile', profileRoutes);
app.use('/admin', adminRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', isAuthenticated, async (req, res) => {
  const user = global.users.find(u => u._id === req.session.userId);
  if (!user) {
    return res.redirect('/');
  }
  res.render('dashboard', { user });
});

app.get('/profile', isAuthenticated, async (req, res) => {
  const user = global.users.find(u => u._id === req.session.userId);
  if (!user) {
    return res.redirect('/');
  }
  res.render('profile', { user });
});

app.get('/admin', isAuthenticated, async (req, res) => {
  const user = global.users.find(u => u._id === req.session.userId);
  if (!user || !user.isAdmin) {
    return res.status(403).send('Access Denied');
  }
  const allUsers = global.users.map(({ password, ...u }) => u);
  res.render('admin', { user, users: allUsers, flag: process.env.FLAG });
});

initializeDatabase().then(() => {
  app.listen(3000, '0.0.0.0', () => {
    console.log('Server running on port 3000');
    console.log('Access at http://localhost:3000');
  });
});