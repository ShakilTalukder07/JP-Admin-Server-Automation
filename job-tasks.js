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

function parseJobTaskMessage(text) {
  const source = String(text || '').trim();
  if (source.length < 10) return null;

  const candidate = labeledValue(source, ['candidate(?:\\s+name)?', 'student(?:\\s+name)?', 'name']);
  const company = labeledValue(source, ['company(?:\\s+name)?', 'organisation', 'organization', 'agency']);
  const designation = labeledValue(source, ['designation', 'role', 'position', 'job\\s+title']);
  const deadline = labeledValue(source, [
    'task\\s+deadline',
    'deadline',
    'task\\s+submission\\s+date',
    'submission\\s+date',
    'due\\s+date',
    'task\\s+date',
  ]);

  if (!company && !deadline && !designation) return null;

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

module.exports = function registerJobTasks(client) {
  client.on('messageCreate', msg => {
    processJobTaskMessage(msg).catch(err =>
      console.error('[job-tasks] Message processing error:', err.message));
  });
};

module.exports.parseJobTaskMessage = parseJobTaskMessage;
