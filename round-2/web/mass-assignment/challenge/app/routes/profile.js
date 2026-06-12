const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');

router.post('/update', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId;
    const updateData = req.body;
    
    console.log('Updating user:', userId);
    console.log('Update data:', updateData);
    
    const userIndex = global.users.findIndex(u => u._id === userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    global.users[userIndex] = { ...global.users[userIndex], ...updateData };
    
    if (updateData.isAdmin !== undefined) {
      req.session.isAdmin = updateData.isAdmin;
      console.log('Admin status changed to:', updateData.isAdmin);
    }
    
    const { password, ...userWithoutPassword } = global.users[userIndex];
    res.json({ success: true, user: userWithoutPassword });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/me', isAuthenticated, (req, res) => {
  const user = global.users.find(u => u._id === req.session.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  const { password, ...userWithoutPassword } = user;
  res.json(userWithoutPassword);
});

module.exports = router;