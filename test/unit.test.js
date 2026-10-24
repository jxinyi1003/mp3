const { test } = require('node:test');
const assert = require('node:assert/strict');
const { userInput, taskInput } = require('../utils/validation');
const { listOptions, selection } = require('../utils/query');

function badRequest(work) {
    assert.throws(work, error => error.status === 400);
}

test('user input rejects incorrect types and normalizes duplicate task IDs', () => {
    const valid = { name: 'Alice', email: 'alice@example.com' };
    for (const body of [null, [], {}, { ...valid, name: 123 }, { ...valid, email: '' },
        { ...valid, pendingTasks: 'bad' }, { ...valid, pendingTasks: [123] }]) {
        badRequest(() => userInput(body));
    }
    const id = 'abcdefabcdefabcdefabcdef';
    assert.deepEqual(userInput({ ...valid, pendingTasks: [id, id.toUpperCase()] }).pendingTasks, [id]);
    assert.deepEqual(userInput(valid).pendingTasks, []);
});

test('task input applies replacement defaults and rejects silently castable values', () => {
    const valid = { name: 'Homework', deadline: '2026-11-03T12:00:00Z' };
    for (const patch of [{ name: false }, { deadline: null }, { deadline: true }, { deadline: [] },
        { deadline: '' }, { deadline: 'not-a-date' }, { completed: 'false' },
        { description: 42 }, { assignedUser: null }, { assignedUser: 'bad' }, { assignedUserName: 4 }]) {
        badRequest(() => taskInput({ ...valid, ...patch }));
    }
    const input = taskInput(valid);
    assert.equal(input.completed, false);
    assert.equal(input.description, '');
    assert.equal(input.assignedUser, '');
    assert.ok(input.deadline instanceof Date);
});

test('collection options support combinations and resource-specific default limits', () => {
    const options = listOptions({ where: '{"completed":false}', sort: '{"deadline":-1}',
        select: '{"name":1,"_id":0}', skip: '2', limit: '3', count: 'false' }, 100);
    assert.deepEqual(options, { where: { completed: false }, sort: { deadline: -1 },
        select: { name: 1, _id: 0 }, skip: 2, limit: 3, count: false });
    assert.equal(listOptions({}, 100).limit, 100);
    assert.equal(listOptions({}).limit, 0);
});

test('malformed JSON, invalid directions, duplicate parameters and invalid pagination return 400', () => {
    for (const query of [{ where: '{' }, { where: 'null' }, { where: '[]' },
        { sort: '{"name":0}' }, { select: '{"name":2}' }, { select: '{"name":1,"email":0}' },
        { skip: '-1' }, { skip: '1.5' }, { limit: '"2"' }, { limit: '1e100' },
        { count: '1' }, { count: '"true"' }, { count: 'TRUE' }, { skip: ['1', '2'] }]) {
        badRequest(() => listOptions(query));
    }
    assert.deepEqual(selection({ select: '{"name":1,"_id":0}', where: 'not-json' }), { name: 1, _id: 0 });
});
