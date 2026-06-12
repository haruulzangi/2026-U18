const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');

const isAdmin = (req, res, next) => {
  if (req.session.isAdmin === true) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden - Admin access required' });
  }
};

router.get('/users', isAuthenticated, isAdmin, (req, res) => {
  const users = global.users.map(({ password, ...user }) => user);
  res.json(users);
});

router.get('/flag', isAuthenticated, isAdmin, (req, res) => {
  const flag = process.env.FLAG || 'HZU18{m4ss_4ss1gnm3nt_1s_d4ng3r0us}';
  res.json({ flag: flag });
});

module.exports = router;