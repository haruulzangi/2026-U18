const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const SALT_ROUNDS = 12;

// --- In-Memory User Store ---
const users = new Map(); // email -> { id, email, fullname, password }
let nextId = 1;

// --- Nunjucks Setup ---
nunjucks.configure('views', {
  autoescape: true,
  express: app,
  noCache: true
});

// --- Middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    }
  }
}));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 1800000
  }
}));

const authLimiter = (req, res, next) => next();

// --- Auth Middleware ---
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/signin');
  }
  next();
}

function findUserById(id) {
  for (const user of users.values()) {
    if (user.id === id) return user;
  }
  return null;
}

// --- Routes ---

app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/home' : '/signin');
});

// Signup
app.get('/signup', (req, res) => {
  res.render('signup.html', { error: null });
});

app.post('/signup', authLimiter, async (req, res) => {
  const { email, firstname, lastname, password, confirm_password } = req.body;

  if (!email || !firstname || !lastname || !password || !confirm_password) {
    return res.render('signup.html', { error: 'All fields are required.' });
  }

  if (firstname.length > 300 || lastname.length > 300) {
    return res.render('signup.html', { error: 'Name is too long.' });
  }

  const fullname = firstname + ' ' + lastname;

  // Secure email validation
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email) || email.length > 254) {
    return res.render('signup.html', { error: 'Invalid email address.' });
  }

  // Secure password validation
  if (password.length < 8 || password.length > 72) {
    return res.render('signup.html', { error: 'Password must be 8-72 characters.' });
  }
  if (password !== confirm_password) {
    return res.render('signup.html', { error: 'Passwords do not match.' });
  }

  try {
    if (users.has(email)) {
      return res.render('signup.html', { error: 'Email already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const id = nextId++;
    users.set(email, { id, email, fullname, password: hashedPassword });

    req.session.userId = id;
    res.redirect('/home');
  } catch (err) {
    console.error(err);
    res.render('signup.html', { error: 'Something went wrong.' });
  }
});

// Signin
app.get('/signin', (req, res) => {
  res.render('signin.html', { error: null });
});

app.post('/signin', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('signin.html', { error: 'All fields are required.' });
  }

  try {
    const user = users.get(email);
    if (!user) {
      return res.render('signin.html', { error: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('signin.html', { error: 'Invalid email or password.' });
    }

    req.session.userId = user.id;
    res.redirect('/home');
  } catch (err) {
    console.error(err);
    res.render('signin.html', { error: 'Something went wrong.' });
  }
});

app.get('/home', requireAuth, (req, res) => {
  const user = findUserById(req.session.userId);
  if (!user) {
    req.session.destroy();
    return res.redirect('/signin');
  }

  res.render('home.html', { user: user });
});

// Profile - SSTI vulnerability here
app.get('/profile', requireAuth, (req, res) => {
  const user = findUserById(req.session.userId);
  if (!user) {
    req.session.destroy();
    return res.redirect('/signin');
  }

  res.render('profile.html', { user: user, error: null, success: null });
});

app.post('/profile', requireAuth, async (req, res) => {
  const user = findUserById(req.session.userId);
  if (!user) {
    req.session.destroy();
    return res.redirect('/signin');
  }

  const { fullname } = req.body;

  if (!fullname) {
    return res.render('profile.html', { user: user, error: 'Name is required.', success: null });
  }

  if (fullname.length > 300) {
    return res.render('profile.html', { user: user, error: 'Name is too long.', success: null });
  }

  // Update user's fullname
  user.fullname = fullname;

  // SSTI vulnerability - render user input without escaping
  const greetingTemplate = `Hello ${fullname}!`;
  const greeting = nunjucks.renderString(greetingTemplate, {});

  res.render('profile.html', { user: user, error: null, success: 'Profile updated!', greeting: greeting });
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/signin');
});

// --- Start ---
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CTF Challenge running on http://localhost:${PORT}`);
  });
}

module.exports = { app, users };
