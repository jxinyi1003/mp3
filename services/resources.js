const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { ApiError } = require('../utils/errors');
const { isId, userInput, taskInput } = require('../utils/validation');

async function findResource(Model, id, session) {
    if (!isId(id)) throw new ApiError(404, `${Model.modelName} not found.`);
    const document = await Model.findById(id).session(session || null);
    if (!document) throw new ApiError(404, `${Model.modelName} not found.`);
    return document;
}

// Related writes commit together, or all changes are rolled back.
function transaction(work) {
    return mongoose.connection.transaction(work, {
        readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }
    });
}

async function saveUser(body, id) {
    return transaction(async session => {
        // On PUT, URL resource existence takes priority over body validation.
        const user = id === undefined ? new User() : await findResource(User, id, session);
        const input = userInput(body);
        const duplicate = await User.findOne({ email: input.email, _id: { $ne: user._id } }).session(session);
        if (duplicate) throw new ApiError(400, 'A user with this email already exists.');

        const tasks = await Task.find({ _id: { $in: input.pendingTasks } }).session(session);
        if (tasks.length !== input.pendingTasks.length) {
            throw new ApiError(404, 'One or more tasks in pendingTasks do not exist.');
        }
        if (tasks.some(task => task.completed)) {
            throw new ApiError(400, 'pendingTasks cannot contain completed tasks.');
        }

        const userId = user._id.toString();
        const removed = user.pendingTasks.filter(taskId => !input.pendingTasks.includes(taskId));
        user.set(input);
        await user.save({ session });

        await Task.updateMany({ _id: { $in: removed }, assignedUser: userId }, {
            $set: { assignedUser: '', assignedUserName: 'unassigned' }, $inc: { __v: 1 }
        }, { session });
        // A requested task moves from its former owner to this user.
        await User.updateMany({ _id: { $ne: user._id }, pendingTasks: { $in: input.pendingTasks } }, {
            $pull: { pendingTasks: { $in: input.pendingTasks } }, $inc: { __v: 1 }
        }, { session });
        await Task.updateMany({ _id: { $in: input.pendingTasks } }, {
            $set: { assignedUser: userId, assignedUserName: user.name }, $inc: { __v: 1 }
        }, { session });
        // Renaming a user updates their completed tasks as well.
        await Task.updateMany({ assignedUser: userId, assignedUserName: { $ne: user.name } }, {
            $set: { assignedUserName: user.name }, $inc: { __v: 1 }
        }, { session });
        return user.toObject();
    });
}

async function saveTask(body, id) {
    return transaction(async session => {
        const task = id === undefined ? new Task() : await findResource(Task, id, session);
        const input = taskInput(body);
        let owner = null;
        if (input.assignedUser) {
            owner = await findResource(User, input.assignedUser, session);
            if (input.assignedUserName !== undefined && input.assignedUserName !== owner.name) {
                throw new ApiError(400, 'assignedUserName does not match the assigned user.');
            }
        }
        input.assignedUserName = owner ? owner.name : 'unassigned';
        task.set(input);
        await task.save({ session });

        const taskId = task._id.toString();
        await User.updateMany({ pendingTasks: taskId }, {
            $pull: { pendingTasks: taskId }, $inc: { __v: 1 }
        }, { session });
        if (owner) {
            const update = { $inc: { __v: 1 } };
            if (!task.completed) update.$addToSet = { pendingTasks: taskId };
            // Write even for completed tasks to detect concurrent owner deletion/renaming.
            await User.updateOne({ _id: owner._id }, update, { session });
        }
        return task.toObject();
    });
}

async function deleteUser(id) {
    return transaction(async session => {
        const user = await findResource(User, id, session);
        await Task.updateMany({ assignedUser: user._id.toString() }, {
            $set: { assignedUser: '', assignedUserName: 'unassigned' }, $inc: { __v: 1 }
        }, { session });
        await user.deleteOne({ session });
        return user.toObject();
    });
}

async function deleteTask(id) {
    return transaction(async session => {
        const task = await findResource(Task, id, session);
        await User.updateMany({ pendingTasks: task._id.toString() }, {
            $pull: { pendingTasks: task._id.toString() }, $inc: { __v: 1 }
        }, { session });
        await task.deleteOne({ session });
        return task.toObject();
    });
}

module.exports = { saveUser, saveTask, deleteUser, deleteTask };
