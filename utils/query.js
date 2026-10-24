const { ApiError } = require('./errors');
const { isObject } = require('./validation');

function jsonParameter(query, key, fallback) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string') throw new ApiError(400, `${key} must be supplied once as JSON.`);
    try {
        return JSON.parse(query[key]);
    } catch {
        throw new ApiError(400, `${key} must contain valid JSON.`);
    }
}

function fieldsParameter(query, key, directions) {
    const value = jsonParameter(query, key, {});
    if (!isObject(value) || Object.entries(value).some(([field, direction]) =>
        !field || field.startsWith('$') || !directions.includes(direction))) {
        throw new ApiError(400, `${key} must be an object with valid field directions.`);
    }
    return value;
}

function selection(query) {
    const select = fieldsParameter(query, 'select', [0, 1]);
    const directions = new Set(Object.entries(select).filter(([field]) => field !== '_id').map(([, value]) => value));
    if (directions.size > 1) {
        throw new ApiError(400, 'select cannot mix included and excluded fields, except for _id.');
    }
    return select;
}

function listOptions(query, defaultLimit = 0) {
    const where = jsonParameter(query, 'where', {});
    if (!isObject(where)) throw new ApiError(400, 'where must be a JSON object.');
    const sort = fieldsParameter(query, 'sort', [1, -1]);
    const select = selection(query);
    const skip = jsonParameter(query, 'skip', 0);
    const limit = jsonParameter(query, 'limit', defaultLimit);
    const count = jsonParameter(query, 'count', false);
    for (const [field, value] of Object.entries({ skip, limit })) {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new ApiError(400, `${field} must be a nonnegative integer.`);
        }
    }
    if (typeof count !== 'boolean') throw new ApiError(400, 'count must be true or false.');
    return { where, sort, select, skip, limit, count };
}

module.exports = { selection, listOptions };
