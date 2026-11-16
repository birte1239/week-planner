(() => {
  'use strict';

  const KEY = 'week.v1';
  const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];

  /* ---------- Helpers ---------- */
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); };
  const isoWeek = d => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
  };
  const fmt = (d, o) => d.toLocaleDateString('en-GB', o);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const norm = s => String(s || '').trim().toLowerCase();
  const kg25 = n => Math.round(n / 2.5) * 2.5;
  const num = n => String(Math.round(n * 10) / 10);

  /* ---------- State ---------- */
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }
  state.anytime = state.anytime || [];
  state.days = state.days || {};
  state.meals = state.meals || [];        // [{ id, name, ingredients: [] }]
  state.shop = state.shop || {};          // weekKey -> { checked: {}, extras: [] }
  state.gym = state.gym || {};
  state.gym.exercises = state.gym.exercises || []; // [{ id, name, sets, reps, step }]
  state.gym.log = state.gym.log || {};             // weekKey -> exId -> { kg, hit }
  state.gym.km = state.gym.km || {};               // weekKey -> km
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } };

  const todayKey = keyOf(new Date());
  const thisMonday = keyOf(mondayOf(new Date()));
  let view = thisMonday;
  let tab = 'week';
  try { tab = localStorage.getItem(KEY + '.tab') || 'week'; } catch (e) { /* ignore */ }
  let shopOpen = false;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const isPhone = () => window.matchMedia('(max-width: 700px)').matches;
  // The day shown on phones: today in this week, otherwise Monday
  const defaultDay = () => weekKeys().includes(todayKey) ? todayKey : view;
  let selDay = null;

  function day(k) {
    if (!state.days[k]) state.days[k] = { tasks: [], workouts: [], meals: { breakfast: '', lunch: '', dinner: '' } };
    return state.days[k];
  }
  function shopWeek(k) {
    if (!state.shop[k]) state.shop[k] = { checked: {}, extras: [] };
    return state.shop[k];
  }
  // A list is addressed as "anytime" or "<date>|tasks", "<date>|workouts", "<monday>|shop"
  function list(ref) {
    if (ref === 'anytime') return state.anytime;
    const [k, kind] = ref.split('|');
    return kind === 'shop' ? shopWeek(k).extras : day(k)[kind];
  }
  const kindOf = ref => ref.endsWith('|workouts') ? 'workout' : ref.endsWith('|shop') ? 'shop' : 'task';
  const weekKeys = (k = view) => Array.from({ length: 7 }, (_, i) => keyOf(addDays(parseKey(k), i)));
  const findMeal = name => state.meals.find(m => norm(m.name) === norm(name));

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------- Shopping list from the week's meals ---------- */
  function shoppingItems(k = view) {
    const map = new Map();
    for (const dk of weekKeys(k)) {
      const d = state.days[dk];
      if (!d) continue;
      for (const [m] of MEALS) {
        const meal = findMeal(d.meals[m]);
        if (!meal) continue;
        for (const ing of meal.ingredients) {
          const key = norm(ing);
          const e = map.get(key) || { key, name: ing.trim(), count: 0, meals: new Set() };
          e.count++;
          e.meals.add(meal.name);
          map.set(key, e);
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function shopHtml() {
    const items = shoppingItems();
    const sw = state.shop[view] || { checked: {}, extras: [] };
    const total = items.length + sw.extras.length;
    const done = items.filter(i => sw.checked[i.key]).length + sw.extras.filter(x => x.done).length;
    return `<details class="shop"${shopOpen ? ' open' : ''}>
        <summary><span class="label">Shopping</span><span class="count">${total ? `${done}/${total}` : ''}</span></summary>
        <ul class="list">${items.map(i => `<li class="item${sw.checked[i.key] ? ' done' : ''}" title="${esc([...i.meals].join(', '))}">
            <input type="checkbox" class="tick" data-action="shoptick" data-key="${esc(i.key)}"${sw.checked[i.key] ? ' checked' : ''} aria-label="Bought ${esc(i.name)}">
            <span class="text">${esc(i.name)}${i.count > 1 ? ` <span class="times">×${i.count}</span>` : ''}</span></li>`).join('')}
          ${itemsHtml(`${view}|shop`, sw.extras, false)}</ul>
        ${!items.length ? '<p class="hint">Pick meals from your list and their ingredients show up here.</p>' : ''}
        <form class="add" data-add="${view}|shop"><input name="text" maxlength="80" placeholder="Add item" aria-label="Add a shopping item"></form>
      </details>`;
  }
  function renderShop() {
    const box = $('#shopBox');
    if (box) box.innerHTML = shopHtml();
  }

  /* ---------- Gym suggestions ---------- */
  function liftSuggestion(ex) {
    const weeks = Object.keys(state.gym.log).filter(k => k <= view && state.gym.log[k][ex.id] && state.gym.log[k][ex.id].kg > 0).sort();
    if (!weeks.length) return { kind: 'none', text: 'Log a weight' };
    const last = weeks[weeks.length - 1];
    const e = state.gym.log[last][ex.id];
    const prefix = last === view ? 'Next week' : 'This week';
    if (e.hit) return { kind: 'up', text: `${prefix}: ${num(e.kg + ex.step)} kg` };
    // Count misses in a row at this weight
    let misses = 0;
    for (let i = weeks.length - 1; i >= 0; i--) {
      const x = state.gym.log[weeks[i]][ex.id];
      if (x.hit || x.kg !== e.kg) break;
      misses++;
    }
    if (misses >= 2) return { kind: 'down', text: `${prefix}: drop to ${num(kg25(e.kg * 0.9))} kg` };
    return { kind: 'stay', text: `${prefix}: stay at ${num(e.kg)} kg` };
  }

  function kmSuggestion() {
    const weeks = Object.keys(state.gym.km).filter(k => k <= view && state.gym.km[k] > 0).sort();
    if (!weeks.length) return { kind: 'none', text: 'Log your km' };
    const last = weeks[weeks.length - 1];
    const km = state.gym.km[last];
    let streak = 0;
    for (let i = weeks.length - 1; i > 0; i--) {
      if (state.gym.km[weeks[i]] >= state.gym.km[weeks[i - 1]]) streak++; else break;
    }
    const prefix = last === view ? 'Next week' : 'This week';
    if (streak >= 3) return { kind: 'down', text: `${prefix}: easy week, ${Math.round(km * 0.8)} km` };
    return { kind: 'up', text: `${prefix}: up to ${Math.round(km * 1.1)} km` };
  }

  const lastWeeks = (n = 8) => Array.from({ length: n }, (_, i) => keyOf(addDays(parseKey(view), -7 * (n - 1 - i))));
  function bars(values, color) {
    const max = Math.max(...values, 1);
    return `<div class="bars" aria-hidden="true">${values.map((v, i) => `<i style="--h:${v ? Math.max(6, v / max * 100) : 0}%;--c:${color}"${i === values.length - 1 ? ' class="now"' : ''}></i>`).join('')}</div>`;
  }

  /* ---------- Rendering ---------- */
  function itemsHtml(ref, items, draggable = true) {
    return items.map(it => `<li class="item${it.done ? ' done' : ''}"${draggable ? ' draggable="true"' : ''} data-ref="${ref}" data-id="${it.id}">
        <input type="checkbox" class="tick" data-action="tick"${it.done ? ' checked' : ''} aria-label="Done: ${esc(it.text)}">
        <span class="text">${esc(it.text)}</span>
        <button class="del" data-action="del" aria-label="Delete ${esc(it.text)}">×</button>
      </li>`).join('');
  }

  function renderHeader() {
    const mon = parseKey(view), sun = addDays(mon, 6);
    $('#weekNo').textContent = isoWeek(mon);
    const same = mon.getMonth() === sun.getMonth();
    $('#range').textContent = `${fmt(mon, same ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${fmt(sun, { day: 'numeric', month: 'short' })}`;
    document.querySelector('[data-nav="0"]').disabled = view === thisMonday;
    document.title = `Week ${isoWeek(mon)}`;
  }

  function renderWeek() {
    $('#anyList').innerHTML = itemsHtml('anytime', state.anytime);
    $('#clearDone').hidden = !state.anytime.some(t => t.done);
    if (!selDay || !weekKeys().includes(selDay)) selDay = defaultDay();

    // Day picker for phones, with a dot per kind of plan that day
    $('#strip').innerHTML = weekKeys().map((k, i) => {
      const d = state.days[k];
      const open = d ? d.tasks.filter(t => !t.done).length : 0;
      const dots = [open ? 'task' : '', d && Object.values(d.meals).some(v => v && v.trim()) ? 'meal' : '', d && d.workouts.length ? 'train' : ''].filter(Boolean);
      return `<button role="tab" class="pill${k === selDay ? ' sel' : ''}${k === todayKey ? ' today' : ''}" data-pick-day="${k}" aria-selected="${k === selDay}">
        <span class="pill-day">${SHORT[i].slice(0, 1)}</span><span class="pill-date">${parseKey(k).getDate()}</span>
        <span class="dots">${dots.map(c => `<i class="d-${c}"></i>`).join('')}</span></button>`;
    }).join('');

    let h = '';
    weekKeys().forEach((k, i) => {
      const d = state.days[k] || { tasks: [], workouts: [], meals: {} };
      const cls = (k === todayKey ? ' today' : k < todayKey ? ' past' : '') + (k === selDay ? ' sel' : '');
      h += `<li class="day${cls}" data-day="${k}">
        <div class="day-head"><span class="day-name">${SHORT[i]}</span><span class="day-date">${k === todayKey ? 'Today' : fmt(parseKey(k), { day: 'numeric', month: 'short' })}</span></div>
        ${i === 0 ? `<div class="section s-shop" id="shopBox">${shopHtml()}</div>` : ''}
        <div class="section s-task">
          <ul class="list" data-drop="${k}|tasks">${itemsHtml(`${k}|tasks`, d.tasks)}</ul>
          <form class="add" data-add="${k}|tasks"><input name="text" maxlength="140" placeholder="Add task" aria-label="Add a task on ${SHORT[i]}"></form>
        </div>
        <div class="section s-meal">
          <span class="label">Meals</span>
          <div class="meal">${MEALS.map(([m, label]) => {
            const v = (d.meals || {})[m] || '';
            // On touch screens a tap opens a list of your meals instead of the keyboard
            if (touch) return `<button type="button" class="meal-btn${v ? ' set' : ''}${v && !findMeal(v) ? ' unknown' : ''}" data-pick-meal="${m}" data-day="${k}" aria-label="${label} on ${SHORT[i]}: ${esc(v || 'not planned')}">${v ? esc(v) : `<span>${label}</span>`}</button>`;
            return `<input list="mealOptions" data-meal="${m}" data-day="${k}" maxlength="60" placeholder="${label}" aria-label="${label} on ${SHORT[i]}" value="${esc(v)}"${v && !findMeal(v) ? ' class="unknown" title="Not in your meal list, so no ingredients"' : ''}>`;
          }).join('')}</div>
        </div>
        <div class="section s-train">
          <span class="label">Workout</span>
          <ul class="list" data-drop="${k}|workouts">${itemsHtml(`${k}|workouts`, d.workouts)}</ul>
          <form class="add" data-add="${k}|workouts"><input name="text" maxlength="140" placeholder="Add workout" aria-label="Add a workout on ${SHORT[i]}"></form>
        </div>
      </li>`;
    });
    $('#week').innerHTML = h;
  }

  function renderMeals() {
    $('#mealOptions').innerHTML = state.meals.map(m => `<option value="${esc(m.name)}"></option>`).join('');
    $('#mealList').innerHTML = state.meals.length
      ? [...state.meals].sort((a, b) => a.name.localeCompare(b.name)).map(m => `<li class="card meal-card">
          <div class="meal-top"><h3>${esc(m.name)}</h3>
            <span class="meal-actions"><button class="text-btn" data-action="edit-meal" data-id="${m.id}">Edit</button><button class="del show" data-action="del-meal" data-id="${m.id}" aria-label="Delete ${esc(m.name)}">×</button></span></div>
          ${m.ingredients.length ? `<p class="ings">${m.ingredients.map(esc).join(', ')}</p>` : ''}</li>`).join('')
      : '<li class="empty">Your meals show up here.</li>';
  }

  function renderGym() {
    const ex = state.gym.exercises;
    const log = state.gym.log[view] || {};
    $('#lifts').innerHTML = ex.length ? `<ul class="lift-list">${ex.map(e => {
      const cur = log[e.id] || {};
      const s = liftSuggestion(e);
      const hist = lastWeeks().map(k => (state.gym.log[k] && state.gym.log[k][e.id] && state.gym.log[k][e.id].kg) || 0);
      return `<li class="lift" data-ex="${e.id}">
        <div class="lift-name"><b>${esc(e.name)}</b><span>${e.sets} × ${e.reps}</span></div>
        ${bars(hist, 'var(--train)')}
        <label class="kg"><input type="number" min="0" step="0.5" inputmode="decimal" data-kg="${e.id}" value="${cur.kg || ''}" placeholder="–" aria-label="${esc(e.name)} kg this week"> kg</label>
        <button class="hit${cur.hit ? ' on' : ''}" data-action="hit" data-id="${e.id}" aria-pressed="${!!cur.hit}" title="All sets and reps done"${cur.kg ? '' : ' disabled'}>All reps</button>
        <span class="sugg ${s.kind}">${s.text}</span>
        <button class="del" data-action="del-ex" data-id="${e.id}" aria-label="Delete ${esc(e.name)}">×</button>
      </li>`;
    }).join('')}</ul>` : '<p class="empty">Add the exercises you do.</p>';

    const km = state.gym.km[view] || '';
    const s = kmSuggestion();
    const hist = lastWeeks().map(k => state.gym.km[k] || 0);
    $('#running').innerHTML = `<div class="run">
        <label class="kg big"><input type="number" min="0" step="0.5" inputmode="decimal" id="kmInput" value="${km}" placeholder="–" aria-label="Km this week"> km this week</label>
        <span class="sugg ${s.kind}">${s.text}</span>
      </div>
      ${bars(hist, 'var(--train)')}
      <div class="bar-axis" aria-hidden="true">${lastWeeks().map(k => `<span>${isoWeek(parseKey(k))}</span>`).join('')}</div>`;
  }

  function renderStats() {
    let t = 0, td = 0, w = 0, wd = 0, m = 0;
    for (const k of weekKeys()) {
      const d = state.days[k];
      if (!d) continue;
      t += d.tasks.length; td += d.tasks.filter(x => x.done).length;
      w += d.workouts.length; wd += d.workouts.filter(x => x.done).length;
      m += Object.values(d.meals || {}).filter(v => v && v.trim()).length;
    }
    const ring = (done, total, color, label) =>
      `<span class="stat" title="${label}"><span class="ring" style="--p:${total ? Math.round(done / total * 100) : 0};--c:${color}" aria-hidden="true"></span><b>${done}/${total}</b> ${label}</span>`;
    $('#stats').innerHTML = ring(td, t, 'var(--task)', 'tasks') + ring(m, 21, 'var(--meal)', 'meals') + ring(wd, w, 'var(--train)', 'workouts');
  }

  function render() {
    renderHeader(); renderWeek(); renderMeals(); renderGym(); renderStats();
  }

  function setTab(name) {
    tab = ['week', 'anytime', 'meals', 'gym'].includes(name) ? name : 'week';
    if (tab === 'anytime' && !isPhone()) tab = 'week'; // Anytime sits beside the week on bigger screens
    const viewName = tab === 'anytime' ? 'week' : tab;
    document.body.dataset.tab = tab;
    document.querySelectorAll('.tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === viewName));
    document.querySelectorAll('.bottombar [data-tab]').forEach(b => {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${viewName}`; });
    $('#stats').hidden = viewName !== 'week';
    try { localStorage.setItem(KEY + '.tab', tab); } catch (e) { /* ignore */ }
  }

  /* ---------- Bottom sheet (tap menus) ---------- */
  let sheetCtx = null;
  function openSheet(html, ctx) {
    sheetCtx = ctx;
    $('#sheetBody').innerHTML = html;
    const s = $('#sheet');
    if (!s.open) s.showModal();
  }
  function closeSheet() {
    const s = $('#sheet');
    if (s.open) s.close();
    sheetCtx = null;
  }

  function openTaskSheet(ref, id) {
    const arr = list(ref);
    const it = arr.find(x => x.id === id);
    if (!it) return;
    const kind = kindOf(ref);
    const here = ref === 'anytime' ? 'anytime' : ref.split('|')[0];
    const targets = kind === 'shop' ? [] : [...(kind === 'task' ? [['anytime', 'Anytime']] : []), ...weekKeys().map((k, i) => [k, SHORT[i]])];
    openSheet(`<p class="sheet-title" id="sheetTitle">${kind === 'workout' ? 'Workout' : kind === 'shop' ? 'Shopping item' : 'Task'}</p>
      <form class="sheet-edit" data-sheet-form="text"><input class="field" name="text" maxlength="140" value="${esc(it.text)}" aria-label="Text" enterkeyhint="done"><button class="btn">Save</button></form>
      ${targets.length ? `<p class="sheet-label">Move to</p><div class="move-grid">${targets.map(([k, label]) =>
        `<button type="button" class="move${k === here ? ' here' : ''}${k === 'anytime' ? ' wide' : ''}" data-sheet="move" data-to="${k}"${k === here ? ' disabled' : ''}>${label}</button>`).join('')}</div>` : ''}
      <div class="sheet-foot"><button type="button" class="danger" data-sheet="delete">Delete</button><button type="button" class="text-btn" data-sheet="close">Close</button></div>`,
      { type: 'task', ref, id, kind });
  }

  function openMealSheet(k, meal) {
    const d = day(k);
    const cur = d.meals[meal] || '';
    const label = MEALS.find(x => x[0] === meal)[1];
    const meals = [...state.meals].sort((a, b) => a.name.localeCompare(b.name));
    openSheet(`<p class="sheet-title" id="sheetTitle">${label}, ${fmt(parseKey(k), { weekday: 'long' })}</p>
      ${meals.length ? `<div class="pick-list">${meals.map(m => `<button type="button" class="pick${norm(m.name) === norm(cur) ? ' here' : ''}" data-sheet="pick" data-name="${esc(m.name)}">${esc(m.name)}</button>`).join('')}</div>`
        : '<p class="hint">Add meals in the Meals tab to pick them here.</p>'}
      <form class="sheet-edit" data-sheet-form="meal"><input class="field" name="text" maxlength="60" placeholder="Something else" value="${cur && !findMeal(cur) ? esc(cur) : ''}" aria-label="Something else" enterkeyhint="done"><button class="btn">Save</button></form>
      <div class="sheet-foot">${cur ? '<button type="button" class="danger" data-sheet="clear">Clear</button>' : '<span></span>'}<button type="button" class="text-btn" data-sheet="close">Close</button></div>`,
      { type: 'meal', day: k, meal });
  }

  function setMeal(k, meal, value) {
    const m = findMeal(value);
    day(k).meals[meal] = m ? m.name : value.trim();
    save(); closeSheet(); renderWeek(); renderStats();
  }

  $('#sheet').addEventListener('click', e => {
    if (e.target === $('#sheet')) { closeSheet(); return; } // tap outside the sheet
    const b = e.target.closest('[data-sheet]');
    if (!b || !sheetCtx) return;
    const c = sheetCtx;
    const act = b.dataset.sheet;
    if (act === 'close') { closeSheet(); return; }
    if (c.type === 'meal') {
      if (act === 'pick') setMeal(c.day, c.meal, b.dataset.name);
      if (act === 'clear') setMeal(c.day, c.meal, '');
      return;
    }
    const from = list(c.ref);
    const idx = from.findIndex(x => x.id === c.id);
    if (idx < 0) { closeSheet(); return; }
    if (act === 'delete') from.splice(idx, 1);
    if (act === 'move') {
      const [item] = from.splice(idx, 1);
      const to = b.dataset.to === 'anytime' ? 'anytime' : `${b.dataset.to}|${c.kind === 'workout' ? 'workouts' : 'tasks'}`;
      list(to).push(item);
      toast(`Moved to ${b.textContent}`);
    }
    save(); closeSheet();
    if (c.kind === 'shop') renderShop(); else { renderWeek(); renderStats(); }
  });

  $('#sheet').addEventListener('submit', e => {
    e.preventDefault();
    e.stopPropagation();
    const c = sheetCtx;
    if (!c) return;
    const text = e.target.elements.text.value.trim();
    if (c.type === 'meal') { if (text) setMeal(c.day, c.meal, text); return; }
    const arr = list(c.ref);
    const it = arr.find(x => x.id === c.id);
    if (it && text) it.text = text;
    save(); closeSheet();
    if (c.kind === 'shop') renderShop(); else renderWeek();
  });
  $('#sheet').addEventListener('close', () => { sheetCtx = null; });

  /* ---------- Task actions ---------- */
  function find(el) {
    const li = el.closest('.item');
    const arr = list(li.dataset.ref);
    return { arr, idx: arr.findIndex(x => x.id === li.dataset.id) };
  }

  /* ---------- Meal list actions ---------- */
  function resetMealForm() {
    const f = $('#mealForm');
    f.reset();
    f.elements.id.value = '';
    $('#mealFormTitle').textContent = 'New meal';
    $('#cancelMeal').hidden = true;
  }
  function saveMeal(f) {
    const name = f.elements.name.value.trim();
    if (!name) return;
    const ingredients = f.elements.ingredients.value.split(/\n|,/).map(s => s.trim()).filter(Boolean);
    const id = f.elements.id.value;
    const clash = state.meals.find(m => norm(m.name) === norm(name) && m.id !== id);
    if (clash) { toast(`${name} is already in your list.`); return; }
    if (id) {
      const m = state.meals.find(x => x.id === id);
      // Keep planned meals pointing to the renamed meal
      if (m && norm(m.name) !== norm(name)) {
        for (const d of Object.values(state.days)) for (const [k] of MEALS) if (norm(d.meals[k]) === norm(m.name)) d.meals[k] = name;
      }
      Object.assign(m, { name, ingredients });
    } else {
      state.meals.push({ id: uid(), name, ingredients });
    }
    save(); resetMealForm(); render();
    toast(id ? 'Meal updated.' : 'Meal saved.');
  }

  /* ---------- Events ---------- */
  document.addEventListener('submit', e => {
    const f = e.target;
    e.preventDefault();
    // Compare elements: the meal form has a field named "id", which hides form.id
    if (f === $('#mealForm')) { saveMeal(f); return; }
    if (f === $('#exForm')) {
      const name = f.elements.name.value.trim();
      if (!name) return;
      state.gym.exercises.push({
        id: uid(), name,
        sets: Math.max(1, Math.round(+f.elements.sets.value) || 3),
        reps: Math.max(1, Math.round(+f.elements.reps.value) || 8),
        step: Math.max(0.5, +f.elements.step.value || 2.5)
      });
      f.elements.name.value = '';
      save(); renderGym();
      $('#exForm').elements.name.focus();
      return;
    }
    if (!f.matches('form.add')) return;
    const text = f.elements.text.value.trim();
    if (!text) return;
    const ref = f.dataset.add;
    list(ref).push({ id: uid(), text, done: false });
    f.elements.text.value = '';
    save();
    if (kindOf(ref) === 'shop') { shopOpen = true; renderShop(); } else { renderWeek(); renderStats(); }
    const again = document.querySelector(`form.add[data-add="${ref}"] input`);
    if (again) again.focus();
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.action === 'tick') {
      const { arr, idx } = find(el);
      if (idx >= 0) arr[idx].done = el.checked;
      save();
      if (el.closest('.shop')) renderShop(); else { renderWeek(); renderStats(); }
    } else if (el.dataset.action === 'shoptick') {
      shopWeek(view).checked[el.dataset.key] = el.checked;
      save(); renderShop();
    } else if (el.dataset.meal) {
      // Use the meal list's spelling, mark meals with no ingredients, and update the shopping list
      const meal = findMeal(el.value);
      if (meal && el.value !== meal.name) { el.value = meal.name; day(el.dataset.day).meals[el.dataset.meal] = meal.name; save(); }
      el.classList.toggle('unknown', !!el.value.trim() && !meal);
      renderShop();
    } else if (el.dataset.kg) {
      const log = state.gym.log[view] = state.gym.log[view] || {};
      const v = Math.max(0, +el.value || 0);
      if (v) log[el.dataset.kg] = { kg: v, hit: (log[el.dataset.kg] || {}).hit || false };
      else delete log[el.dataset.kg];
      save(); renderGym();
    } else if (el.id === 'kmInput') {
      const v = Math.max(0, +el.value || 0);
      if (v) state.gym.km[view] = v; else delete state.gym.km[view];
      save(); renderGym();
    }
  });

  document.addEventListener('toggle', e => {
    if (e.target.classList && e.target.classList.contains('shop')) shopOpen = e.target.open;
  }, true);

  document.addEventListener('click', e => {
    const tabBtn = e.target.closest('button[data-tab]');
    if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const n = +nav.dataset.nav;
      view = n === 0 ? thisMonday : keyOf(addDays(parseKey(view), 7 * n));
      selDay = defaultDay();
      render();
      return;
    }
    const pill = e.target.closest('[data-pick-day]');
    if (pill) { selDay = pill.dataset.pickDay; renderWeek(); return; }
    const mealBtn = e.target.closest('[data-pick-meal]');
    if (mealBtn) { openMealSheet(mealBtn.dataset.day, mealBtn.dataset.pickMeal); return; }
    // Tap a task, workout or shopping item to edit, move or delete it
    const text = e.target.closest('.item[data-ref] .text');
    if (text) { const li = text.closest('.item'); openTaskSheet(li.dataset.ref, li.dataset.id); return; }
    const el = e.target.closest('[data-action]');
    if (!el || el.matches('input')) return;
    switch (el.dataset.action) {
      case 'del': {
        const { arr, idx } = find(el);
        if (idx >= 0) arr.splice(idx, 1);
        save();
        if (el.closest('.shop')) renderShop(); else { renderWeek(); renderStats(); }
        return;
      }
      case 'clear-done':
        state.anytime = state.anytime.filter(t => !t.done);
        save(); renderWeek();
        return;
      case 'edit-meal': {
        const m = state.meals.find(x => x.id === el.dataset.id);
        if (!m) return;
        const f = $('#mealForm');
        f.elements.id.value = m.id;
        f.elements.name.value = m.name;
        f.elements.ingredients.value = m.ingredients.join('\n');
        $('#mealFormTitle').textContent = 'Edit meal';
        $('#cancelMeal').hidden = false;
        f.elements.name.focus();
        return;
      }
      case 'cancel-meal': resetMealForm(); return;
      case 'del-meal': {
        const m = state.meals.find(x => x.id === el.dataset.id);
        if (!m || !confirm(`Delete ${m.name}?`)) return;
        state.meals = state.meals.filter(x => x.id !== m.id);
        save(); render();
        return;
      }
      case 'hit': {
        const log = state.gym.log[view] = state.gym.log[view] || {};
        const entry = log[el.dataset.id];
        if (!entry) return;
        entry.hit = !entry.hit;
        save(); renderGym();
        return;
      }
      case 'del-ex': {
        const ex = state.gym.exercises.find(x => x.id === el.dataset.id);
        if (!ex || !confirm(`Delete ${ex.name} and its history?`)) return;
        state.gym.exercises = state.gym.exercises.filter(x => x.id !== ex.id);
        for (const w of Object.values(state.gym.log)) delete w[ex.id];
        save(); renderGym();
        return;
      }
    }
  });

  // Meals save as you type, without redrawing the page
  let mealTimer;
  document.addEventListener('input', e => {
    const m = e.target.dataset.meal;
    if (!m) return;
    day(e.target.dataset.day).meals[m] = e.target.value;
    clearTimeout(mealTimer);
    mealTimer = setTimeout(() => { save(); renderStats(); }, 250);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.dataset.meal || e.target.dataset.kg || e.target.id === 'kmInput')) e.target.blur();
  });

  /* ---------- Drag and drop: move tasks between days and Anytime ---------- */
  let dragging = null;
  document.addEventListener('dragstart', e => {
    const li = e.target.closest && e.target.closest('.item[draggable="true"]');
    if (!li) return;
    dragging = { ref: li.dataset.ref, id: li.dataset.id, kind: kindOf(li.dataset.ref) };
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.dataset.id);
  });
  document.addEventListener('dragend', () => {
    dragging = null;
    document.querySelectorAll('.dragging, .over').forEach(x => x.classList.remove('dragging', 'over'));
  });
  const dropTarget = e => {
    if (!dragging) return null;
    const zone = e.target.closest && e.target.closest('[data-drop], .s-task, .s-train, .anytime');
    if (!zone) return null;
    const listEl = zone.matches('[data-drop]') ? zone : zone.querySelector('[data-drop]');
    if (!listEl || kindOf(listEl.dataset.drop) !== dragging.kind) return null;
    return listEl;
  };
  document.addEventListener('dragover', e => {
    const t = dropTarget(e);
    document.querySelectorAll('.over').forEach(x => { if (x !== t) x.classList.remove('over'); });
    if (!t) return;
    e.preventDefault();
    t.classList.add('over');
  });
  document.addEventListener('drop', e => {
    const t = dropTarget(e);
    if (!t) return;
    e.preventDefault();
    const from = list(dragging.ref);
    const idx = from.findIndex(x => x.id === dragging.id);
    if (idx < 0) return;
    const [item] = from.splice(idx, 1);
    const to = list(t.dataset.drop);
    const overLi = e.target.closest('.item');
    const at = overLi && overLi.parentElement === t ? to.findIndex(x => x.id === overLi.dataset.id) : -1;
    if (at >= 0) to.splice(at, 0, item); else to.push(item);
    dragging = null;
    save(); renderWeek(); renderStats();
  });

  /* ---------- Swipe between days on phones ---------- */
  let swipe = null;
  $('#week').addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('input, textarea, button')) { swipe = null; return; }
    swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  $('#week').addEventListener('touchend', e => {
    if (!swipe || !isPhone()) return;
    const dx = e.changedTouches[0].clientX - swipe.x, dy = e.changedTouches[0].clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const keys = weekKeys();
    const i = keys.indexOf(selDay) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < 7) { selDay = keys[i]; renderWeek(); }
    else { // past Sunday or before Monday: change week
      view = keyOf(addDays(parseKey(view), dx < 0 ? 7 : -7));
      selDay = dx < 0 ? view : keyOf(addDays(parseKey(view), 6));
      render();
    }
  }, { passive: true });

  window.matchMedia('(max-width: 700px)').addEventListener('change', () => setTab(tab));

  /* ---------- Start ---------- */
  render();
  setTab(tab);
})();
