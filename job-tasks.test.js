'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJobTaskMessage } = require('./job-tasks');

test('parseJobTaskMessage parses candidate, company, designation, deadline', () => {
  const text = `Candidate Name: Shakil Talukder
Company Name: Brain Station 23
Designation: Junior React Developer
Task Deadline: 18 September 2026`;

  const parsed = parseJobTaskMessage(text);
  assert.equal(parsed.candidate, 'Shakil Talukder');
  assert.equal(parsed.company, 'Brain Station 23');
  assert.equal(parsed.designation, 'Junior React Developer');
  assert.equal(parsed.deadline, '18 September 2026');
});

test('parseJobTaskMessage handles flexible casing and labels', () => {
  const text = `name: Jane Doe
company: Acme Corp
role: Frontend Engineer
deadline: Tomorrow 5pm`;

  const parsed = parseJobTaskMessage(text);
  assert.equal(parsed.candidate, 'Jane Doe');
  assert.equal(parsed.company, 'Acme Corp');
  assert.equal(parsed.designation, 'Frontend Engineer');
  assert.equal(parsed.deadline, 'Tomorrow 5pm');
});

test('parseJobTaskMessage returns null for casual chat', () => {
  assert.equal(parseJobTaskMessage('Hello everyone, how are you?'), null);
});
