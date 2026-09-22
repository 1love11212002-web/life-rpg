// Единая точка входа для игры: /api/sync
// Каждый запрос несёт initData от Telegram, сервер проверяет подпись
// и только после этого читает или меняет данные этого игрока.
const { verifyInitData } = require('../lib/telegram');
const { sb } = require('../lib/supabase');

const XP_PER_LEVEL = 100;
const BOSS_BONUS = 50;
const CATEGORIES = ['study', 'sport', 'money', 'other'];
const MAX_INIT_DATA_AGE = 24 * 60 * 60; // сутки

function levelInfo(xpTotalRaw) {
  const xpTotal = Math.max(0, Number(xpTotalRaw) || 0);
  return {
    level: Math.floor(xpTotal / XP_PER_LEVEL) + 1,
    xpInLevel: xpTotal % XP_PER_LEVEL,
    xpTotal: xpTotal
  };
}

async function resolveUser(initData, botToken) {
  const tgUser = verifyInitData(initData, botToken, MAX_INIT_DATA_AGE);
  if (!tgUser) return null;

  const rows = await sb('/users?on_conflict=telegram_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: [{ telegram_id: tgUser.id, first_name: String(tgUser.first_name || '').slice(0, 80) }]
  });
  return rows && rows[0];
}

async function loadState(userId) {
  const userRows = await sb('/users?id=eq.' + userId + '&select=xp_total');
  const xpTotal = userRows && userRows[0] ? userRows[0].xp_total : 0;

  const goals = await sb(
    '/goals?user_id=eq.' + userId + '&status=eq.active&select=id,title,category,deadline,created_at&order=created_at.desc'
  );

  const ids = goals.map(function (g) { return g.id; });
  let quests = [];
  if (ids.length) {
    quests = await sb(
      '/quests?goal_id=in.(' + ids.join(',') + ')&select=id,goal_id,text,xp,done,position&order=position.asc'
    );
  }

  const byGoal = {};
  quests.forEach(function (q) {
    (byGoal[q.goal_id] = byGoal[q.goal_id] || []).push({ id: q.id, text: q.text, xp: q.xp, done: q.done });
  });
  goals.forEach(function (g) { g.quests = byGoal[g.id] || []; });

  const view = levelInfo(xpTotal);
  view.goals = goals;
  return view;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server is not configured' });
  }

  const body = req.body || {};
  const action = body.action;
  const payload = body.payload || {};

  let user;
  try {
    user = await resolveUser(body.initData, botToken);
  } catch (e) {
    return res.status(502).json({ error: 'Database error' });
  }
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (action === 'load') {
      return res.status(200).json(await loadState(user.id));
    }

    if (action === 'add_goal') {
      const title = typeof payload.title === 'string' ? payload.title.trim() : '';
      const category = CATEGORIES.indexOf(payload.category) >= 0 ? payload.category : 'other';
      const deadline = /^\d{4}-\d{2}-\d{2}$/.test(payload.deadline || '') ? payload.deadline : null;
      const quests = Array.isArray(payload.quests) ? payload.quests : [];

      if (!title || title.length > 80) return res.status(400).json({ error: 'Bad goal title' });

      const questRows = quests.slice(0, 5).map(function (q, i) {
        const text = typeof q.text === 'string' ? q.text.trim().slice(0, 200) : '';
        const xp = Math.min(25, Math.max(5, Math.round(Number(q.xp)) || 10));
        return { text: text, xp: xp, position: i };
      }).filter(function (q) { return q.text; });

      if (!questRows.length) return res.status(400).json({ error: 'Bad quest list' });

      const goalRows = await sb('/goals', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: [{ user_id: user.id, title: title, category: category, deadline: deadline }]
      });
      const goal = goalRows[0];

      await sb('/quests', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: questRows.map(function (q) { return Object.assign({ goal_id: goal.id }, q); })
      });

      return res.status(200).json(await loadState(user.id));
    }

    if (action === 'toggle_quest') {
      const questId = payload.questId;
      const done = !!payload.done;
      if (!questId) return res.status(400).json({ error: 'Bad request' });

      const questRows = await sb('/quests?id=eq.' + questId + '&select=id,goal_id,xp,done');
      const quest = questRows && questRows[0];
      if (!quest) return res.status(404).json({ error: 'Quest not found' });

      const goalRows = await sb('/goals?id=eq.' + quest.goal_id + '&select=id,user_id');
      const goal = goalRows && goalRows[0];
      if (!goal || goal.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

      const siblingRows = await sb('/quests?goal_id=eq.' + quest.goal_id + '&select=id,done');
      const wasComplete = siblingRows.length > 0 && siblingRows.every(function (q) { return q.done; });
      const afterRows = siblingRows.map(function (q) {
        return q.id === quest.id ? Object.assign({}, q, { done: done }) : q;
      });
      const isComplete = afterRows.length > 0 && afterRows.every(function (q) { return q.done; });

      await sb('/quests?id=eq.' + questId, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: { done: done }
      });

      let delta = done ? quest.xp : -quest.xp;
      if (isComplete && !wasComplete) delta += BOSS_BONUS;
      if (!isComplete && wasComplete) delta -= BOSS_BONUS;

      const userRows = await sb('/users?id=eq.' + user.id + '&select=xp_total');
      const newXp = Math.max(0, (userRows[0].xp_total || 0) + delta);

      await sb('/users?id=eq.' + user.id, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: { xp_total: newXp }
      });

      await sb('/xp_log', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: [{ user_id: user.id, amount: delta, reason: 'quest:' + questId }]
      });

      return res.status(200).json(await loadState(user.id));
    }

    if (action === 'delete_goal') {
      const goalId = payload.goalId;
      if (!goalId) return res.status(400).json({ error: 'Bad request' });

      const goalRows = await sb('/goals?id=eq.' + goalId + '&select=id,user_id');
      const goal = goalRows && goalRows[0];
      if (!goal || goal.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

      await sb('/goals?id=eq.' + goalId, { method: 'DELETE' });
      return res.status(200).json(await loadState(user.id));
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(502).json({ error: 'Database error' });
  }
};
