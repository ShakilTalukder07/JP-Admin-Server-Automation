const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  encodeAdminProfileCustomId,
  encodeSurveyCustomId,
  hasLegacyVerificationButton,
  hasCompletePrivateProfile,
  normalizeMissingFields,
  parseAdminProfileCustomId,
  parseEditProfileTargetId,
  parseSurveyCustomId,
  selectAttentionProfiles,
  isEligibleSurveyMember,
  hasExcludedRole,
  postChannelSurvey,
} = require('./student-data-survey');

test('portal-admitted members with complete private data do not receive a duplicate survey', () => {
  assert.equal(hasCompletePrivateProfile({
    name: 'Student', email: 'student@example.com', phone: '01700000000',
    region: 'Dhaka', subregion: 'Mirpur',
  }), true);
  assert.equal(hasCompletePrivateProfile({
    name: 'Student', email: 'student@example.com', phone: '',
    region: 'Dhaka', subregion: 'Mirpur',
  }), false);
  assert.equal(hasCompletePrivateProfile({
    name: 'Student', email: 'discord.785818245977735169@pending.jp-admin.invalid',
    phone: '01700000000', region: 'Dhaka', subregion: 'Mirpur',
  }), false);
});

test('private survey fields are allow-listed and kept in stable modal order', () => {
  assert.deepEqual(
    normalizeMissingFields(['phone', 'unknown', 'email', 'phone']),
    ['email', 'phone'],
  );
});

test('private survey custom IDs preserve guild and requested fields', () => {
  const id = encodeSurveyCustomId(
    'jp_profile_start:',
    '1527624228830969967',
    ['subregion', 'name', 'phone'],
  );
  assert.deepEqual(parseSurveyCustomId(id, 'jp_profile_start:'), {
    guildId: '1527624228830969967',
    fields: ['name', 'phone', 'subregion'],
  });
  assert.equal(parseSurveyCustomId(id, 'wrong:'), null);
});

test('attention survey includes missing-email profiles and only zero-job incomplete profiles', () => {
  const profiles = [
    { discordId: '1', username: 'missing-email' },
    { discordId: '2', username: 'zero-jobs' },
    { discordId: '3', username: 'has-jobs' },
  ];
  const roster = [
    { discordId: '1', email: '' },
    { discordId: '2', email: 'zero@example.com' },
    { discordId: '3', email: 'jobs@example.com' },
  ];
  const activity = [
    { email: 'zero@example.com', jobPts: 0 },
    { email: 'jobs@example.com', jobPts: 5 },
  ];
  assert.deepEqual(
    selectAttentionProfiles(profiles, roster, activity).map(item => item.discordId),
    ['1', '2'],
  );
});

test('channel profile button is bound to one guild and requests the canonical fields', () => {
  assert.deepEqual(parseSurveyCustomId(
    'jp_profile_channel:1527624228830969967',
    'jp_profile_channel:',
  ), {
    guildId: '1527624228830969967',
    fields: ['name', 'email', 'phone', 'region', 'subregion'],
  });
});

test('legacy welcome verification panels can be discovered for removal', () => {
  assert.equal(hasLegacyVerificationButton({
    components: [{ components: [{ customId: 'jp_roster_verify_start' }] }],
  }), true);
  assert.equal(hasLegacyVerificationButton({ components: [] }), false);
});

test('supervisor profile editor IDs are bound to one guild and one student', () => {
  const prefix = 'jp_profile_admin_edit:';
  const id = encodeAdminProfileCustomId(
    prefix,
    '1527624228830969967',
    '688079587728556043',
  );
  assert.deepEqual(parseAdminProfileCustomId(id, prefix), {
    guildId: '1527624228830969967',
    discordId: '688079587728556043',
  });
  assert.equal(parseAdminProfileCustomId(`${id}:unexpected`, prefix), null);
  assert.equal(parseAdminProfileCustomId(id, 'wrong:'), null);
});

test('manual profile correction accepts a raw Discord ID without requiring a ping', () => {
  assert.equal(
    parseEditProfileTargetId('!editprofile 785818245977735169'),
    '785818245977735169',
  );
  assert.equal(
    parseEditProfileTargetId('!editprofile <@!785818245977735169>'),
    '785818245977735169',
  );
  assert.equal(parseEditProfileTargetId('!editprofile student-name'), '');
});

test('manual profile modal does not wait for a backend read before opening', () => {
  const source = fs.readFileSync(require.resolve('./student-data-survey'), 'utf8');
  const handler = source.slice(
    source.indexOf('const adminEdit = parseAdminProfileCustomId'),
    source.indexOf('[DASHBOARD_SEND_ID, DASHBOARD_REFRESH_ID]'),
  );
  assert.match(handler, /interaction\.showModal/);
  assert.doesNotMatch(handler, /await getRoster|members\.fetch/);
  assert.match(handler, /ADMIN_SUBMIT_PREFIX, cohort\.guildId, adminEdit\.discordId/);
  assert.doesNotMatch(handler, /ADMIN_SUBMIT_PREFIX, cohort\.guildId, member\.id/);
});

test('hired and eliminated/inactive students are excluded from profile survey eligibility', () => {
  const cohort = { guildId: 'guild-1', supervisorIds: ['sup-1'] };
  const roster = [
    { discordId: 'active-1', name: 'Active Student', active: true, status: '' },
    { discordId: 'hired-1', name: 'Hired Student', active: true, status: 'hired' },
    { discordId: 'eliminated-1', name: 'Eliminated Student', active: false, status: 'inactive' },
  ];

  // 1. Active incomplete student is eligible
  const activeMember = { id: 'active-1', user: { bot: false }, roles: { cache: [] } };
  assert.equal(isEligibleSurveyMember(cohort, activeMember, roster), true);

  // 2. Hired student in roster is excluded
  const hiredMember = { id: 'hired-1', user: { bot: false }, roles: { cache: [] } };
  assert.equal(isEligibleSurveyMember(cohort, hiredMember, roster), false);

  // 3. Eliminated/inactive student in roster is excluded
  const eliminatedMember = { id: 'eliminated-1', user: { bot: false }, roles: { cache: [] } };
  assert.equal(isEligibleSurveyMember(cohort, eliminatedMember, roster), false);

  // 4. Student with Hired role in Discord is excluded even without roster entry
  const discordHiredMember = {
    id: 'unknown-hired',
    user: { bot: false },
    roles: { cache: [{ name: 'Hired' }] },
  };
  assert.equal(isEligibleSurveyMember(cohort, discordHiredMember, []), false);

  // 5. Student with Inactive/Eliminated role in Discord is excluded
  const discordInactiveMember = {
    id: 'unknown-inactive',
    user: { bot: false },
    roles: { cache: [{ name: 'Inactive Student' }] },
  };
  assert.equal(isEligibleSurveyMember(cohort, discordInactiveMember, []), false);

  // 6. Bot and supervisor are excluded
  const botMember = { id: 'bot-1', user: { bot: true }, roles: { cache: [] } };
  assert.equal(isEligibleSurveyMember(cohort, botMember, roster), false);
  const supMember = { id: 'sup-1', user: { bot: false }, roles: { cache: [] } };
  assert.equal(isEligibleSurveyMember(cohort, supMember, roster), false);
});

test('postChannelSurvey does not mention hired or eliminated students', async () => {
  const cohort = { guildId: 'guild-1', supervisorIds: ['sup-1'] };
  const sentMessages = [];
  const channel = {
    guildId: 'guild-1',
    isTextBased: () => true,
    send: async (payload) => {
      sentMessages.push(payload);
      return { id: 'msg-1' };
    },
  };

  const members = new Map([
    ['active-1', { id: 'active-1', user: { bot: false }, roles: { cache: [] } }],
    ['hired-1', { id: 'hired-1', user: { bot: false }, roles: { cache: [{ name: 'Hired' }] } }],
    ['eliminated-1', { id: 'eliminated-1', user: { bot: false }, roles: { cache: [{ name: 'Inactive Student' }] } }],
  ]);

  const roster = [
    { discordId: 'active-1', name: 'Active', active: true, status: '' },
    { discordId: 'hired-1', name: 'Hired', active: true, status: 'hired' },
    { discordId: 'eliminated-1', name: 'Eliminated', active: false, status: 'inactive' },
  ];

  const profiles = [
    { discordId: 'active-1' },
    { discordId: 'hired-1' },
    { discordId: 'eliminated-1' },
  ];

  const result = await postChannelSurvey({ guild: {} }, cohort, channel, profiles, { members, roster });
  assert.equal(result.posted, 1);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].content, /<@active-1>/);
  assert.doesNotMatch(sentMessages[0].content, /<@hired-1>/);
  assert.doesNotMatch(sentMessages[0].content, /<@eliminated-1>/);
});

