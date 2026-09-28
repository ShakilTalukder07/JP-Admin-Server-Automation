const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAPSULE_PREFIX,
  canStartInstallerSetup,
  ownerFirstSupervisorIds,
  parseSetupCapsule,
  signSetupPayload,
} = require('./self-hosted-setup');

const secret = 's'.repeat(64);
const payload = {
  version: 1,
  name: 'Mentor Cohort',
  guildId: '123456789012345678',
  supervisorIds: ['111111111111111111'],
  timezone: 'Asia/Dhaka',
  channels: { supervisor: '222222222222222222' },
};

test('self-hosted setup capsule round-trips non-secret Discord settings', () => {
  const capsule = signSetupPayload(payload, secret);
  assert.match(capsule, new RegExp(`^${CAPSULE_PREFIX}`));
  assert.doesNotMatch(capsule, new RegExp(secret));
  assert.deepEqual(parseSetupCapsule(capsule, secret), payload);
});

test('self-hosted setup capsule rejects tampering and wrong secrets', () => {
  const capsule = signSetupPayload(payload, secret);
  assert.throws(() => parseSetupCapsule(`${capsule}x`, secret), /signature is invalid/);
  assert.throws(() => parseSetupCapsule(capsule, 'w'.repeat(64)), /signature is invalid/);
});

test('self-hosted setup capsule rejects invalid identity data even when correctly signed', () => {
  const invalid = { ...payload, supervisorIds: [] };
  assert.throws(() => parseSetupCapsule(signSetupPayload(invalid, secret), secret), /invalid supervisor IDs/);
});

test('self-hosted setup keeps the server owner as the first recovery supervisor', () => {
  assert.deepEqual(
    ownerFirstSupervisorIds('111111111111111111', ['222222222222222222'], '333333333333333333'),
    ['111111111111111111', '222222222222222222', '333333333333333333'],
  );
  assert.deepEqual(
    ownerFirstSupervisorIds('111111111111111111', ['111111111111111111'], '111111111111111111'),
    ['111111111111111111'],
  );
});

test('server owner can recover setup without a cached member permission object', () => {
  assert.equal(canStartInstallerSetup({ ownerId: '111111111111111111' }, null, '111111111111111111'), true);
  assert.equal(canStartInstallerSetup({ ownerId: '111111111111111111' }, null, '222222222222222222'), false);
  assert.equal(canStartInstallerSetup(
    { ownerId: '111111111111111111' },
    { permissions: String(1n << 3n) },
    '222222222222222222',
  ), true);
});

test('cohortFromPayload creates distinct registry keys for different cohorts', () => {
  const { cohortFromPayload } = require('./self-hosted-setup');
  const origKey = process.env.COHORT_API_KEY;
  const origUrl = process.env.COHORT_API_URL;
  process.env.COHORT_API_KEY = 'k'.repeat(32);
  process.env.COHORT_API_URL = 'https://script.google.com/macros/s/test/exec';
  try {
    const c1 = cohortFromPayload({ name: 'Team Maestros', guildId: '111111111111111111', supervisorIds: ['101111111111111111'] });
    const c2 = cohortFromPayload({ name: 'Team Thor', guildId: '222222222222222222', supervisorIds: ['102222222222222222'] });
    assert.equal(c1.registryKey, 'cohort_111111111111111111');
    assert.equal(c2.registryKey, 'cohort_222222222222222222');
    assert.equal(c1.name, 'Team Maestros');
    assert.equal(c2.name, 'Team Thor');
  } finally {
    process.env.COHORT_API_KEY = origKey;
    process.env.COHORT_API_URL = origUrl;
  }
});

test('restoreSelfHostedCohort restores multiple servers when multiple capsules exist', async () => {
  const { restoreSelfHostedCohort, signSetupPayload } = require('./self-hosted-setup');
  const origKey = process.env.COHORT_API_KEY;
  const origUrl = process.env.COHORT_API_URL;
  const testSecret = 'k'.repeat(32);
  process.env.COHORT_API_KEY = testSecret;
  process.env.COHORT_API_URL = 'https://script.google.com/macros/s/test/exec';

  try {
    const p1 = { version: 1, name: 'Team Maestros', guildId: '111111111111111111', supervisorIds: ['101111111111111111'], channels: { supervisor: '201111111111111111' } };
    const p2 = { version: 1, name: 'Team Thor', guildId: '222222222222222222', supervisorIds: ['102222222222222222'], channels: { supervisor: '202222222222222222' } };

    function mockGuild(id, name, ownerId, channelId, payloadObj) {
      const capsule = signSetupPayload(payloadObj, testSecret);
      const channel = {
        id: channelId,
        name: 'bot-admin',
        type: 0,
        messages: {
          fetchPins: async () => ({
            items: [{ message: { author: { id: '999' }, content: capsule } }],
          }),
        },
        permissionOverwrites: { edit: async () => {} },
      };
      return {
        id,
        name,
        ownerId,
        roles: { everyone: { id: '000000000000000000' } },
        channels: {
          fetch: async () => new Map([[channelId, channel]]),
        },
      };
    }

    const mockClient = {
      user: { id: '999' },
      guilds: {
        cache: new Map([
          ['111111111111111111', mockGuild('111111111111111111', 'Team Maestros', '101111111111111111', '201111111111111111', p1)],
          ['222222222222222222', mockGuild('222222222222222222', 'Team Thor', '102222222222222222', '202222222222222222', p2)],
        ]),
      },
      channels: {
        fetch: async (id) => ({
          isTextBased: () => true,
          messages: {
            fetchPins: async () => ({ items: [] }),
          },
          send: async () => ({ pin: async () => {} }),
        }),
      },
    };

    const restored = await restoreSelfHostedCohort(mockClient);
    assert.ok(Array.isArray(restored));
    assert.equal(restored.length, 2);
    assert.equal(restored[0].name, 'Team Maestros');
    assert.equal(restored[1].name, 'Team Thor');
  } finally {
    process.env.COHORT_API_KEY = origKey;
    process.env.COHORT_API_URL = origUrl;
  }
});

