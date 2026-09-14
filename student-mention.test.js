'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractStudentsFromMessage } = require('./student-mention');

const sampleRoster = [
  { discordId: '101', name: 'Md Tanvir Rahman', displayName: 'Tanvir', email: 'tanvir@example.com' },
  { discordId: '102', name: 'Islamul Hoque', displayName: 'Islamul', email: 'islamul@example.com' },
  { discordId: '103', name: 'Shipan Ahmed', displayName: 'Shipan', email: 'shipan@example.com' },
];
const supervisorIds = ['999'];

test('extracts student by Discord user mention', () => {
  const msg = {
    content: '<@101> has been hired!',
    mentions: {
      users: new Map([['101', { id: '101', bot: false, username: 'tanvir' }]]),
      everyone: false,
    },
  };
  const result = extractStudentsFromMessage(msg, sampleRoster, supervisorIds);
  assert.equal(result.students.length, 1);
  assert.equal(result.students[0].discordId, '101');
  assert.equal(result.isAnnouncement, false);
});

test('extracts student by plain text name match when no mention', () => {
  const msg = {
    content: 'Congratulations to Md Tanvir Rahman for getting placed at Zorvyn!',
    mentions: {
      users: new Map(),
      everyone: false,
    },
  };
  const result = extractStudentsFromMessage(msg, sampleRoster, supervisorIds);
  assert.equal(result.students.length, 1);
  assert.equal(result.students[0].discordId, '101');
});

test('handles @everyone announcement alongside student mention', () => {
  const msg = {
    content: '@everyone Congratulations to <@102> on landing the role!',
    mentions: {
      users: new Map([['102', { id: '102', bot: false, username: 'islamul' }]]),
      everyone: true,
    },
  };
  const result = extractStudentsFromMessage(msg, sampleRoster, supervisorIds);
  assert.equal(result.students.length, 1);
  assert.equal(result.students[0].discordId, '102');
  assert.equal(result.isAnnouncement, true);
});

test('handles @everyone announcement alongside plain text name', () => {
  const msg = {
    content: '@everyone We are proud to announce Shipan Ahmed has been hired!',
    mentions: {
      users: new Map(),
      everyone: true,
    },
  };
  const result = extractStudentsFromMessage(msg, sampleRoster, supervisorIds);
  assert.equal(result.students.length, 1);
  assert.equal(result.students[0].discordId, '103');
  assert.equal(result.isAnnouncement, true);
});

test('handles pure @everyone announcement safely without finding students', () => {
  const msg = {
    content: '@everyone Please remember to submit your task updates on time.',
    mentions: {
      users: new Map(),
      everyone: true,
    },
  };
  const result = extractStudentsFromMessage(msg, sampleRoster, supervisorIds);
  assert.equal(result.students.length, 0);
  assert.equal(result.isAnnouncement, true);
});

test('ignores bots and supervisor mentions', () => {
  const msg = {
    content: '<@999> and <@888> look at this',
    mentions: {
      users: new Map([
        ['999', { id: '999', bot: false, username: 'supervisor' }],
        ['888', { id: '888', bot: true, username: 'bot' }],
      ]),
      everyone: false,
    },
  };
  const result = extractStudentsFromMessage(msg, sampleRoster, supervisorIds);
  assert.equal(result.students.length, 0);
});

test('tracks unknown mentions when mentioned user is not in roster', () => {
  const msg = {
    content: 'Check <@777>',
    mentions: {
      users: new Map([
        ['777', { id: '777', bot: false, username: 'stranger' }],
      ]),
      everyone: false,
    },
  };
  const result = extractStudentsFromMessage(msg, sampleRoster, supervisorIds);
  assert.equal(result.students.length, 0);
  assert.deepEqual(result.unknownUsers, ['stranger']);
});
