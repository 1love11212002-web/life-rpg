(function () {
  'use strict';

  var XP_PER_LEVEL = 100;
  var BOSS_BONUS = 50;

  // Шаблоны квестов по категориям — запасной вариант, если ИИ недоступен.
  var TEMPLATES = {
    study: [
      { text: 'Раздели цель «{goal}» на 3 части и запиши их', xp: 10 },
      { text: 'Выдели 25 минут без телефона на «{goal}»', xp: 15 },
      { text: 'Сделай первую часть: 30 минут занятий', xp: 20 },
      { text: 'Расскажи кому-нибудь, что ты узнал', xp: 15 },
      { text: 'Проверь себя: ответь на 5 вопросов по теме', xp: 20 }
    ],
    sport: [
      { text: 'Выбери дни и время тренировок и запиши в календарь', xp: 10 },
      { text: 'Подготовь одежду и место для тренировки', xp: 10 },
      { text: 'Первая лёгкая тренировка на 20 минут', xp: 20 },
      { text: 'Вторая тренировка, чуть дольше первой', xp: 25 },
      { text: 'Замерь результат и запиши, что изменилось', xp: 15 }
    ],
    money: [
      { text: 'Запиши точную сумму, которая нужна для «{goal}»', xp: 10 },
      { text: 'Посчитай, сколько нужно откладывать в неделю', xp: 15 },
      { text: 'Найди одну статью расходов, которую можно сократить', xp: 20 },
      { text: 'Сделай первый перевод в накопления', xp: 20 },
      { text: 'Через неделю проверь, сколько уже накоплено', xp: 15 }
    ],
    other: [
      { text: 'Запиши, почему цель «{goal}» важна для тебя', xp: 10 },
      { text: 'Раздели цель на 3 шага', xp: 15 },
      { text: 'Сделай самый маленький первый шаг (5 минут)', xp: 15 },
      { text: 'Сделай следующий шаг', xp: 20 },
      { text: 'Подведи итоги: что получилось, что мешало', xp: 15 }
    ]
  };

  var CATEGORY_NAMES = { study: 'Учёба', sport: 'Спорт', money: 'Финансы', other: 'Другое' };

  // ---------- Telegram ----------
  var TG = window.Telegram && window.Telegram.WebApp;
  var initData = (TG && TG.initData) || '';
  var useServer = !!initData; // вне Telegram (обычный браузер) initData пустая

  function setupTelegram() {
    if (!TG) return;
    function applyTheme() {
      try {
        var root = document.documentElement;
        root.setAttribute('data-theme', TG.colorScheme === 'light' ? 'light' : 'dark');
        var css = getComputedStyle(root);
        var header = css.getPropertyValue('--tg-header').trim();
        var bg = css.getPropertyValue('--tg-bg').trim();
        if (header && TG.setHeaderColor) TG.setHeaderColor(header);
        if (bg && TG.setBackgroundColor) TG.setBackgroundColor(bg);
      } catch (e) { /* старая версия Telegram: игра всё равно работает */ }
    }
    try {
      TG.ready();
      TG.expand();
      applyTheme();
      if (TG.onEvent) TG.onEvent('themeChanged', applyTheme);
    } catch (e) { /* игнорируем */ }
  }
  setupTelegram();

  // ---------- DOM ----------
  var els = {
    form: document.getElementById('goalForm'),
    submit: document.getElementById('submitBtn'),
    title: document.getElementById('goalTitle'),
    category: document.getElementById('goalCategory'),
    deadline: document.getElementById('goalDeadline'),
    list: document.getElementById('goalList'),
    empty: document.getElementById('empty'),
    level: document.getElementById('level'),
    xpFill: document.getElementById('xpFill'),
    xpBar: document.getElementById('xpBar'),
    xpText: document.getElementById('xpText'),
    toast: document.getElementById('toast')
  };

  var EMPTY_DEFAULT_TEXT = els.empty.textContent;

  // ---------- Состояние на экране: { level, xpInLevel, xpTotal, goals:[{id,title,category,deadline,quests:[{id,text,xp,done}]}] } ----------
  var view = { level: 1, xpInLevel: 0, xpTotal: 0, goals: [] };

  // ================= Локальный запасной режим (без Telegram) =================
  var STORAGE_KEY = 'goal-quest-v1';

  function loadLocalRaw() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.goals)) return data;
      }
    } catch (e) { /* хранилище недоступно, начинаем с пустого */ }
    return { goals: [] };
  }

  function saveLocalRaw(raw) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(raw)); }
    catch (e) { /* прогресс проживёт до закрытия вкладки */ }
  }

  var localRaw = loadLocalRaw();

  function localIsComplete(goal) {
    return goal.quests.length > 0 && goal.quests.every(function (q) { return q.done; });
  }

  function localXpTotal() {
    return localRaw.goals.reduce(function (sum, g) {
      var questXp = g.quests.reduce(function (s, q) { return s + (q.done ? q.xp : 0); }, 0);
      return sum + questXp + (localIsComplete(g) ? BOSS_BONUS : 0);
    }, 0);
  }

  function computeLocalView() {
    var xpTotal = localXpTotal();
    return {
      level: Math.floor(xpTotal / XP_PER_LEVEL) + 1,
      xpInLevel: xpTotal % XP_PER_LEVEL,
      xpTotal: xpTotal,
      goals: localRaw.goals
    };
  }

  // ================= Общие утилиты =================
  function plural(n, forms) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function deadlineText(iso) {
    if (!iso) return '';
    var end = new Date(iso + 'T23:59:59');
    var days = Math.ceil((end - new Date()) / 86400000);
    if (isNaN(days)) return '';
    if (days > 1) return 'Осталось ' + days + ' ' + plural(days, ['день', 'дня', 'дней']);
    if (days === 1 || days === 0) return 'Последний день: сегодня или завтра';
    return 'Срок прошёл';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function goalIsComplete(g) {
    return g.quests.length > 0 && g.quests.every(function (q) { return q.done; });
  }

  // ---------- Отрисовка ----------
  function renderHeader() {
    els.level.textContent = view.level;
    els.xpFill.style.width = view.xpInLevel + '%';
    els.xpBar.setAttribute('aria-valuenow', view.xpInLevel);
    els.xpText.textContent = view.xpInLevel + ' / ' + XP_PER_LEVEL + ' опыта';
  }

  function renderGoals() {
    var hasGoals = view.goals.length > 0;
    els.empty.style.display = hasGoals ? 'none' : 'block';
    if (!hasGoals) els.empty.textContent = EMPTY_DEFAULT_TEXT;

    els.list.innerHTML = view.goals.map(function (g) {
      var done = g.quests.filter(function (q) { return q.done; }).length;
      var total = g.quests.length;
      var percent = total ? Math.round((done / total) * 100) : 0;
      var complete = goalIsComplete(g);
      var meta = [CATEGORY_NAMES[g.category] || 'Другое', deadlineText(g.deadline)]
        .filter(Boolean).join(', ');

      var quests = g.quests.map(function (q) {
        return '<li class="quest"><label>' +
          '<input type="checkbox" data-goal="' + g.id + '" data-quest="' + q.id + '"' + (q.done ? ' checked' : '') + '>' +
          '<span class="quest-text">' + escapeHtml(q.text) + '</span>' +
          '<span class="quest-xp">+' + q.xp + '</span>' +
          '</label></li>';
      }).join('');

      return '<article class="goal' + (complete ? ' is-complete' : '') + '">' +
        '<div class="goal-head"><div>' +
          '<h3 class="goal-title">' + escapeHtml(g.title) + '</h3>' +
          '<p class="goal-meta">' + escapeHtml(meta) + '</p>' +
        '</div>' +
        '<button class="del" type="button" data-delete="' + g.id + '">Удалить</button></div>' +
        '<div class="progress" aria-hidden="true"><div style="width:' + percent + '%"></div></div>' +
        '<p class="goal-meta">Выполнено ' + done + ' из ' + total + '</p>' +
        '<ul class="quests">' + quests + '</ul>' +
        '<p class="boss">' + (complete
          ? 'Цель достигнута! Бонус +' + BOSS_BONUS + ' опыта получен.'
          : 'Выполни все квесты, чтобы достичь цели и получить бонус +' + BOSS_BONUS + ' опыта.') +
        '</p>' +
        '</article>';
    }).join('');
  }

  function render() {
    renderHeader();
    renderGoals();
  }

  var toastTimer;
  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 3000);
  }

  // ---------- Синхронизация с сервером ----------
  async function callSync(action, payload) {
    var res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: initData, action: action, payload: payload || {} })
    });
    var data = null;
    try { data = await res.json(); } catch (e) { /* пустой ответ */ }
    if (!res.ok) throw new Error((data && data.error) || ('sync failed: ' + res.status));
    return data;
  }

  async function refresh() {
    if (useServer) {
      view = await callSync('load', {});
    } else {
      view = computeLocalView();
    }
    render();
  }

  // ---------- Квесты от ИИ ----------
  function makeQuests(goalTitle, category) {
    var list = TEMPLATES[category] || TEMPLATES.other;
    return list.map(function (t) {
      return { text: t.text.replace('{goal}', goalTitle), xp: t.xp };
    });
  }

  async function fetchAiQuests(title, category, deadline) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 90000);
    try {
      var res = await fetch('/api/quests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: title, category: category, deadline: deadline }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error('bad response');
      var list = await res.json();
      if (!Array.isArray(list)) throw new Error('bad format');

      var quests = list
        .filter(function (q) { return q && typeof q.text === 'string' && q.text.trim(); })
        .slice(0, 5)
        .map(function (q) {
          var xp = Math.round(Number(q.xp)) || 10;
          return { text: q.text.trim().slice(0, 200), xp: Math.min(25, Math.max(5, xp)) };
        });

      if (!quests.length) throw new Error('empty list');
      return { quests: quests, fromAi: true };
    } catch (e) {
      return { quests: makeQuests(title, category), fromAi: false };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- Индикатор занятости кнопки ----------
  var busy = false;
  function setBusy(value, label) {
    busy = value;
    els.submit.disabled = value;
    els.submit.textContent = value ? (label || 'Придумываю квесты…') : 'Получить квесты';
  }

  // ---------- Добавление цели ----------
  els.form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (busy) return;

    var title = els.title.value.trim();
    if (!title) return;
    var category = els.category.value;
    var deadline = els.deadline.value || '';

    setBusy(true, 'Придумываю квесты…');
    var result = await fetchAiQuests(title, category, deadline);

    try {
      if (useServer) {
        setBusy(true, 'Сохраняю…');
        view = await callSync('add_goal', { title: title, category: category, deadline: deadline, quests: result.quests });
      } else {
        localRaw.goals.unshift({
          id: Date.now(),
          title: title,
          category: category,
          deadline: deadline,
          quests: result.quests.map(function (q, i) { return { id: i + 1, text: q.text, xp: q.xp, done: false }; })
        });
        saveLocalRaw(localRaw);
        view = computeLocalView();
      }
      render();
      els.form.reset();
      toast(result.fromAi
        ? 'Цель добавлена. Квесты придуманы под неё.'
        : 'Цель добавлена. Claude сейчас недоступен, выданы стандартные квесты.');
    } catch (err) {
      toast('Не удалось сохранить цель. Проверь соединение и попробуй ещё раз.');
    } finally {
      setBusy(false);
    }
  });

  // ---------- Отметка квеста ----------
  els.list.addEventListener('change', async function (e) {
    var box = e.target;
    if (!box.matches('input[type="checkbox"]')) return;

    var goalId = box.dataset.goal;
    var questId = box.dataset.quest;
    var done = box.checked;

    if (useServer) {
      try {
        var levelBefore = view.level;
        var goal = view.goals.find(function (g) { return String(g.id) === goalId; });
        var wasComplete = goal ? goalIsComplete(goal) : false;

        view = await callSync('toggle_quest', { questId: questId, done: done });
        render();

        var newGoal = view.goals.find(function (g) { return String(g.id) === goalId; });
        if (view.level > levelBefore) {
          toast('Новый уровень: ' + view.level + '!');
        } else if (newGoal && !wasComplete && goalIsComplete(newGoal)) {
          toast('Цель достигнута! +' + BOSS_BONUS + ' опыта.');
        } else if (done) {
          toast('Квест отмечен');
        }
      } catch (err) {
        render(); // откатываем чекбокс визуально к последнему известному состоянию
        toast('Не удалось сохранить. Проверь соединение.');
      }
      return;
    }

    var g = localRaw.goals.find(function (x) { return String(x.id) === goalId; });
    if (!g) return;
    var q = g.quests.find(function (x) { return String(x.id) === questId; });
    if (!q) return;

    var levelBeforeLocal = computeLocalView().level;
    var wasCompleteLocal = localIsComplete(g);
    q.done = done;
    saveLocalRaw(localRaw);
    view = computeLocalView();
    render();

    if (view.level > levelBeforeLocal) {
      toast('Новый уровень: ' + view.level + '!');
    } else if (!wasCompleteLocal && localIsComplete(g)) {
      toast('Цель достигнута! +' + BOSS_BONUS + ' опыта.');
    } else if (done) {
      toast('Квест выполнен: +' + q.xp + ' опыта');
    }
  });

  // ---------- Удаление цели ----------
  els.list.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-delete]');
    if (!btn) return;
    if (!window.confirm('Удалить эту цель вместе с квестами?')) return;
    var goalId = btn.dataset.delete;

    if (useServer) {
      try {
        view = await callSync('delete_goal', { goalId: goalId });
        render();
      } catch (err) {
        toast('Не удалось удалить. Проверь соединение.');
      }
      return;
    }

    localRaw.goals = localRaw.goals.filter(function (g) { return String(g.id) !== goalId; });
    saveLocalRaw(localRaw);
    view = computeLocalView();
    render();
  });

  // ---------- Старт ----------
  if (!useServer) {
    view = computeLocalView();
    render();
  } else {
    els.empty.textContent = 'Загрузка…';
    els.empty.style.display = 'block';
    refresh().catch(function () {
      els.empty.textContent = 'Не удалось загрузить данные. Проверь соединение и открой игру заново.';
    });
  }
})();