const User = require('../models/user');
const { saveUser, deleteUser } = require('../services/resources');

module.exports = require('./resource')(User, saveUser, deleteUser);
