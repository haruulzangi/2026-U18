const express = require('express');
const session = require('express-session');
const path = require('path');
const app = express();

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'idor-challenge-secret',
  resave: false,
  saveUninitialized: true
}));

const ADMIN_PASSWORD = Math.random().toString(36).slice(-12);
console.log(`\n🔐 Admin password: ${ADMIN_PASSWORD}\n`);

const users = {
  1: { 
    id: 1, 
    username: 'alice', 
    password: 'password123',
    name: 'Alice Johnson', 
    email: 'alice@company.com', 
    department: 'Engineering', 
    salary: 75000, 
    isAdmin: false 
  },
  2: { 
    id: 2, 
    username: 'bob', 
    password: 'bobiscool',
    name: 'Bob Smith', 
    email: 'bob@company.com', 
    department: 'Sales', 
    salary: 65000, 
    isAdmin: false 
  },
  3: { 
    id: 3, 
    username: 'charlie', 
    password: 'charlie123',
    name: 'Charlie Brown', 
    email: 'charlie@company.com', 
    department: 'HR', 
    salary: 70000, 
    isAdmin: false 
  },
  1000: { 
    id: 1000, 
    username: 'admin', 
    password: ADMIN_PASSWORD,
    name: 'Admin User', 
    email: 'admin@company.com', 
    department: 'IT', 
    salary: 120000, 
    isAdmin: true 
  }
};

const invoices = {
  101: { id: 101, userId: 1, amount: 250.00, description: 'Office supplies', date: '2026-01-15' },
  102: { id: 102, userId: 1, amount: 75.50, description: 'Software license', date: '2026-01-20' },
  103: { id: 103, userId: 2, amount: 500.00, description: 'Marketing materials', date: '2026-01-18' },
  104: { id: 104, userId: 2, amount: 120.00, description: 'Client dinner', date: '2026-01-22' },
  105: { id: 105, userId: 3, amount: 300.00, description: 'Training course', date: '2026-01-25' },
  999: { id: 999, userId: 1000, amount: 1337.00, description: 'FLAG_ACCESS', date: '2026-01-01' }
};

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = Object.values(users).find(u => u.username === username);
  
  if (user && user.password === password) {
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.isAdmin;
    res.json({ success: true, redirect: '/dashboard' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/dashboard', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  const user = users[req.session.userId];
  res.render('dashboard', { user });
});

app.get('/api/invoice/:id', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const invoiceId = parseInt(req.params.id);
  const invoice = invoices[invoiceId];
  
  if (invoice) {
    res.json(invoice);
  } else {
    res.status(404).json({ error: 'Invoice not found' });
  }
});

app.get('/api/user/:id', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const referer = req.headers.referer;
  const match = referer && referer.match(/\/profile\/([a-f0-9]+)/);
  const userId = match ? match[1] : req.session.userId;  
  const user = users[userId];

  if (user) {
    res.json(user);
  }
  else {
    res.status(404).json({ error: 'User not found' });
  }
});

app.get('/api/admin/flag', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admin only' });
  
  res.json({ flag: process.env.FLAG });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.listen(3003, '0.0.0.0', () => {
  console.log('\nChallenge running on http://localhost:3003');
});