const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const norm=(v,min,max)=>max===min?0.5:(v-min)/(max-min);
const mean=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;
const std=(arr,m=mean(arr))=>arr.length?Math.sqrt(arr.reduce((a,v)=>a+(v-m)**2,0)/arr.length):1;

export function buildStats(draws){
  const sorted=[...draws].sort((a,b)=>a.draw_no-b.draw_no);
  const total=Array(46).fill(0), recent30=Array(46).fill(0), recent50=Array(46).fill(0), recent100=Array(46).fill(0), last=Array(46).fill(0);
  const pairs=Array.from({length:46},()=>Array(46).fill(0));
  const oddFreq=Array(7).fill(0), lowFreq=Array(7).fill(0), consecutiveFreq=Array(6).fill(0), sums=[];
  for(const d of sorted){
    const nums=[...d.numbers].map(Number).sort((a,b)=>a-b);
    for(const n of nums){total[n]++;last[n]=d.draw_no;}
    for(let i=0;i<nums.length;i++)for(let j=i+1;j<nums.length;j++){pairs[nums[i]][nums[j]]++;pairs[nums[j]][nums[i]]++;}
    const odd=nums.filter(n=>n%2).length, low=nums.filter(n=>n<=22).length;
    let consecutive=0;for(let i=1;i<nums.length;i++)if(nums[i]===nums[i-1]+1)consecutive++;
    oddFreq[odd]++;lowFreq[low]++;consecutiveFreq[Math.min(5,consecutive)]++;
    sums.push(nums.reduce((a,b)=>a+b,0));
  }
  for(const d of sorted.slice(-30))for(const n of d.numbers)recent30[n]++;
  for(const d of sorted.slice(-50))for(const n of d.numbers)recent50[n]++;
  for(const d of sorted.slice(-100))for(const n of d.numbers)recent100[n]++;
  const latest=sorted.at(-1)?.draw_no||0;
  const overdue=Array.from({length:46},(_,n)=>n?latest-(last[n]||0):0);
  const sumMean=mean(sums),sumStd=std(sums,sumMean)||1;
  return {sorted,total,recent30,recent50,recent100,last,overdue,pairs,oddFreq,lowFreq,consecutiveFreq,sums,sumMean,sumStd,latest};
}

function numberWeights(stats){
  const nums=Array.from({length:45},(_,i)=>i+1);
  const range=k=>[Math.min(...nums.map(n=>stats[k][n])),Math.max(...nums.map(n=>stats[k][n]))];
  const ranges={total:range('total'),r30:range('recent30'),r100:range('recent100'),overdue:range('overdue')};
  return nums.map(n=>{
    const whole=norm(stats.total[n],...ranges.total),short=norm(stats.recent30[n],...ranges.r30),medium=norm(stats.recent100[n],...ranges.r100),overdue=norm(stats.overdue[n],...ranges.overdue);
    const modelScore=.34*whole+.27*short+.25*medium+.14*overdue;
    return {n,modelScore,score:.35+modelScore*1.9};
  });
}
function weightedPick(pool,current,stats){
  const adjusted=pool.map(x=>{const pairAvg=current.length?mean(current.map(n=>stats.pairs[x.n][n])):0;return {...x,adjusted:x.score*(1+Math.min(.5,pairAvg/Math.max(1,stats.sorted.length)*14))};});
  const sum=adjusted.reduce((a,x)=>a+x.adjusted,0);let r=Math.random()*sum;for(const x of adjusted){r-=x.adjusted;if(r<=0)return x.n;}return adjusted.at(-1).n;
}
function comboShape(nums){const sorted=[...nums].sort((a,b)=>a-b),odd=sorted.filter(n=>n%2).length,low=sorted.filter(n=>n<=22).length,sum=sorted.reduce((a,b)=>a+b,0);let consecutive=0;for(let i=1;i<sorted.length;i++)if(sorted[i]===sorted[i-1]+1)consecutive++;return {odd,low,sum,consecutive};}
function validCombo(nums,stats){const x=comboShape(nums);return x.odd>=1&&x.odd<=5&&x.low>=1&&x.low<=5&&x.consecutive<=2&&Math.abs(x.sum-stats.sumMean)<=stats.sumStd*2.1;}
export function analyzeGame(numbers,stats,weights=numberWeights(stats)){
  const shape=comboShape(numbers),byNumber=new Map(weights.map(x=>[x.n,x.modelScore])),numberFit=mean(numbers.map(n=>byNumber.get(n)||0)),pairValues=[];
  for(let i=0;i<numbers.length;i++)for(let j=i+1;j<numbers.length;j++)pairValues.push(stats.pairs[numbers[i]][numbers[j]]);
  const maxPair=Math.max(1,...stats.pairs.flat()),pairFit=mean(pairValues)/maxPair,oddFit=(stats.oddFreq[shape.odd]||0)/Math.max(1,...stats.oddFreq),lowFit=(stats.lowFreq[shape.low]||0)/Math.max(1,...stats.lowFreq),consecutiveFit=(stats.consecutiveFreq[Math.min(5,shape.consecutive)]||0)/Math.max(1,...stats.consecutiveFreq),sumFit=Math.exp(-.5*((shape.sum-stats.sumMean)/stats.sumStd)**2),patternFit=.32*sumFit+.24*oddFit+.22*lowFit+.22*consecutiveFit,raw=.56*numberFit+.22*pairFit+.22*patternFit;
  return {score:Math.round(clamp(70+raw*28,70,98)),shape};
}
export function generateGames(draws,count,fixed=[]){
  const stats=buildStats(draws),weights=numberWeights(stats),games=[],seen=new Set();
  for(let g=0;g<count;g++){
    let chosen=null;
    for(let attempt=0;attempt<800;attempt++){
      const combo=[...new Set(fixed)].filter(n=>n>=1&&n<=45).slice(0,5);let pool=weights.filter(x=>!combo.includes(x.n));
      while(combo.length<6){const n=weightedPick(pool,combo,stats);combo.push(n);pool=pool.filter(x=>x.n!==n);}combo.sort((a,b)=>a-b);const key=combo.join('-');if(validCombo(combo,stats)&&!seen.has(key)){chosen=combo;seen.add(key);break;}
    }
    if(!chosen){chosen=[...new Set(fixed)].slice(0,5);while(chosen.length<6){const n=1+Math.floor(Math.random()*45);if(!chosen.includes(n))chosen.push(n);}chosen.sort((a,b)=>a-b);}
    games.push({numbers:chosen,...analyzeGame(chosen,stats,weights),source:'statistics'});
  }
  return games;
}
export function createAISnapshot(draws){
  const s=buildStats(draws),nums=Array.from({length:45},(_,i)=>i+1),top=(arr,n=10)=>nums.map(x=>({number:x,value:arr[x]})).sort((a,b)=>b.value-a.value).slice(0,n),bottom=(arr,n=10)=>nums.map(x=>({number:x,value:arr[x]})).sort((a,b)=>a.value-b.value).slice(0,n);
  const pairList=[];for(let a=1;a<=45;a++)for(let b=a+1;b<=45;b++)pairList.push({numbers:[a,b],count:s.pairs[a][b]});pairList.sort((a,b)=>b.count-a.count);
  return {drawCount:draws.length,latestDraw:s.latest,latestNumbers:s.sorted.at(-1)?.numbers||[],overallHot:top(s.total),recent30Hot:top(s.recent30),recent100Hot:top(s.recent100),longOverdue:top(s.overdue),recent30Cold:bottom(s.recent30),pairLeaders:pairList.slice(0,15),sumMean:Number(s.sumMean.toFixed(1)),sumStd:Number(s.sumStd.toFixed(1)),oddDistribution:s.oddFreq,lowDistribution:s.lowFreq,consecutiveDistribution:s.consecutiveFreq};
}
export function rankTicket(ticket,draw){if(!draw)return {label:'추첨 전',hits:0};const hits=ticket.filter(n=>draw.numbers.includes(n)).length,bonus=ticket.includes(draw.bonus_no),label=hits===6?'1등':hits===5&&bonus?'2등':hits===5?'3등':hits===4?'4등':hits===3?'5등':'낙첨';return {label,hits,bonus};}
