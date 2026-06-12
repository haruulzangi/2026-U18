const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: String,
  department: String,
  role: { type: String, default: 'user' },
  isAdmin: { type: Boolean, default: false },
  preferences: {
    theme: { type: String, default: 'light' },
    notifications: { type: Boolean, default: true }
  },
  profileViews: { type: Number, default: 0 },
  lastLogin: Date,
  apiKey: String,
  twoFactorEnabled: { type: Boolean, default: false }
});

let User;
try {
  User = mongoose.model('User');
} catch (error) {
  User = mongoose.model('User', userSchema);
}

module.exports = User;