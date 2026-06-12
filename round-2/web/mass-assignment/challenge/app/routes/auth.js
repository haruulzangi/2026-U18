const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

global.users = global.users || [];

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  let user = global.users.find(u => u.username === username);
  
  if (!user) {
    try {
      const User = require('../models/User');
      const dbUser = await User.findOne({ username });
      if (dbUser) {
        user = dbUser.toObject();
      }
    } catch (err) {
    }
  }
  
  if (user && await bcrypt.compare(password, user.password)) {
    req.session.userId = user._id;
    req.session.isAdmin = user.isAdmin;
    res.json({ success: true, redirect: '/dashboard' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

router.post('/register', async (req, res) => {
  const { username, password, email, department } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  if (username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: 'Username must be 3-30 characters' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  const existingUser = global.users.find(u => u.username === username);
  if (existingUser) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  
  const allowedFields = {
    username: username.trim(),
    password: await bcrypt.hash(password, 10),
    email: email?.trim() || '',
    department: department?.trim() || 'Unassigned'
  };
  
  const newUser = {
    _id: String(global.users.length + 1),
    username: allowedFields.username,
    password: allowedFields.password,
    email: allowedFields.email,
    department: allowedFields.department,
    role: 'user',
    isAdmin: false,
    preferences: { 
      theme: 'light', 
      notifications: true 
    },
    profileViews: 0
  };
  
  global.users.push(newUser);
  
  console.log(`[REGISTRATION] New user registered: ${username} (role: user)`);
  
  res.json({ 
    success: true, 
    message: 'Registration successful! Please login.',
    redirect: '/'
  });
});

module.exports = router;