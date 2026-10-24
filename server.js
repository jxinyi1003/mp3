require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const app = require('./app');
const User = require('./models/user');
const Task = require('./models/task');

async function start() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    // Prepare collections and the unique email index before accepting requests.
    await Promise.all([User.init(), Task.init()]);
    const port = process.env.PORT || 3000;
    const server = app.listen(port, () => console.log(`Server running on port ${port}`));
    server.on('error', async () => {
        console.error('Unable to start the HTTP server. Check the configured port.');
        await mongoose.disconnect();
        process.exitCode = 1;
    });
    return server;
}

if (require.main === module) {
    start().catch(async () => {
        console.error('Startup failed. Check MONGODB_URI, database access, and network settings.');
        await mongoose.disconnect();
        process.exitCode = 1;
    });
}

module.exports = { start };
