class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    let status = 500;
    let message = 'An unexpected server error occurred. Please try again.';
    if (error instanceof ApiError) {
        status = error.status;
        message = error.message;
    } else if (error.type === 'entity.parse.failed') {
        status = 400;
        message = 'The request body must contain valid JSON.';
    } else if (error.type === 'entity.too.large') {
        status = 400;
        message = 'The request body is too large.';
    } else if (error.code === 11000) {
        status = 400;
        message = 'A user with this email already exists.';
    } else if (['ValidationError', 'CastError', 'StrictModeError'].includes(error.name)) {
        status = 400;
        message = 'One or more fields contain an invalid value.';
    } else if (req.method === 'GET' && error.name === 'MongoServerError' &&
        [2, 9, 14, 15974, 16410, 31249, 31250, 51091].includes(error.code)) {
        status = 400;
        message = 'The query contains an invalid filter, sort, or selection.';
    }
    // Do not expose database errors, credentials, or stack traces.
    res.status(status).json({ message, data: null });
}

module.exports = { ApiError, errorHandler };
