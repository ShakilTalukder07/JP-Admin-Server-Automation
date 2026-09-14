'use strict';

// ============================================================
//  eliminated.js - #eliminated-students pipeline
//  Supervisor mentions a student in the eliminated channel ->
//  Student is marked inactive/eliminated in Sheet & Bot_Map,
//  active status role removed, excluded from sync & automations.
//  In index.js: require('./eliminated')(client);
// ============================================================

const { cohorts } = require('./config');
const { getRoster, clearCache } = require('./roster');
const { setStudentsInactive } = require('./exclude');
const { extractStudentsFromMessage } = require('./student-mention');

module.exports = function registerEliminated(client) {
  client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;

    const cohort = cohorts.find(c => c.guildId === msg.guildId);
    if (!cohort) return;

    if (!cohort.channels?.eliminated) return;
    if (msg.channelId !== cohort.channels.eliminated) return;

    // channel permissions already restrict posting, this is a code-level backup
    if (!cohort.supervisorIds.includes(msg.author.id)) return;

    try {
      const roster = await getRoster(cohort, true);
      const { students, unknownUsers, isAnnouncement } = extractStudentsFromMessage(msg, roster, cohort.supervisorIds);

      if (students.length === 0) {
        // Safe @everyone handling - general announcements are ignored silently without error
        if (isAnnouncement) return;
        if (unknownUsers.length) {
          await msg.reply(`⚠️ Not in the roster: ${unknownUsers.join(', ')} — nothing marked.`);
        }
        return;
      }

      const discordIds = students.map(s => s.discordId).filter(Boolean);
      if (!discordIds.length) {
        await msg.reply('⚠️ Found candidate(s) by name, but no Discord ID was found in the roster to eliminate.');
        return;
      }

      // Mark inactive/eliminated and reconcile status roles
      const result = await setStudentsInactive(cohort, discordIds, {
        client,
        source: 'eliminated-channel',
        reason: 'Eliminated via #eliminated-students channel',
      });

      clearCache(cohort); // so every module immediately sees student as excluded

      const lines = students.map(s => `🚫 **${s.name || s.displayName}** has been marked inactive/eliminated.`);
      await msg.reply({
        embeds: [{
          title: `⚠️ Eliminated — ${cohort.name}`,
          description: lines.join('\n'),
          color: 0xe74c3c,
          footer: {
            text: `Marked eliminated and sync turned off (excluded from attendance, tasks, outreach, and warning checks).`,
          },
        }],
      });

      if (unknownUsers.length) {
        await msg.channel.send(`⚠️ Also mentioned but not in roster (skipped): ${unknownUsers.join(', ')}`);
      }
    } catch (err) {
      console.error('[eliminated] failed:', err.message);
      await msg.reply('❌ Could not update elimination status: ' + err.message);
    }
  });
};
