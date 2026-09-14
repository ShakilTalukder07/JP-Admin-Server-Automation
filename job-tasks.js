'use strict';

// ============================================================
//  job-tasks.js - tracking student job task submissions
//  Listens to #job-task-update, parses structured student updates,
//  and logs them into the Google Sheet's "Job_Tasks_Log" tab.
// ============================================================

const { cohorts } = require('./config');
const { getRoster, syncMembers } = require('./roster');
const { appsScriptPost } = require('./apps-script-api');
const { resolveChannel } = require('./settings');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function clean(value, limit = 300) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function labeledValue(text, labels) {
  const pattern = new RegExp(
    `(?:^|[\\n|•;])\\s*(?:${labels.join('|')})\\s*[:\\-]\\s*([^\\n|•;]+)`,
    'i',
  );
  return clean(text.match(pattern)?.[1] || '');
}

function isLabelLike(val) {
  const v = String(val || '').trim().toLowerCase().replace(/[:\-]/g, '');
  return /^(candidate(\s*name)?|student(\s*name)?|company(\s*name)?|organisation|organization|agency|designation|role|position|job\s*title|task\s*deadline|deadline|submission\s*date|due\s*date|task\s*date)$/i.test(v);
}

function parseJobTaskMessage(text) {
  const source = String(text || '').trim();
  if (source.length < 10) return null;
  if (source.includes('@everyone') || source.includes('@here')) return null;

  const rawCandidate = labeledValue(source, ['candidate(?:\\s+name)?', 'student(?:\\s+name)?', 'name']);
  const rawCompany = labeledValue(source, ['company(?:\\s+name)?', 'organisation', 'organization', 'agency']);
  const rawDesignation = labeledValue(source, ['designation', 'role', 'position', 'job\\s+title']);
  const rawDeadline = labeledValue(source, [
    'task\\s+deadline',
    'deadline',
    'task\\s+submission\\s+date',
    'submission\\s+date',
    'due\\s+date',
    'task\\s+date',
  ]);

  const candidate = isLabelLike(rawCandidate) ? '' : rawCandidate;
  const company = isLabelLike(rawCompany) ? '' : rawCompany;
  const designation = isLabelLike(rawDesignation) ? '' : rawDesignation;
  const deadline = isLabelLike(rawDeadline) ? '' : rawDeadline;

  if (!company && !deadline && !designation) return null;
  if (!company && !deadline) return null;

  return {
    candidate,
    company: company || '',
    designation: designation || '',
    deadline: deadline || '',
  };
}

function dateKey(date, timezone) {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}

async function postTaskBackend(cohort, body) {
  return appsScriptPost(cohort, body, {
    attempts: 3,
    idempotent: true,
    label: 'Job task write',
    timeoutMs: 180000,
  });
}

async function processJobTaskMessage(msg) {
  if (!msg || msg.author?.bot) return;
  const cohort = cohorts.find(candidate => candidate.guildId === msg.guildId);
  if (!cohort) return;

  const channelId = await resolveChannel(
    cohort, 'channel_job_tasks', cohort.channels?.jobTaskUpdates);
  if (msg.channelId !== channelId) return;
  if (msg.content.startsWith('!') || msg.content.trim().length < 10) return;

  const parsed = parseJobTaskMessage(msg.content);
  if (!parsed || (!parsed.company && !parsed.deadline)) return;

  let roster = await getRoster(cohort);
  let student = roster.find(entry => entry.discordId === msg.author.id);
  const isSupervisor = (cohort.supervisorIds || []).includes(msg.author.id);
  if (!student && !isSupervisor) {
    await syncMembers(msg.client, cohort);
    roster = await getRoster(cohort, true);
    student = roster.find(entry => entry.discordId === msg.author.id);
  }

  const studentName = parsed.candidate || student?.name || msg.author.displayName || msg.author.username;
  const email = student?.email || '';

  try {
    const result = await postTaskBackend(cohort, {
      action: 'logJobTask',
      guildId: cohort.guildId,
      email: email,
      name: studentName,
      candidateName: parsed.candidate || studentName,
      company: parsed.company,
      designation: parsed.designation,
      deadline: parsed.deadline,
      date: dateKey(new Date(msg.createdTimestamp || Date.now()), cohort.timezone),
      messageId: msg.id || '',
      messageUrl: msg.url || '',
    });

    if (result && result.error === 'unknown action') {
      // Graceful fallback if Apps Script hasn't been updated yet: log into Interview_Log
      await postTaskBackend(cohort, {
        action: 'logInterviews',
        guildId: cohort.guildId,
        email: email,
        name: studentName,
        date: dateKey(new Date(msg.createdTimestamp || Date.now()), cohort.timezone),
        messageId: msg.id || '',
        messageUrl: msg.url || '',
        interviews: [{
          eventIndex: 0,
          company: parsed.company || 'Job Task',
          role: parsed.designation || 'Task',
          interviewDate: parsed.deadline || '',
          details: `[Job Task] Deadline: ${parsed.deadline || 'N/A'}`,
        }],
      });
    }

    await msg.react('📋').catch(() => {});
    await msg.reply({
      content: `✅ **Job Task Recorded!**\n• **Candidate:** ${studentName}\n• **Company:** ${parsed.company || 'N/A'}\n• **Designation:** ${parsed.designation || 'N/A'}\n• **Deadline:** ${parsed.deadline || 'N/A'}\nSaved to Google Sheet. Best of luck! 🚀`,
      allowedMentions: { parse: [] },
    }).catch(() => {});

    console.log(`[job-tasks] Logged task for ${studentName} (${parsed.company})`);
  } catch (err) {
    console.error('[job-tasks] Failed to save task:', err.message);
  }
}

async function backfillJobTasks(client, cohort, options = {}) {
  const channelId = await resolveChannel(
    cohort, 'channel_job_tasks', cohort.channels?.jobTaskUpdates);
  if (!channelId) throw new Error('Job tasks channel not configured');
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('Job tasks channel is not readable');

  let roster = await getRoster(cohort, true);
  const byId = new Map(roster.map(s => [s.discordId, s]));
  const byName = new Map(roster.map(s => [String(s.name || '').toLowerCase().trim(), s]));

  let before = null;
  const allMessages = [];
  for (let page = 0; page < 20; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    for (const msg of batch.values()) {
      allMessages.push(msg);
    }
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  // Chronological order so earliest tasks log first
  allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  let recognized = 0;
  let logged = 0;
  let duplicates = 0;
  let failed = 0;

  for (const msg of allMessages) {
    if (msg.author?.bot) continue;
    if (msg.content.startsWith('!') || msg.content.trim().length < 10) continue;

    const parsed = parseJobTaskMessage(msg.content);
    if (!parsed || (!parsed.company && !parsed.deadline)) continue;
    recognized++;

    let student = byId.get(msg.author.id);
    if (!student && parsed.candidate) {
      student = byName.get(String(parsed.candidate).toLowerCase().trim());
    }

    const studentName = parsed.candidate || student?.name || msg.author.displayName || msg.author.username;
    const email = student?.email || '';

    try {
      const result = await postTaskBackend(cohort, {
        action: 'logJobTask',
        guildId: cohort.guildId,
        email,
        name: studentName,
        candidateName: parsed.candidate || studentName,
        company: parsed.company,
        designation: parsed.designation,
        deadline: parsed.deadline,
        date: dateKey(new Date(msg.createdTimestamp || Date.now()), cohort.timezone),
        messageId: msg.id || '',
        messageUrl: msg.url || '',
      });

      if (result && result.duplicate) {
        duplicates++;
      } else {
        logged++;
      }
      await msg.react('📋').catch(() => {});
      console.log(`[job-tasks] Backfilled ${recognized}: ${studentName} (${parsed.company}) -> ${result?.duplicate ? 'DUPLICATE' : 'SAVED'}`);
      await sleep(1000);
    } catch (err) {
      failed++;
      console.error('[job-tasks] Backfill task error for message', msg.id, err.message);
      await sleep(1000);
    }
  }

  return {
    scanned: allMessages.length,
    recognized,
    logged,
    duplicates,
    failed,
  };
}

module.exports = function registerJobTasks(client) {
  client.on('messageCreate', async msg => {
    if (msg.author?.bot) return;
    const command = msg.content.trim().toLowerCase();
    if (command === '!synctasks' || command === '!syncjobtasks') {
      const cohort = cohorts.find(c => c.guildId === msg.guildId);
      if (!cohort || !cohort.supervisorIds.includes(msg.author.id)) return;
      if (msg.channelId !== cohort.channels.supervisor) {
        return msg.reply(`Run task synchronization in <#${cohort.channels.supervisor}>.`);
      }

      await msg.reply('🔄 Scanning `#job-task-update` and syncing all student job tasks to Google Sheet...');
      try {
        const result = await backfillJobTasks(client, cohort);
        await msg.channel.send({
          content: `✅ **Job Task Sync Complete!**\n• Scanned: **${result.scanned}** messages\n• Recognized tasks: **${result.recognized}**\n• Newly saved: **${result.logged}**\n• Already present / duplicates: **${result.duplicates}**\n• Failed: **${result.failed}**\nAll saved to the \`Job_Tasks_Log\` tab in Google Sheet. 🚀`,
          allowedMentions: { parse: [] },
        });
      } catch (err) {
        await msg.reply(`❌ Task sync failed: ${err.message}`);
      }
      return;
    }

    processJobTaskMessage(msg).catch(err =>
      console.error('[job-tasks] Message processing error:', err.message));
  });
};

module.exports.parseJobTaskMessage = parseJobTaskMessage;
module.exports.backfillJobTasks = backfillJobTasks;
