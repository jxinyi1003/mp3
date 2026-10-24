const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
require('dotenv').config({ quiet: true });
const app = require('../app');
const User = require('../models/user');
const Task = require('../models/task');

// Never use or clear the application's database. Each run owns a new test database.
const databaseName = `mp3_test_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const deadline = '2026-11-03T12:00:00.000Z';
let server;
let base;
let connected = false;

async function request(method, path, body, expected = 200) {
    const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    assert.equal(typeof result.message, 'string');
    assert.ok(Object.hasOwn(result, 'data'));
    return result.data;
}

const createUser = (name = 'Alice', extra = {}) => request('POST', '/users', {
    name, email: `${name.toLowerCase()}@example.com`, ...extra
}, 201);
const createTask = (extra = {}) => request('POST', '/tasks', { name: 'Homework', deadline, ...extra }, 201);
const query = options => new URLSearchParams(Object.entries(options).map(([key, value]) => [key, JSON.stringify(value)])).toString();
const getUser = id => request('GET', `/users/${id}`);
const getTask = id => request('GET', `/tasks/${id}`);

describe('API integration with a disposable Atlas database', { timeout: 180000 }, () => {
    before(async () => {
        const uri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI;
        assert.ok(uri, 'Set MONGODB_URI in .env or supply TEST_MONGODB_URI.');
        try {
            await mongoose.connect(uri, { dbName: databaseName, serverSelectionTimeoutMS: 10000 });
        } catch (error) {
            throw new Error(`Test database connection failed (${error.name}, ${error.code || 'no code'}).`);
        }
        connected = true;
        await Promise.all([User.init(), Task.init()]);
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        base = `http://127.0.0.1:${server.address().port}/api`;
    });

    beforeEach(async () => {
        await Promise.all([User.deleteMany({}), Task.deleteMany({})]);
    });

    after(async () => {
        try {
            if (connected && mongoose.connection.name === databaseName) {
                await mongoose.connection.dropDatabase();
            }
        } finally {
            await mongoose.disconnect();
            if (server) await new Promise(resolve => server.close(resolve));
        }
    });

    it('creates resources with server-controlled dates and defaults', async () => {
        const fakeDate = '2000-01-01T00:00:00.000Z';
        const user = await createUser('Alice', { dateCreated: fakeDate });
        assert.deepEqual(user.pendingTasks, []);
        assert.notEqual(user.dateCreated, fakeDate);
        const task = await createTask({ dateCreated: fakeDate });
        assert.equal(task.description, '');
        assert.equal(task.completed, false);
        assert.equal(task.assignedUser, '');
        assert.equal(task.assignedUserName, 'unassigned');
        assert.notEqual(task.dateCreated, fakeDate);
    });

    it('rejects missing fields, wrong types, duplicate email and invalid references', async () => {
        const user = await createUser();
        await request('POST', '/users', { name: 'Other', email: user.email }, 400);
        await request('POST', '/users', { name: 'Missing email' }, 400);
        await request('POST', '/users', { name: 4, email: 'test@example.com' }, 400);
        await request('POST', '/users', { name: 'Bob', email: 'bob@example.com', pendingTasks: ['invalid'] }, 400);
        await request('POST', '/users', { name: 'Bob', email: 'bob@example.com', pendingTasks: [new mongoose.Types.ObjectId().toString()] }, 404);
        await request('POST', '/tasks', { name: 'No deadline' }, 400);
        await request('POST', '/tasks', { name: 'Bad deadline', deadline: null }, 400);
        await request('POST', '/tasks', { name: 'Wrong type', deadline, completed: 'false' }, 400);
        await request('POST', '/tasks', { name: 'Bad ID', deadline, assignedUser: 'bad' }, 400);
        await request('POST', '/tasks', { name: 'Unknown user', deadline, assignedUser: new mongoose.Types.ObjectId().toString() }, 404);
        await request('POST', '/tasks', { name: 'Wrong owner', deadline, assignedUser: user._id, assignedUserName: 'Wrong' }, 400);
        assert.equal(await User.countDocuments(), 1);
        assert.equal(await Task.countDocuments(), 0);
    });

    it('maintains references when tasks complete, reopen, move, and reset through PUT', async () => {
        const alice = await createUser();
        const bob = await createUser('Bob');
        const task = await createTask({ assignedUser: alice._id, description: 'Original' });
        assert.deepEqual((await getUser(alice._id)).pendingTasks, [task._id]);
        assert.equal(task.assignedUserName, 'Alice');

        let updated = await request('PUT', `/tasks/${task._id}`, {
            name: 'Done', deadline, completed: true, assignedUser: alice._id
        });
        assert.equal(updated.assignedUser, alice._id);
        assert.deepEqual((await getUser(alice._id)).pendingTasks, []);
        updated = await request('PUT', `/tasks/${task._id}`, {
            name: 'Moved completed task', deadline, completed: true, assignedUser: bob._id
        });
        assert.equal(updated.assignedUserName, 'Bob');
        assert.deepEqual((await getUser(bob._id)).pendingTasks, []);
        await request('PUT', `/tasks/${task._id}`, { name: 'Reopened', deadline, assignedUser: bob._id });
        assert.deepEqual((await getUser(bob._id)).pendingTasks, [task._id]);

        updated = await request('PUT', `/tasks/${task._id}`, {
            name: 'Reset', deadline, dateCreated: '2000-01-01'
        });
        assert.equal(updated.dateCreated, task.dateCreated);
        assert.equal(updated.assignedUser, '');
        assert.equal(updated.assignedUserName, 'unassigned');
        assert.equal(updated.description, '');
        assert.equal(updated.completed, false);
        assert.deepEqual((await getUser(bob._id)).pendingTasks, []);
    });

    it('replaces pendingTasks, transfers tasks and renames completed assignments', async () => {
        const alice = await createUser();
        const bob = await createUser('Bob');
        const oldTask = await createTask({ assignedUser: alice._id });
        const movedTask = await createTask({ assignedUser: bob._id });
        const doneTask = await createTask({ assignedUser: alice._id, completed: true });
        const updated = await request('PUT', `/users/${alice._id}`, {
            name: 'Alicia', email: alice.email, pendingTasks: [movedTask._id], dateCreated: '2000-01-01'
        });
        assert.equal(updated.dateCreated, alice.dateCreated);
        assert.deepEqual(updated.pendingTasks, [movedTask._id]);
        assert.equal((await getTask(oldTask._id)).assignedUser, '');
        assert.equal((await getTask(movedTask._id)).assignedUserName, 'Alicia');
        assert.equal((await getTask(doneTask._id)).assignedUserName, 'Alicia');
        assert.deepEqual((await getUser(bob._id)).pendingTasks, []);

        await request('PUT', `/users/${alice._id}`, { name: 'Alice again', email: alice.email });
        assert.deepEqual((await getUser(alice._id)).pendingTasks, []);
        assert.equal((await getTask(movedTask._id)).assignedUser, '');
        assert.equal((await getTask(doneTask._id)).assignedUser, alice._id);
        assert.equal((await getTask(doneTask._id)).assignedUserName, 'Alice again');
    });

    it('POST users can claim existing tasks but reject completed tasks without partial changes', async () => {
        const alice = await createUser();
        const task = await createTask({ assignedUser: alice._id });
        const bob = await createUser('Bob', { pendingTasks: [task._id] });
        assert.equal((await getTask(task._id)).assignedUser, bob._id);
        assert.deepEqual((await getUser(alice._id)).pendingTasks, []);
        const done = await createTask({ completed: true });
        await request('POST', '/users', {
            name: 'Carol', email: 'carol@example.com', pendingTasks: [task._id, done._id]
        }, 400);
        assert.equal(await User.countDocuments(), 2);
        assert.equal((await getTask(task._id)).assignedUser, bob._id);
    });

    it('failed PUT requests leave the resource and both sides of assignments unchanged', async () => {
        const alice = await createUser();
        const bob = await createUser('Bob');
        const task = await createTask({ assignedUser: alice._id });
        await request('PUT', `/users/${alice._id}`, { name: 'Bad change', email: bob.email }, 400);
        await request('PUT', `/users/${alice._id}`, { name: 'Bad change', email: alice.email,
            pendingTasks: [new mongoose.Types.ObjectId().toString()] }, 404);
        await request('PUT', `/tasks/${task._id}`, { name: 'Bad change', deadline,
            assignedUser: bob._id, assignedUserName: 'Alice' }, 400);
        assert.equal((await getUser(alice._id)).name, 'Alice');
        assert.deepEqual((await getUser(alice._id)).pendingTasks, [task._id]);
        assert.equal((await getTask(task._id)).assignedUser, alice._id);
        assert.deepEqual((await getUser(bob._id)).pendingTasks, []);
    });

    it('rolls back already-written documents on an unexpected database operation failure', async t => {
        const alice = await createUser();
        const task = await createTask({ assignedUser: alice._id });
        const forcedFailure = t.mock.method(Task, 'updateMany', () => {
            throw new Error('Simulated private database failure');
        });
        await request('PUT', `/users/${alice._id}`, { name: 'Must roll back', email: alice.email }, 500);
        forcedFailure.mock.restore();
        assert.equal((await getUser(alice._id)).name, 'Alice');
        assert.deepEqual((await getUser(alice._id)).pendingTasks, [task._id]);
        assert.equal((await getTask(task._id)).assignedUserName, 'Alice');
    });

    it('deletes tasks and unassigns all of a deleted user’s tasks including completed ones', async () => {
        const alice = await createUser();
        const removed = await createTask({ assignedUser: alice._id });
        await request('DELETE', `/tasks/${removed._id}`);
        await request('GET', `/tasks/${removed._id}`, undefined, 404);
        assert.deepEqual((await getUser(alice._id)).pendingTasks, []);
        const pending = await createTask({ assignedUser: alice._id });
        const done = await createTask({ assignedUser: alice._id, completed: true });
        await request('DELETE', `/users/${alice._id}`);
        await request('GET', `/users/${alice._id}`, undefined, 404);
        for (const task of [pending, done]) {
            const updated = await getTask(task._id);
            assert.equal(updated.assignedUser, '');
            assert.equal(updated.assignedUserName, 'unassigned');
        }
    });

    it('supports single-resource projection, ignores other parameters, and prioritizes URL IDs', async () => {
        const alice = await createUser();
        const task = await createTask();
        for (const [path, resource] of [['users', alice], ['tasks', task]]) {
            const selected = await request('GET', `/${path}/${resource._id}?select=${encodeURIComponent('{"name":1,"_id":0}')}&where=not-json&skip=bad&count=bad`);
            assert.deepEqual(selected, { name: resource.name });
            for (const id of ['bad-id', new mongoose.Types.ObjectId().toString()]) {
                await request('GET', `/${path}/${id}`, undefined, 404);
                await request('PUT', `/${path}/${id}`, {}, 404);
                await request('DELETE', `/${path}/${id}`, undefined, 404);
            }
        }
    });

    it('combines where/sort/select/skip/limit and counts all matches with collection defaults', async () => {
        await Task.insertMany(Array.from({ length: 105 }, (_, i) => ({
            name: `Task ${String(i).padStart(3, '0')}`, deadline, completed: i % 2 === 0
        })));
        assert.equal((await request('GET', '/tasks')).length, 100);
        assert.equal((await request('GET', '/tasks?limit=0')).length, 105);
        const selected = await request('GET', `/tasks?${query({ where: { completed: true },
            sort: { name: -1 }, select: { name: 1, _id: 0 }, skip: 1, limit: 2 })}`);
        assert.deepEqual(selected, [{ name: 'Task 102' }, { name: 'Task 100' }]);
        assert.equal(await request('GET', `/tasks?${query({ where: { completed: true }, count: true, skip: 5, limit: 1 })}`), 53);
        assert.deepEqual(await request('GET', `/tasks?${query({ where: { name: 'Missing' } })}`), []);
        assert.equal(await request('GET', `/tasks?${query({ where: { name: 'Missing' }, count: true })}`), 0);
        const sample = await Task.findOne();
        assert.equal((await request('GET', `/tasks?${query({ where: { _id: { $in: [sample.id] } } })}`)).length, 1);

        await User.insertMany(Array.from({ length: 105 }, (_, i) => ({ name: `User ${i}`, email: `u${i}@example.com` })));
        assert.equal((await request('GET', '/users')).length, 105);
        assert.equal(await request('GET', '/users?count=true'), 105);
        assert.deepEqual(await request('GET', `/users?${query({ where: { name: 'Missing' } })}`), []);
    });

    it('responds with JSON for malformed queries, malformed bodies and unknown endpoints', async () => {
        for (const resource of ['users', 'tasks']) {
            for (const params of ['where=%7B', 'sort=not-json', 'select=null', 'skip=-1',
                'limit=1.5', 'count=1', 'skip=0&skip=1', 'select=%7B%22name%22%3A1%2C%22deadline%22%3A0%7D']) {
                await request('GET', `/${resource}?${params}`, undefined, 400);
            }
        }
        const malformed = await fetch(`${base}/users`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
        });
        assert.equal(malformed.status, 400);
        assert.equal((await malformed.json()).data, null);
        await request('GET', '/unknown', undefined, 404);
        const options = await fetch(`${base}/users`, { method: 'OPTIONS' });
        assert.equal(options.status, 204);
        assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*');
    });

    it('keeps two-way references consistent when assignments happen concurrently', async () => {
        const alice = await createUser();
        const bob = await createUser('Bob');
        const task = await createTask();
        await Promise.all([alice, bob].map(user => request('PUT', `/tasks/${task._id}`, {
            name: 'Concurrent assignment', deadline, assignedUser: user._id
        })));
        const finalTask = await getTask(task._id);
        for (const user of [alice, bob]) {
            const updated = await getUser(user._id);
            assert.deepEqual(updated.pendingTasks, finalTask.assignedUser === user._id ? [task._id] : []);
        }
    });
});
