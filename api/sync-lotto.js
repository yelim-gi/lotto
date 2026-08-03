import {db,verify,cleanDraw} from './_lib.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    if(!verify(req.body?.secret)) return res.status(401).json({error:'관리 비밀번호가 올바르지 않습니다.'});
    const r=await fetch(process.env.LOTTO_DATA_URL||'https://smok95.github.io/lotto/results/all.json');
    if(!r.ok) throw new Error(`외부 데이터 요청 실패: ${r.status}`);
    const rows=(await r.json()).map(x=>cleanDraw(x,'github'));

    // 최신 회차보다 큰 데이터만 찾지 않습니다.
    // 1회부터 전체를 upsert하여 빠진 과거 회차도 복구합니다.
    for(let i=0;i<rows.length;i+=200){
      await db('lotto_draws?on_conflict=draw_no',{
        method:'POST',
        headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify(rows.slice(i,i+200))
      });
    }
    return res.status(200).json({ok:true,inserted:rows.length,latest:rows.at(-1)?.draw_no});
  }catch(e){
    return res.status(400).json({error:e.message});
  }
}
