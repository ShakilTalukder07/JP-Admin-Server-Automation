'use strict';

/**
 * student-mention.js
 * Extracts students mentioned either via Discord user mention (<@id>)
 * or by plain-text name matching from the cohort roster.
 * Safely handles @everyone and @here announcements without collisions.
 */

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractStudentsFromMessage(msg, roster = [], supervisorIds = []) {
  const supervisorSet = new Set((supervisorIds || []).map(String));
  const byId = new Map();
  for (const s of roster) {
    if (s.discordId) byId.set(String(s.discordId), s);
  }

  const matched = new Map();
  const unknownUsers = [];

  // 1. Process explicit Discord user mentions
  if (msg.mentions?.users) {
    for (const [id, user] of msg.mentions.users) {
      if (user.bot || supervisorSet.has(id)) continue;
      const s = byId.get(id);
      if (s) {
        matched.set(s.discordId || s.email, s);
      } else {
        unknownUsers.push(user.displayName || user.username || user.tag || id);
      }
    }
  }

  // 2. Process plain-text names if any
  const content = String(msg.content || '');
  const isAnnouncement = Boolean(
    msg.mentions?.everyone ||
    /@(everyone|here)\b/i.test(content)
  );

  // Clean content: remove mentions, role mentions, channel pings, and @everyone/@here
  const cleanedText = content
    .replace(/<@!?\d+>/g, ' ')
    .replace(/<@&\d+>/g, ' ')
    .replace(/<#\d+>/g, ' ')
    .replace(/@everyone\b/gi, ' ')
    .replace(/@here\b/gi, ' ')
    .trim();

  if (cleanedText.length >= 3) {
    for (const student of roster) {
      if (supervisorSet.has(String(student.discordId || ''))) continue;
      const key = student.discordId || student.email;
      if (matched.has(key)) continue;

      const candidateNames = [student.name, student.displayName]
        .map(n => String(n || '').trim())
        .filter(n => n.length >= 4 && !/^(candidate|company|student|designation|deadline|task|everyone|here)$/i.test(n));

      for (const name of candidateNames) {
        const pattern = new RegExp(`(?:^|\\b|[^a-zA-Z0-9])${escapeRegex(name)}(?:$|\\b|[^a-zA-Z0-9])`, 'i');
        if (pattern.test(cleanedText)) {
          matched.set(key, student);
          break;
        }
      }
    }
  }

  return {
    students: Array.from(matched.values()),
    unknownUsers,
    isAnnouncement,
  };
}

module.exports = {
  extractStudentsFromMessage,
};
