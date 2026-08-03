import { isConfigured, select } from './lib/supabase.js';
import { buildStats, generateGames, rankTicket, createAISnapshot } from './lib/stats.js';

const qs = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
const ball = (number) => `<span class="ball b${Math.ceil(number / 10)}">${number}</span>`;
const STORAGE_SAVED = 'lotto-saved-numbers-v2';
const STORAGE_PURCHASED = 'lotto-purchased-tickets-v2';
const AI_COOLDOWN_KEY = 'lotto-ai-cooldown-until';
const AI_CACHE_KEY = 'lotto-ai-last-result-v2';
const CLIENT_ID_KEY = 'lotto-client-id-v1';
function clientId(){let id=localStorage.getItem(CLIENT_ID_KEY);if(!id){id=crypto.randomUUID();localStorage.setItem(CLIENT_ID_KEY,id)}return id;}

let state = {
  draws: [],
  statGames: [],
  aiGames: [],
  aiScenario: '',
  aiMessage: '',
  savedNumbers: [],
  purchases: [],
  page: 'recommend',
  count: 5,
  fixed: [],
  mode: 'statistics',
  loading: false
};

async function readJsonResponse(response) {
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { data = { error: raw || `서버 응답을 읽지 못했습니다. (${response.status})` }; }
  return data;
}

async function loadDraws() {
  const response = await fetch('/data/lotto.json');
  if (!response.ok) throw new Error('기본 로또 데이터를 불러오지 못했습니다.');
  const raw = await response.json();
  const merged = new Map(raw.map((item) => [Number(item.draw_no), {
    draw_no: Number(item.draw_no),
    draw_date: String(item.date || item.draw_date || '').slice(0, 10),
    numbers: (item.numbers || []).map(Number).sort((a, b) => a - b),
    bonus_no: Number(item.bonus_no)
  }]));

  if (isConfigured) {
    try {
      const remote = await select('lotto_draws', 'select=draw_no,draw_date,numbers,bonus_no&order=draw_no.asc') || [];
      for (const row of remote) {
        merged.set(Number(row.draw_no), {
          ...row,
          draw_no: Number(row.draw_no),
          numbers: (row.numbers || []).map(Number).sort((a, b) => a - b),
          bonus_no: Number(row.bonus_no)
        });
      }
    } catch (error) {
      console.warn('Supabase 회차 데이터 로딩 실패:', error);
    }
  }
  state.draws = [...merged.values()].sort((a, b) => a.draw_no - b.draw_no);
}

function normalizeTicket(row) {
  return {
    ...row,
    numbers: (row.numbers || []).map(Number).sort((a, b) => a - b),
    target_draw_no: row.target_draw_no ? Number(row.target_draw_no) : null,
    ticket_type: row.ticket_type || 'saved'
  };
}

function mergeTickets(localRows, remoteRows) {
  const merged = new Map();
  for (const row of [...localRows, ...remoteRows]) {
    const ticket = normalizeTicket(row);
    const key = String(ticket.id || `${ticket.ticket_type}:${ticket.target_draw_no || ''}:${ticket.numbers.join('-')}:${ticket.created_at || ''}`);
    merged.set(key, ticket);
  }
  return [...merged.values()].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

async function loadTickets() {
  const localSaved = JSON.parse(localStorage.getItem(STORAGE_SAVED) || '[]').map(normalizeTicket);
  const localPurchased = JSON.parse(localStorage.getItem(STORAGE_PURCHASED) || '[]').map(normalizeTicket);
  try {
    const response = await fetch(`/api/tickets?client_id=${encodeURIComponent(clientId())}`);
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || '저장번호 동기화 실패');
    const rows = (data.items || []).map(normalizeTicket);
    const remoteSaved = rows.filter(r => (r.ticket_type || 'saved') === 'saved');
    const remotePurchased = rows.filter(r => r.ticket_type === 'purchased');
    state.savedNumbers = mergeTickets(localSaved, remoteSaved);
    state.purchases = mergeTickets(localPurchased, remotePurchased);
    localStorage.setItem(STORAGE_SAVED, JSON.stringify(state.savedNumbers));
    localStorage.setItem(STORAGE_PURCHASED, JSON.stringify(state.purchases));
  } catch (error) {
    console.warn('저장번호 동기화 실패:', error);
    state.savedNumbers = localSaved;
    state.purchases = localPurchased;
  }
}
const nav = () => `<nav>${[
  ['recommend', '번호추천'],
  ['stats', '통계'],
  ['saved', '내 번호'],
  ['purchases', '내 구매'],
  ['admin', '관리자']
].map(([key, label]) => `<button type="button" data-page="${key}" class="${state.page === key ? 'active' : ''}">${label}</button>`).join('')}</nav>`;

function header() {
  const latest = state.draws.at(-1);
  return `<header><div><p class="eyebrow">LOTTO 6/45</p><h1>데이터·AI 번호 추천기</h1><p>통계 모델과 Gemini의 조건부 예측 시나리오를 비교합니다.</p></div><div class="latest"><small>최신 데이터</small><strong>${latest?.draw_no || '-'}회</strong><span>${latest?.draw_date || ''}</span></div></header>`;
}

function modeControl() {
  return `<div class="segmented" role="radiogroup">${[
    ['statistics', '📊 통계 추천'],
    ['ai', '🤖 Gemini AI'],
    ['both', '🔀 둘 다']
  ].map(([key, label]) => `<button type="button" data-mode="${key}" class="${state.mode === key ? 'active' : ''}">${label}</button>`).join('')}</div>`;
}

function gameCard(game, index, type) {
  const numbers = game.numbers.join(',');
  return `<div class="gameCard ${type}">
    <div class="game">
      <b>${type === 'ai' ? 'AI' : '통계'} ${index + 1}게임</b>
      <div>${game.numbers.map(ball).join('')}</div>
      <div class="gameActions">
        <button type="button" data-save-numbers="${numbers}">♡ 내 번호 저장</button>
        <button type="button" data-purchase-numbers="${numbers}">✓ 구매 등록</button>
      </div>
    </div>
    ${type === 'statistics'
      ? `<div class="gameMeta"><strong>추천지수 ${game.score}점</strong></div>`
      : `<div class="aiReason"><strong>Gemini 선택 이유</strong><p>${esc(game.reason)}</p></div>`}
  </div>`;
}

function recommendPage() {
  const fixed = Array.from({ length: 45 }, (_, index) => index + 1)
    .map((number) => `<button type="button" class="pick ${state.fixed.includes(number) ? 'on' : ''}" data-fixed="${number}">${number}</button>`)
    .join('');
  const showStat = state.mode !== 'ai';
  const showAI = state.mode !== 'statistics';

  return `<section class="grid">
    <article class="card controls">
      <h2>추천 방식</h2>${modeControl()}
      <label>게임 수 <b id="countLabel">${state.count}</b><input id="count" type="range" min="1" max="10" value="${state.count}"></label>
      <details><summary>고정 번호 선택 (${state.fixed.length}/5)</summary><div class="picker">${fixed}</div></details>
      <button type="button" class="primary" id="generate" ${state.loading ? 'disabled' : ''}>${state.loading ? '분석 중…' : '번호 생성'}</button>
      <p class="hint">Gemini는 한 번의 API 요청으로 모든 게임과 이유를 생성합니다. 무료 한도를 넘으면 안내만 표시되고 통계 추천과 저장 기능은 계속 사용할 수 있습니다.</p>
    </article>
    <article class="card results">
      <div class="titleRow"><h2>추천 결과</h2></div>
      ${state.aiMessage ? `<div class="aiNotice">${esc(state.aiMessage)}</div>` : ''}
      ${state.loading ? '<div class="loading"><span></span><b>통계와 시간 흐름을 분석하고 있습니다…</b></div>' : ''}
      ${showStat && state.statGames.length ? `<h3 class="sectionTitle">📊 통계 모델</h3>${state.statGames.map((game, index) => gameCard(game, index, 'statistics')).join('')}` : ''}
      ${showAI && state.aiGames.length ? `<h3 class="sectionTitle">🤖 Gemini AI</h3>${state.aiScenario ? `<div class="scenario"><strong>예측 시나리오</strong><p>${esc(state.aiScenario)}</p></div>` : ''}${state.aiGames.map((game, index) => gameCard(game, index, 'ai')).join('')}` : ''}
      ${!state.loading && !state.statGames.length && !state.aiGames.length ? '<div class="empty">추천 방식을 고르고 번호를 생성해보세요.</div>' : ''}
    </article>
  </section>`;
}

function statsPage() {
  const stats = buildStats(state.draws);
  const rows = Array.from({ length: 45 }, (_, index) => index + 1)
    .map((number) => ({ number, total: stats.total[number], recent: stats.recent50[number], overdue: stats.overdue[number] }))
    .sort((a, b) => b.total - a.total);
  return `<section class="card"><h2>번호 통계</h2><p class="hint">총 ${state.draws.length}개 회차 기준 · 최근 50회 포함</p><div class="tableWrap"><table><thead><tr><th>번호</th><th>전체 출현</th><th>최근 50회</th><th>미출현</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${ball(row.number)}</td><td>${row.total}회</td><td>${row.recent}회</td><td>${row.overdue}회차</td></tr>`).join('')}</tbody></table></div></section>`;
}

function savedPage() {
  return `<section class="card"><div class="titleRow"><div><h2>내 번호</h2><p class="hint">마음에 들지만 아직 구매하지 않은 번호를 보관합니다.</p></div><button type="button" id="manualSaved">직접 추가</button></div>${state.savedNumbers.length ? state.savedNumbers.map((ticket) => `<div class="ticket"><div><strong>${esc(ticket.label || '저장 번호')}</strong><small>${String(ticket.created_at || '').slice(0, 10) || '저장됨'}</small></div><div>${ticket.numbers.map(ball).join('')}</div><div class="ticketActions"><button type="button" data-buy-saved="${ticket.id}">구매 등록</button><button type="button" class="danger" data-delete-saved="${ticket.id}">삭제</button></div></div>`).join('') : '<div class="empty">보관한 번호가 없습니다.</div>'}</section>`;
}

function purchaseResult(ticket) {
  const draw = state.draws.find((item) => item.draw_no === Number(ticket.target_draw_no));
  const result = rankTicket(ticket.numbers, draw);
  const detail = !draw ? '추첨 전' : result.label === '낙첨' ? `${result.hits}개 일치 · 낙첨` : `${result.hits}개 일치${result.bonus ? ' + 보너스' : ''} · ${result.label}`;
  return { draw, result, detail };
}

function purchasesPage() {
  return `<section class="card"><div class="titleRow"><div><h2>내 구매</h2><p class="hint">실제로 구매한 번호를 회차별로 기록하고 당첨 결과를 자동 확인합니다.</p></div><button type="button" id="manualPurchase">직접 구매 등록</button></div>${state.purchases.length ? state.purchases.map((ticket) => {
    const { result, detail } = purchaseResult(ticket);
    return `<div class="ticket purchase ${result.label !== '추첨 전' ? (result.label === '낙첨' ? 'lost' : 'won') : ''}"><div><strong>${ticket.target_draw_no}회 · ${esc(ticket.label || '구매 번호')}</strong><small>${detail}</small></div><div>${ticket.numbers.map(ball).join('')}</div><div class="ticketActions"><span class="resultBadge">${result.label}</span><button type="button" class="danger" data-delete-purchase="${ticket.id}">삭제</button></div></div>`;
  }).join('') : '<div class="empty">구매 등록한 번호가 없습니다.</div>'}</section>`;
}

function adminPage() {
  const next = (state.draws.at(-1)?.draw_no || 0) + 1;
  return `<section class="grid"><article class="card"><h2>최신 회차 수동 입력</h2><form id="manualDraw"><label>관리 비밀번호<input name="secret" type="password" required></label><label>회차<input name="draw_no" type="number" value="${next}" required></label><label>추첨일<input name="draw_date" type="date" required></label><label>당첨번호 6개<input name="numbers" placeholder="예: 1, 7, 15, 22, 31, 43" required></label><label>보너스번호<input name="bonus_no" type="number" min="1" max="45" required></label><button class="primary">Supabase에 저장·업데이트</button></form></article><article class="card"><h2>외부 데이터 동기화</h2><form id="sync"><label>관리 비밀번호<input name="secret" type="password" required></label><button>GitHub 전체 데이터 동기화</button></form><div id="adminMessage" class="message"></div></article></section>`;
}

function render() {
  const page = state.page === 'recommend' ? recommendPage()
    : state.page === 'stats' ? statsPage()
    : state.page === 'saved' ? savedPage()
    : state.page === 'purchases' ? purchasesPage()
    : adminPage();
  qs('#root').innerHTML = `<main>${header()}${nav()}${page}<footer>추천은 과거 데이터 기반 분석·추론이며 실제 당첨 확률을 높인다는 뜻이 아닙니다.</footer></main>`;
  bindForms();
}

function bindForms() {
  const count = qs('#count');
  if (count) count.oninput = (event) => {
    state.count = Number(event.target.value);
    qs('#countLabel').textContent = state.count;
  };
  const manualDrawForm = qs('#manualDraw');
  if (manualDrawForm) manualDrawForm.onsubmit = manualDraw;
  const syncForm = qs('#sync');
  if (syncForm) syncForm.onsubmit = syncDraws;
}

function aiCacheKey() {
  return `${state.draws.at(-1)?.draw_no || 0}|${state.count}|${[...state.fixed].sort((a, b) => a - b).join('-')}`;
}

function getCachedAI() {
  try {
    const cache = JSON.parse(localStorage.getItem(AI_CACHE_KEY) || 'null');
    if (!cache || cache.key !== aiCacheKey() || Date.now() - cache.savedAt > 30 * 1000) return null;
    return cache.value;
  } catch { return null; }
}

function setCachedAI(value) {
  localStorage.setItem(AI_CACHE_KEY, JSON.stringify({ key: aiCacheKey(), savedAt: Date.now(), value }));
}

async function generate() {
  state.loading = true;
  state.statGames = [];
  state.aiGames = [];
  state.aiScenario = '';
  state.aiMessage = '';
  render();

  try {
    if (state.mode !== 'ai') state.statGames = generateGames(state.draws, state.count, state.fixed);

    if (state.mode !== 'statistics') {
      const cooldownUntil = Number(localStorage.getItem(AI_COOLDOWN_KEY) || 0);
      if (cooldownUntil > Date.now()) {
        const seconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
        throw new Error(`Gemini 무료 요청 한도 대기 중입니다. 약 ${seconds}초 후 다시 시도해주세요.`);
      }

      const cached = getCachedAI();
      if (cached) {
        state.aiGames = cached.games;
        state.aiScenario = cached.scenario;
        state.aiMessage = '같은 조건의 최근 Gemini 결과입니다. Gemini AI는 30초마다 새로 생성할 수 있습니다.';
      } else {
        const candidates = generateGames(state.draws, Math.min(40, Math.max(20, state.count * 5)), state.fixed)
          .map((game) => ({ numbers: game.numbers, score: game.score }));
        const response = await fetch('/api/gemini-recommend', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ count: state.count, fixed: state.fixed, snapshot: createAISnapshot(state.draws), candidates })
        });
        const data = await readJsonResponse(response);
        if (response.status === 429 || data.code === 'QUOTA_EXCEEDED') {
          const retryAfter = Math.max(1, Number(data.retryAfter) || 60);
          localStorage.setItem(AI_COOLDOWN_KEY, String(Date.now() + retryAfter * 1000));
          throw new Error(`Gemini 무료 요청 한도를 모두 사용했습니다. 약 ${retryAfter}초 후 다시 시도해주세요. 통계 추천은 계속 사용할 수 있습니다.`);
        }
        if (!response.ok) throw new Error(data.error || 'Gemini 추천에 실패했습니다.');
        if (!Array.isArray(data.games) || data.games.length !== state.count) throw new Error('Gemini 결과가 완성되지 않았습니다. 다시 시도해주세요.');
        state.aiGames = data.games;
        state.aiScenario = data.scenario;
        setCachedAI({ games: data.games, scenario: data.scenario });
      }
    }
  } catch (error) {
    state.aiMessage = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function persistTicket({ numbers, label, targetDrawNo = null, ticketType }) {
  const row = { id: crypto.randomUUID(), label, target_draw_no: targetDrawNo, numbers: [...numbers].map(Number).sort((a,b)=>a-b), ticket_type: ticketType, created_at: new Date().toISOString() };
  const key = ticketType === 'purchased' ? STORAGE_PURCHASED : STORAGE_SAVED;
  const list = ticketType === 'purchased' ? state.purchases : state.savedNumbers;
  list.unshift(row); localStorage.setItem(key, JSON.stringify(list)); render();
  const response = await fetch('/api/tickets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...row,client_id:clientId()})});
  const data = await readJsonResponse(response);
  if(!response.ok) throw new Error(data.error || 'Supabase 동기화 실패');
  if (data.item) {
    const synced = normalizeTicket(data.item);
    const current = ticketType === 'purchased' ? state.purchases : state.savedNumbers;
    const replaced = current.map((item) => String(item.id) === String(row.id) ? synced : item);
    if (ticketType === 'purchased') state.purchases = replaced; else state.savedNumbers = replaced;
    localStorage.setItem(key, JSON.stringify(replaced));
  }
}
async function saveNumber(numbers) {
  const label = prompt('저장할 번호의 이름이나 메모를 입력하세요.', '마음에 드는 번호');
  if (label === null) return;
  try {
    await persistTicket({ numbers, label: label.trim() || '마음에 드는 번호', ticketType: 'saved' });
    state.page = 'saved';
    render();
  } catch (error) { state.page='saved'; render(); alert(`번호는 이 브라우저에 저장됐습니다. Supabase 동기화만 실패했습니다: ${error.message}`); }
}

async function registerPurchase(numbers, defaultLabel = '구매 번호') {
  const defaultDraw = String((state.draws.at(-1)?.draw_no || 0) + 1);
  const drawText = prompt('실제로 구매한 대상 회차를 입력하세요.', defaultDraw);
  if (drawText === null) return;
  const targetDrawNo = Number(drawText);
  if (!Number.isInteger(targetDrawNo) || targetDrawNo <= 0) return alert('올바른 회차를 입력하세요.');
  const label = prompt('구매 기록 메모를 입력하세요.', defaultLabel);
  if (label === null) return;
  try {
    await persistTicket({ numbers, label: label.trim() || defaultLabel, targetDrawNo, ticketType: 'purchased' });
    state.page = 'purchases';
    render();
  } catch (error) { state.page='purchases'; render(); alert(`구매번호는 이 브라우저에 저장됐습니다. Supabase 동기화만 실패했습니다: ${error.message}`); }
}

async function deleteRecord(id, ticketType) {
  if (!confirm('삭제할까요?')) return;
  const key = ticketType === 'purchased' ? STORAGE_PURCHASED : STORAGE_SAVED;
  const list = (ticketType === 'purchased' ? state.purchases : state.savedNumbers).filter(item => String(item.id)!==String(id));
  localStorage.setItem(key, JSON.stringify(list));
  if(ticketType==='purchased') state.purchases=list; else state.savedNumbers=list;
  render();
  try{await fetch(`/api/tickets?id=${encodeURIComponent(id)}&client_id=${encodeURIComponent(clientId())}`,{method:'DELETE'});}catch{}
}
function askNumbers() {
  const raw = prompt('번호 6개를 쉼표로 입력하세요.', '1, 7, 15, 22, 31, 43');
  if (!raw) return null;
  const numbers = raw.split(/[ ,]+/).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (numbers.length !== 6 || new Set(numbers).size !== 6 || numbers.some((number) => number < 1 || number > 45)) {
    alert('1~45의 서로 다른 번호 6개를 입력하세요.');
    return null;
  }
  return numbers;
}

async function manualDraw(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const numbers = String(form.get('numbers')).split(/[ ,]+/).map(Number).filter(Number.isFinite);
  const body = {
    secret: form.get('secret'),
    draw_no: Number(form.get('draw_no')),
    draw_date: form.get('draw_date'),
    numbers,
    bonus_no: Number(form.get('bonus_no'))
  };
  if (numbers.length !== 6 || new Set(numbers).size !== 6 || numbers.some((number) => number < 1 || number > 45)) return alert('당첨번호 6개를 정확히 입력하세요.');
  if (numbers.includes(body.bonus_no)) return alert('보너스 번호는 당첨번호와 달라야 합니다.');
  if (state.draws.some((draw) => draw.draw_no === body.draw_no) && !confirm('이미 있는 회차입니다. 기존 값을 수정할까요?')) return;

  const response = await fetch('/api/manual-draw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await readJsonResponse(response);
  if (!response.ok) return alert(data.error || '저장 실패');
  await loadDraws();
  state.statGames = [];
  state.aiGames = [];
  alert(`${body.draw_no}회 저장 완료. 내 구매 결과도 자동으로 다시 판정됩니다.`);
  render();
}

async function syncDraws(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const response = await fetch('/api/sync-lotto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: form.get('secret') }) });
  const data = await readJsonResponse(response);
  if (!response.ok) return (qs('#adminMessage').textContent = data.error || '동기화 실패');
  await loadDraws();
  state.statGames = [];
  state.aiGames = [];
  render();
}

function installDelegation() {
  document.addEventListener('click', async (event) => {
    const page = event.target.closest('[data-page]');
    if (page) { state.page = page.dataset.page; render(); return; }

    const mode = event.target.closest('[data-mode]');
    if (mode) { state.mode = mode.dataset.mode; state.statGames = []; state.aiGames = []; state.aiScenario = ''; state.aiMessage = ''; render(); return; }

    const fixed = event.target.closest('[data-fixed]');
    if (fixed) {
      const number = Number(fixed.dataset.fixed);
      state.fixed = state.fixed.includes(number) ? state.fixed.filter((item) => item !== number) : state.fixed.length < 5 ? [...state.fixed, number] : state.fixed;
      render();
      return;
    }

    if (event.target.closest('#generate')) return generate();

    const save = event.target.closest('[data-save-numbers]');
    if (save) return saveNumber(save.dataset.saveNumbers.split(',').map(Number));

    const purchase = event.target.closest('[data-purchase-numbers]');
    if (purchase) return registerPurchase(purchase.dataset.purchaseNumbers.split(',').map(Number));

    const buySaved = event.target.closest('[data-buy-saved]');
    if (buySaved) {
      const ticket = state.savedNumbers.find((item) => String(item.id) === String(buySaved.dataset.buySaved));
      if (ticket) return registerPurchase(ticket.numbers, ticket.label || '저장 번호 구매');
    }

    const deleteSaved = event.target.closest('[data-delete-saved]');
    if (deleteSaved) return deleteRecord(deleteSaved.dataset.deleteSaved, 'saved');

    const deletePurchase = event.target.closest('[data-delete-purchase]');
    if (deletePurchase) return deleteRecord(deletePurchase.dataset.deletePurchase, 'purchased');

    if (event.target.closest('#manualSaved')) {
      const numbers = askNumbers();
      if (numbers) return saveNumber(numbers);
    }

    if (event.target.closest('#manualPurchase')) {
      const numbers = askNumbers();
      if (numbers) return registerPurchase(numbers, '직접 구매 번호');
    }
  });
}

export async function createApp() {
  installDelegation();
  await Promise.all([loadDraws(), loadTickets()]);
  render();
}
