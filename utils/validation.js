const { ApiError } = require('./errors');

const isId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function bodyObject(body) {
    if (!isObject(body)) throw new ApiError(400, 'The request body must be an object.');
}

function requiredString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ApiError(400, `${field} must be a nonempty string.`);
    }
    return value.trim();
}

function userInput(body) {
    bodyObject(body);
    const name = requiredString(body.name, 'name');
    const email = requiredString(body.email, 'email');
    const pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(pendingTasks) || !pendingTasks.every(isId)) {
        throw new ApiError(400, 'pendingTasks must be an array of valid task IDs.');
    }
    return { name, email, pendingTasks: [...new Set(pendingTasks.map(id => id.toLowerCase()))] };
}

function taskInput(body) {
    bodyObject(body);
    const name = requiredString(body.name, 'name');
    if (!['string', 'number'].includes(typeof body.deadline) ||
        (typeof body.deadline === 'string' && body.deadline.trim() === '') ||
        !Number.isFinite(new Date(body.deadline).getTime())) {
        throw new ApiError(400, 'deadline must be a valid date.');
    }
    const description = body.description === undefined ? '' : body.description;
    const completed = body.completed === undefined ? false : body.completed;
    const assignedUser = body.assignedUser === undefined ? '' : body.assignedUser;
    if (typeof description !== 'string') throw new ApiError(400, 'description must be a string.');
    if (typeof completed !== 'boolean') throw new ApiError(400, 'completed must be a boolean.');
    if (assignedUser !== '' && !isId(assignedUser)) {
        throw new ApiError(400, 'assignedUser must be empty or a valid user ID.');
    }
    if (body.assignedUserName !== undefined && typeof body.assignedUserName !== 'string') {
        throw new ApiError(400, 'assignedUserName must be a string.');
    }
    return {
        name, description, deadline: new Date(body.deadline), completed,
        assignedUser: assignedUser.toLowerCase(), assignedUserName: body.assignedUserName
    };
}

module.exports = { isId, isObject, userInput, taskInput };
