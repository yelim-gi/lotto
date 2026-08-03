import { isConfigured,ensureAnonymousUser,select,insert,remove } from './lib/supabase.js';
import { buildStats,generateGames,rankTicket } from './lib/stats.js';
const qs=(s,e=document)=>e.querySelector(s), qsa=(s,e=document)=>[...e.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ball=n=>`<span class="ball b${Math.ceil(n/10)}">${n}</span>`;
let state={draws:[],games:[],tickets:[],page:'recommend',count:5,fixed:[]};
async function loadDraws(){
  // 프로젝트에 포함된 1회~기본 최신 회차를 항상 먼저 불러옵니다.
  // Supabase에는 사용자가 추가하거나 수정한 회차만 있어도 됩니다.
  const r=await fetch('/data/lotto.json');
  if(!r.ok) throw new Error('기본 로또 데이터를 불러오지 못했습니다.');
  const raw=await r.json();
  const merged=new Map(raw.map(x=>[Number(x.draw_no),{
    draw_no:Number(x.draw_no),
    draw_date:String(x.date||x.draw_date||'').slice(0,10),
    numbers:(x.numbers||[]).map(Number).sort((a,b)=>a-b),
    bonus_no:Number(x.bonus_no)
  }]));

  // Supabase 값은 같은 회차가 있으면 기본 데이터를 덮어쓰고,
  // 새 회차라면 뒤에 추가됩니다.
  if(isConfigured){
    try{
      const remote=await select('lotto_draws','select=draw_no,draw_date,numbers,bonus_no&order=draw_no.asc');
      for(const row of remote||[]){
        merged.set(Number(row.draw_no),{
          draw_no:Number(row.draw_no),
          draw_date:String(row.draw_date||'').slice(0,10),
          numbers:(row.numbers||[]).map(Number).sort((a,b)=>a-b),
          bonus_no:Number(row.bonus_no)
        });
      }
    }catch(e){
      console.warn('Supabase 회차 데이터 병합 실패, 기본 데이터로 계속합니다.',e);
    }
  }

  state.draws=[...merged.values()].sort((a,b)=>a.draw_no-b.draw_no);
}
async function loadTickets(){
  if(!isConfigured){state.tickets=JSON.parse(localStorage.getItem('lotto-tickets')||'[]');return;}
  try{await ensureAnonymousUser();const data=await select('saved_tickets','select=*&order=created_at.desc');state.tickets=data||[];}catch(e){console.warn(e);state.tickets=[];}
}
function nav(){return `<nav>${[['recommend','번호추천'],['stats','통계'],['tickets','내 번호'],['admin','관리자']].map(([k,v])=>`<button data-page="${k}" class="${state.page===k?'active':''}">${v}</button>`).join('')}</nav>`}
function header(){const latest=state.draws.at(-1);return `<header><div><p class="eyebrow">LOTTO 6/45</p><h1>데이터 기반 번호 추천기</h1><p>과거 통계를 가중치로 활용하는 조합 생성 도구</p></div><div class="latest"><small>최신 데이터</small><strong>${latest?.draw_no||'-'}회</strong><span>${latest?.draw_date||''}</span></div></header>`}
function recommend(){
 const fixed=Array.from({length:45},(_,i)=>i+1).map(n=>`<button class="pick ${state.fixed.includes(n)?'on':''}" data-fixed="${n}">${n}</button>`).join('');
 return `<section class="grid"><article class="card controls"><h2>데이터 기반 추천</h2><p class="modelIntro">전체 회차의 출현 빈도, 최근 30·100회 흐름, 번호 간 동반출현, 미출현 기간과 조합 분포를 한 번에 종합합니다.</p><label>게임 수 <b id="countLabel">${state.count}</b><input id="count" type="range" min="1" max="10" value="${state.count}"></label><details><summary>고정 번호 선택 (${state.fixed.length}/5)</summary><div class="picker">${fixed}</div></details><button class="primary" id="generate">전체 데이터로 번호 생성</button><p class="hint">게임 사이에는 같은 번호가 반복될 수 있습니다. 추천지수는 과거 데이터와의 통계적 적합도이며 실제 당첨 확률은 아닙니다.</p></article><article class="card results"><div class="titleRow"><h2>추천 결과</h2>${state.games.length?'<button id="saveAll">전체 저장</button>':''}</div>${state.games.length?state.games.map((g,i)=>`<div class="gameCard"><div class="game"><b>${i+1}게임</b><div>${g.numbers.map(ball).join('')}</div><button data-save="${i}">저장</button></div><div class="gameMeta"><strong>추천지수 ${g.score}점</strong><span>${esc(g.reason)}</span></div></div>`).join(''):'<div class="empty">게임 수를 정하고 번호를 생성해보세요.</div>'}</article></section>`;
}
function statsPage(){const s=buildStats(state.draws); const rows=Array.from({length:45},(_,i)=>i+1).map(n=>({n,total:s.total[n],recent:s.recent[n],overdue:s.overdue[n]})).sort((a,b)=>b.total-a.total);return `<section class="card"><h2>번호 통계</h2><p class="hint">총 ${state.draws.length}개 회차 기준 · 최근 50회 포함</p><div class="tableWrap"><table><thead><tr><th>번호</th><th>전체 출현</th><th>최근 50회</th><th>미출현</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${ball(x.n)}</td><td>${x.total}회</td><td>${x.recent}회</td><td>${x.overdue}회차</td></tr>`).join('')}</tbody></table></div></section>`}
function ticketsPage(){return `<section class="card"><div class="titleRow"><h2>내 번호</h2><button id="manualTicket">직접 추가</button></div>${state.tickets.length?state.tickets.map(t=>{const draw=state.draws.find(d=>d.draw_no===Number(t.target_draw_no));const r=rankTicket(t.numbers,draw);return `<div class="ticket"><div><strong>${esc(t.label||'저장 번호')}</strong><small>${t.target_draw_no?`${t.target_draw_no}회 · ${r.label}`:'회차 미지정'}</small></div><div>${t.numbers.map(ball).join('')}</div><button class="danger" data-delete="${t.id}">삭제</button></div>`}).join(''):'<div class="empty">저장한 번호가 없습니다.</div>'}</section>`}
function adminPage(){const next=(state.draws.at(-1)?.draw_no||0)+1;return `<section class="grid"><article class="card"><h2>최신 회차 수동 입력</h2><form id="manualDraw"><label>관리 비밀번호<input name="secret" type="password" required></label><label>회차<input name="draw_no" type="number" value="${next}" required></label><label>추첨일<input name="draw_date" type="date" required></label><label>당첨번호 6개<input name="numbers" placeholder="예: 1, 7, 15, 22, 31, 43" required></label><label>보너스번호<input name="bonus_no" type="number" min="1" max="45" required></label><button class="primary">Supabase에 저장·업데이트</button></form><p class="hint">같은 회차가 있으면 확인 후 수정됩니다. 저장 후 통계와 추천 데이터가 즉시 갱신됩니다.</p></article><article class="card"><h2>외부 데이터 동기화</h2><form id="sync"><label>관리 비밀번호<input name="secret" type="password" required></label><button>GitHub 최신 데이터 동기화</button></form><div id="adminMessage" class="message"></div></article></section>`}
function render(){const root=qs('#root');root.innerHTML=`<main>${header()}${nav()}${state.page==='recommend'?recommend():state.page==='stats'?statsPage():state.page==='tickets'?ticketsPage():adminPage()}<footer>통계 점수는 실제 당첨 확률을 높인다는 뜻이 아닙니다.</footer></main>`;bind();}
function bind(){qsa('[data-page]').forEach(b=>b.onclick=()=>{state.page=b.dataset.page;render()});
 const count=qs('#count');if(count)count.oninput=e=>{state.count=Number(e.target.value);qs('#countLabel').textContent=state.count};
 qsa('[data-fixed]').forEach(b=>b.onclick=()=>{const n=Number(b.dataset.fixed);state.fixed=state.fixed.includes(n)?state.fixed.filter(x=>x!==n):state.fixed.length<5?[...state.fixed,n]:state.fixed;render()});
 const gen=qs('#generate');if(gen)gen.onclick=()=>{state.games=generateGames(state.draws,state.count,state.fixed);render()};
 qsa('[data-save]').forEach(b=>b.onclick=()=>saveTicket(state.games[Number(b.dataset.save)].numbers)); const sa=qs('#saveAll');if(sa)sa.onclick=async()=>{for(const g of state.games)await saveTicket(g.numbers,false);alert('전체 저장했습니다.');};
 qsa('[data-delete]').forEach(b=>b.onclick=()=>deleteTicket(b.dataset.delete)); const mt=qs('#manualTicket');if(mt)mt.onclick=manualTicket;
 const md=qs('#manualDraw');if(md)md.onsubmit=manualDraw; const sy=qs('#sync');if(sy)sy.onsubmit=syncDraws;
}
async function saveTicket(numbers,notify=true){const target=Number(prompt('대상 회차를 입력하세요. 비워두면 최신 다음 회차로 저장됩니다.',String((state.draws.at(-1)?.draw_no||0)+1)))||null;const label=prompt('메모 또는 이름을 입력하세요.','추천 번호')||'추천 번호';
 if(isConfigured){const user=await ensureAnonymousUser();try{const data=await insert('saved_tickets',{user_id:user.id,label,target_draw_no:target,numbers});state.tickets.unshift(data);}catch(e){return alert(e.message);}}else{const t={id:crypto.randomUUID(),label,target_draw_no:target,numbers,created_at:new Date().toISOString()};state.tickets.unshift(t);localStorage.setItem('lotto-tickets',JSON.stringify(state.tickets));}if(notify)alert('저장했습니다.');}
async function deleteTicket(id){if(!confirm('삭제할까요?'))return;if(isConfigured){try{await remove('saved_tickets',id);}catch(e){return alert(e.message);}}state.tickets=state.tickets.filter(t=>t.id!==id);localStorage.setItem('lotto-tickets',JSON.stringify(state.tickets));render();}
async function manualTicket(){const raw=prompt('번호 6개를 쉼표로 입력하세요.','1, 7, 15, 22, 31, 43');if(!raw)return;const nums=raw.split(/[ ,]+/).map(Number).filter(Boolean);if(nums.length!==6||new Set(nums).size!==6||nums.some(n=>n<1||n>45))return alert('1~45의 서로 다른 번호 6개를 입력하세요.');await saveTicket(nums.sort((a,b)=>a-b));render();}
async function manualDraw(e){e.preventDefault();const f=new FormData(e.currentTarget), nums=String(f.get('numbers')).split(/[ ,]+/).map(Number).filter(Number.isFinite);if(nums.length!==6||new Set(nums).size!==6||nums.some(n=>n<1||n>45))return alert('당첨번호 6개를 정확히 입력하세요.');const body={secret:f.get('secret'),draw_no:Number(f.get('draw_no')),draw_date:f.get('draw_date'),numbers:nums,bonus_no:Number(f.get('bonus_no'))};if(nums.includes(body.bonus_no))return alert('보너스 번호는 당첨번호와 달라야 합니다.');if(state.draws.some(d=>d.draw_no===body.draw_no)&&!confirm('이미 있는 회차입니다. 기존 값을 수정할까요?'))return;const r=await fetch('/api/manual-draw',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)return alert(j.error||'저장 실패');await loadDraws();state.games=[];alert(`${body.draw_no}회 저장 완료. 통계에 반영했습니다.`);render();}
async function syncDraws(e){e.preventDefault();const f=new FormData(e.currentTarget);const r=await fetch('/api/sync-lotto',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:f.get('secret')})});const j=await r.json();qs('#adminMessage').textContent=r.ok?`${j.inserted}개 회차 동기화 완료`:(j.error||'동기화 실패');if(r.ok){await loadDraws();state.games=[];render();}}
export async function createApp(){await Promise.all([loadDraws(),loadTickets()]);render();}
