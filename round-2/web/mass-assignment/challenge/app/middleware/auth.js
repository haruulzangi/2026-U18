const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

const isAdmin = async (req, res, next) => {
  const User = require('../models/User');
  const user = await User.findById(req.session.userId);
  if (user && user.isAdmin) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden' });
  }
};

module.exports = { isAuthenticated, isAdmin };