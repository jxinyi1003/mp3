const Task = require('../models/task');
const { saveTask, deleteTask } = require('../services/resources');

module.exports = require('./resource')(Task, saveTask, deleteTask, 100);
