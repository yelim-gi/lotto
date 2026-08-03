export const MODES={balanced:'종합 추천',recent:'최근 강세',overdue:'장기 미출현',hot:'전체 빈도'};
const norm=(v,min,max)=>max===min?0.5:(v-min)/(max-min);
export function buildStats(draws){
  const sorted=[...draws].sort((a,b)=>a.draw_no-b.draw_no);
  const total=Array(46).fill(0), recent=Array(46).fill(0), last=Array(46).fill(0);
  const recentDraws=sorted.slice(-50);
  for(const d of sorted) for(const n of d.numbers){ total[n]++; last[n]=d.draw_no; }
  for(const d of recentDraws) for(const n of d.numbers) recent[n]++;
  const latest=sorted.at(-1)?.draw_no||0;
  const overdue=Array.from({length:46},(_,n)=>n?latest-(last[n]||0):0);
  return { sorted,total,recent,last,overdue,latest };
}
export function weightsFor(stats,mode='balanced'){
  const nums=Array.from({length:45},(_,i)=>i+1);
  const t=nums.map(n=>stats.total[n]), r=nums.map(n=>stats.recent[n]), o=nums.map(n=>stats.overdue[n]);
  const ranges={t:[Math.min(...t),Math.max(...t)],r:[Math.min(...r),Math.max(...r)],o:[Math.min(...o),Math.max(...o)]};
  return nums.map(n=>{
    const nt=norm(stats.total[n],...ranges.t), nr=norm(stats.recent[n],...ranges.r), no=norm(stats.overdue[n],...ranges.o);
    let score=1;
    if(mode==='recent') score=.2+nr*1.8+nt*.35;
    else if(mode==='overdue') score=.2+no*1.8+nt*.25;
    else if(mode==='hot') score=.2+nt*1.8+nr*.25;
    else score=.35+nt*.65+nr*.65+no*.45;
    return {n,score};
  });
}
function weightedPick(pool){
  const sum=pool.reduce((a,x)=>a+x.score,0); let r=Math.random()*sum;
  for(const x of pool){r-=x.score;if(r<=0)return x.n;} return pool.at(-1).n;
}
function validCombo(nums){
  const odds=nums.filter(n=>n%2).length, sum=nums.reduce((a,b)=>a+b,0), low=nums.filter(n=>n<=22).length;
  return odds>=2&&odds<=4&&low>=2&&low<=4&&sum>=90&&sum<=190;
}
export function generateGames(draws,count,mode,fixed=[]){
  const stats=buildStats(draws), weights=weightsFor(stats,mode), games=[], seen=new Set();
  for(let g=0;g<count;g++){
    let combo=[];
    for(let attempt=0;attempt<400;attempt++){
      combo=[...new Set(fixed)].filter(n=>n>=1&&n<=45).slice(0,5);
      let pool=weights.filter(x=>!combo.includes(x.n));
      while(combo.length<6){const n=weightedPick(pool);combo.push(n);pool=pool.filter(x=>x.n!==n);}
      combo.sort((a,b)=>a-b); const key=combo.join('-');
      if(validCombo(combo)&&!seen.has(key)){seen.add(key);break;}
    }
    games.push(combo);
  }
  return games;
}
export function rankTicket(ticket,draw){
  if(!draw)return {label:'추첨 전',hits:0};
  const hits=ticket.filter(n=>draw.numbers.includes(n)).length;
  const bonus=ticket.includes(draw.bonus_no);
  const label=hits===6?'1등':hits===5&&bonus?'2등':hits===5?'3등':hits===4?'4등':hits===3?'5등':'낙첨';
  return {label,hits,bonus};
}
