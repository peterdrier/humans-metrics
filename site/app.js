// Each dataset is docs/data/<key>.json, written by site/build.py.
const KEYS = ["statsCols", "stats", "refCols", "ref", "modules", "git", "prs", "actions", "secDays", "statsSeconds", "secFailed", "runs", "latestRun", "surface", "byRule", "semDeps", "files", "generated"];
const D = Object.fromEntries(await Promise.all(KEYS.map(async k => [k, await (await fetch(`data/${k}.json`, {cache: 'no-cache'})).json()])));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const SPLIT = '2026-08-08';
const EVENTS = [
  ['2026-02-04','First commit'],['2026-03-08','First real test project'],['2026-05-16','Biggest day, +40.7k'],
  ['2026-05-20','Docs prune begins'],['2026-08-08','Section split (G5)'],['2026-08-16','Surface-score baseline'],['2026-08-17','Section doctor starts']
];
document.getElementById('events').innerHTML = EVENTS.map(([d,t])=>`<span><b>${d}</b> ${t}</span>`).join('');

// ---- data shaping
const SC = Object.fromEntries(D.statsCols.map((c,i)=>[c,i]));
const S = D.stats.map(r=>({date:r[0], app:r[SC['App Lines']], test:r[SC['Test Lines']], cs:r[SC['CS Lines']], cscode:r[SC['CS Code']], cscmt:r[SC['CS Comment']],
  cshtml:r[SC['CSHTML Lines']], resx:r[SC['RESX Lines']], js:r[SC['JS Lines']], md:r[SC['MD Lines']], mig:r[SC['Migration Lines']], files:r[SC['Files']],
  classes:r[SC['Classes']], ifaces:r[SC['Interfaces']], ctrl:r[SC['Controllers']], views:r[SC['Views']], keys:r[SC['Resx Keys']], plus:r[SC['Day +Lines']], minus:r[SC['Day -Lines']]}));
const RC = Object.fromEntries(D.refCols.map((c,i)=>[c,i]));
const R = D.ref.map(r=>Object.fromEntries(D.refCols.map((c,i)=>[c,r[i]])));

let range='all', smooth=0, scale='log';
const inRange = d => range==='all' ? true : range==='split' ? d>=SPLIT : d>='2026-07-20';
const sm = (arr,k) => k<=1 ? arr : arr.map((_,i)=>{const s=arr.slice(Math.max(0,i-k+1),i+1).filter(v=>v!=null); return s.length? s.reduce((a,b)=>a+b,0)/s.length : null;});

// ---- chart helpers
const charts = {};
Chart.defaults.font.family = css('--font'); Chart.defaults.font.size = 11;
function theme(){ return { fg:css('--fg'), fg2:css('--fg-2'), fg3:css('--fg-3'), grid:css('--grid'), line:css('--line'), surface:css('--surface'),
  s:[css('--s1'),css('--s2'),css('--s3'),css('--s4'),css('--s7')], mark:css('--mark'), good:css('--good'), bad:css('--bad') }; }
const fmt = v => v==null?'':(Math.abs(v)>=1000? v.toLocaleString('en-US',{maximumFractionDigits:0}) : v.toLocaleString('en-US',{maximumFractionDigits:2}));
function base(t, yfmt, extra={}){
  const logy = extra.log && scale==='log';
  return { responsive:true, maintainAspectRatio:false, animation:false, interaction:{mode:'index',intersect:false},
    plugins:{ legend:{display:false}, tooltip:{backgroundColor:t.surface, titleColor:t.fg, bodyColor:t.fg2, borderColor:t.line, borderWidth:1, padding:8,
      callbacks:{ label:c=>` ${c.dataset.label}: ${(yfmt||fmt)(c.parsed.y)}${c.dataset.extra? '  '+(c.dataset.extra[c.dataIndex]||''):''}` } }, ...extra.plugins },
    scales:{ x:{type:'category', ticks:{color:t.fg3, maxTicksLimit:8, maxRotation:0, autoSkip:true, callback:function(v){const l=this.getLabelForValue(v);return l? l.slice(5):'';}}, grid:{display:false}, border:{color:t.line}},
             y:{type: logy?'logarithmic':'linear', ticks:{color:t.fg3, maxTicksLimit:5, callback:v=>(yfmt||fmt)(v)}, grid:{color:t.grid}, border:{display:false}, beginAtZero:!logy, ...extra.y} } };
}
const splitBand = { id:'band', afterDraw(ch){ const x=ch.scales.x, i=ch.data.labels.indexOf(SPLIT); if(i<0) return; const px=x.getPixelForValue(i); const c=ch.ctx; c.save(); c.strokeStyle=css('--fg-3'); c.setLineDash([3,3]); c.lineWidth=1; c.beginPath(); c.moveTo(px,ch.chartArea.top); c.lineTo(px,ch.chartArea.bottom); c.stroke(); c.restore(); } };
function line(id, labels, series, opts={}){
  const t=theme();
  const ds = series.map((s,i)=>({ label:s.label, data:s.data, extra:s.extra, borderColor:t.s[s.slot??i], backgroundColor:s.fill? t.s[s.slot??i]+'22':'transparent', fill:!!s.fill, borderWidth:2, pointRadius:0, pointHoverRadius:5, pointHoverBackgroundColor:t.s[s.slot??i], pointHoverBorderColor:t.surface, pointHoverBorderWidth:2, tension:0, spanGaps:true, stepped:s.stepped||false }));
  if(charts[id]) charts[id].destroy();
  charts[id]=new Chart(document.getElementById(id), { type:'line', data:{labels, datasets:ds}, options:base(t,opts.yfmt,opts), plugins:[splitBand] });
  const lg=document.getElementById('l-'+id.slice(2)); if(lg && series.length>1) lg.innerHTML=series.map((s,i)=>`<span><i style="background:${t.s[s.slot??i]}"></i>${s.label}</span>`).join('');
}
function bars(id, labels, series, opts={}){
  const t=theme();
  const ds=series.map((s,i)=>({label:s.label, data:s.data, extra:s.extra, backgroundColor:s.colors||t.s[s.slot??i], borderRadius:3, borderSkipped:'start', barPercentage:.9, categoryPercentage:.9, stack:s.stack}));
  if(charts[id]) charts[id].destroy();
  const o=base(t,opts.yfmt,opts); if(opts.horizontal){ o.indexAxis='y'; o.scales={ y:{type:'category', ticks:{color:t.fg2, autoSkip:false, font:{size:10}}, grid:{display:false}, border:{color:t.line}, stacked:!!opts.stacked}, x:{ticks:{color:t.fg3, maxTicksLimit:5, callback:v=>fmt(v)}, grid:{color:t.grid}, border:{display:false}, beginAtZero:true, stacked:!!opts.stacked} }; o.interaction={mode:'index',intersect:false}; o.plugins.tooltip.callbacks.label=c=>` ${c.dataset.label}: ${fmt(c.parsed.x)}`; }
  else { o.scales.x.ticks.callback=function(v){const l=this.getLabelForValue(v);return opts.rawLabels? l : (l?l.slice(5):'');}; if(opts.stacked){o.scales.x.stacked=true;o.scales.y.stacked=true;} o.scales.y.beginAtZero=opts.y?.beginAtZero??true; }
  charts[id]=new Chart(document.getElementById(id), { type:'bar', data:{labels, datasets:ds}, options:o, plugins:opts.horizontal?[]:[splitBand] });
  const lg=document.getElementById('l-'+id.slice(2)); if(lg && series.length>1) lg.innerHTML=series.map((s,i)=>`<span><i style="background:${t.s[s.slot??i]}"></i>${s.label}</span>`).join('');
}
const pct = v => (v*100).toFixed(1)+'%';

function render(){
  const s=S.filter(r=>inRange(r.date)), L=s.map(r=>r.date);
  const k=smooth; const sm_=a=>sm(a,k);
  line('c-lines', L, [{label:'App lines', data:sm_(s.map(r=>r.app)), fill:true},{label:'Test lines', data:sm_(s.map(r=>r.test)), fill:true}], {log:true});
  line('c-mix', L, [{label:'C#', data:s.map(r=>r.cs/r.app)},{label:'Razor', data:s.map(r=>r.cshtml/r.app)},{label:'RESX', data:s.map(r=>r.resx/r.app)}], {yfmt:pct});
  line('c-classes', L, [{label:'Classes', data:sm_(s.map(r=>r.classes))}], {log:true});
  line('c-ifaces', L, [{label:'Interfaces', data:sm_(s.map(r=>r.ifaces))}], {log:true});
  line('c-ctrl', L, [{label:'Controllers', data:s.map(r=>r.ctrl)},{label:'Views', data:s.map(r=>r.views), slot:1}], {log:true});
  line('c-resx', L, [{label:'Resx keys', data:s.map(r=>r.keys)}]);
  line('c-md', L, [{label:'Markdown lines', data:sm_(s.map(r=>r.md)), slot:1, fill:true}], {log:true});
  line('c-mig', L, [{label:'Migration lines', data:sm_(s.map(r=>r.mig)), slot:1, fill:true}], {log:true});
  line('c-cmt', L, [{label:'Comment share', data:sm_(s.map(r=>r.cscmt/r.cs)), slot:1}], {yfmt:pct});
  line('c-docratio', L, [{label:'MD lines per app line', data:sm_(s.map(r=>r.md/r.app)), slot:1}]);
  bars('c-churn', L, [{label:'Added', data:sm_(s.map(r=>r.plus)), colors:theme().good},{label:'Removed', data:sm_(s.map(r=>-r.minus)), colors:theme().bad}], {stacked:true, y:{beginAtZero:true, min:-60000, max:60000}});
  line('c-lpc', L, [{label:'App lines per class', data:sm_(s.map(r=>r.app/r.classes)), slot:1}]);
  // weekly net growth
  const wk=[]; for(let i=0;i<S.length;i++){ const j=S.findIndex(r=>r.date>=addDays(S[i].date,-7)); if(S[i].date>='2026-02-11') wk.push({date:S[i].date, v:(S[i].app+S[i].test)-(S[j].app+S[j].test)}); }
  const wkf=wk.filter(r=>inRange(r.date));
  bars('c-weekly', wkf.map(r=>r.date), [{label:'7-day net lines', data:wkf.map(r=>r.v), colors:wkf.map(r=>r.v>=0?theme().s[0]:theme().bad)}]);
  // reforge
  const r=R.filter(x=>inRange(x.commit_date)), RL=r.map(x=>x.commit_date);
  const one=(key,label,yfmt,extraKey,slot=2,log=false)=>line('r-'+key, RL, [{label, data:sm_(r.map(x=>x[key])), extra:extraKey? r.map(x=>String(x[extraKey]).split('/').pop()) : null, slot}], {yfmt, log});
  one('avg_reach','Avg reach'); one('p95_reach','p95 reach'); one('max_reach','Max reach',null,'max_reach_file',2,true);
  one('core_size_pct','Core size',pct); one('cycle_count','Cycles'); one('avg_fanout','Avg fan-out'); one('max_fanout','Max fan-out',null,'max_fanout_file');
  one('avg_cyclomatic','Avg cyclomatic'); one('p95_cyclomatic','p95 cyclomatic'); one('max_cyclomatic','Max cyclomatic',null,'max_cyclomatic_method');
  one('avg_class_loc','Avg class LOC',null,null,2,true); one('p95_class_loc','p95 class LOC',null,null,2,true); one('max_class_loc','Max class LOC',null,'max_class_loc_name',2,true);
  // modules
  const M=D.modules.filter(m=>inRange(m.date)), ML=M.map(m=>m.date);
  const sizes=m=>Object.entries(m.loc).filter(([n])=>!['Base','Analyzers'].includes(n)).map(([n,v])=>[n,v]).sort((a,b)=>b[1]-a[1]);
  const q=(arr,p)=>{const a=[...arr].sort((x,y)=>x-y); return a[Math.min(a.length-1,Math.floor(p*(a.length-1)))];};
  const gini=arr=>{const a=[...arr].sort((x,y)=>x-y),n=a.length,sum=a.reduce((x,y)=>x+y,0); if(!sum) return 0; let g=0; a.forEach((v,i)=>g+=(2*(i+1)-n-1)*v); return g/(n*sum);};
  line('m-count', ML, [{label:'Modules', data:M.map(m=>sizes(m).length), slot:4, stepped:true}], {log:true});
  const post=M.filter(m=>m.date>=SPLIT);
  line('m-quant', post.map(m=>m.date), [{label:'Median', data:post.map(m=>q(sizes(m).map(x=>x[1]),.5)), slot:4},{label:'p90', data:post.map(m=>q(sizes(m).map(x=>x[1]),.9)), slot:1}], {log:true});
  line('m-maxshare', ML, [{label:'Largest module share', data:M.map(m=>{const z=sizes(m).map(x=>x[1]);return z[0]/z.reduce((a,b)=>a+b,0);}), slot:4}], {yfmt:pct});
  // dependencies
  const DS=M.map(m=>m.depSummary||null);
  line('d-edges', ML, [{label:'Modules', data:DS.map(d=>d&&d.nodeCount), slot:0},{label:'Edges', data:DS.map(d=>d&&d.edgeCount), slot:1}], {log:true});
  line('d-density', ML, [{label:'Density', data:DS.map(d=>d&&d.density), slot:4}], {yfmt:pct});
  line('d-fanout', ML, [{label:'Avg fan-out', data:DS.map(d=>d&&d.avgFanOut), slot:0},{label:'Max fan-out', data:DS.map(d=>d&&d.maxFanOut), extra:DS.map(d=>d&&d.maxFanOutNode), slot:1}]);
  line('d-fanin', ML, [{label:'Max fan-in', data:DS.map(d=>d&&d.maxFanIn), extra:DS.map(d=>d&&d.maxFanInNode), slot:4}]);
  renderLanes(); renderFlow(); renderCI(); renderAssembly(); renderFiles();
  line('m-gini', ML, [{label:'Gini', data:M.map(m=>gini(sizes(m).map(x=>x[1]))), slot:4}], {y:{max:1}});
}

function renderLanes(){
  const G=D.git; if(!G||!G.length) return;
  const LANES=['automation','peter','other'];
  const NAMES={automation:'Automation',peter:'Peter',other:'Others'};
  const byDate=Object.fromEntries(G.map(g=>[g.date,g]));
  const all=S.map(r=>r.date); // every collected day
  const win=(dates,i,n)=>dates.slice(Math.max(0,i-n+1),i+1).map(d=>byDate[d]).filter(Boolean);
  const roll=(n,f)=>all.map((d,i)=>{const w=win(all,i,n); const c={}; w.forEach(g=>f(g,c)); return c;});
  const L28=roll(28,(g,c)=>{for(const [k,v] of Object.entries(g.lanes)){c[k]=c[k]||{prs:0,lines:0}; c[k].prs+=v.prs; c[k].lines+=v.added+v.deleted;}});
  const idx=all.map((d,i)=>i).filter(i=>inRange(all[i])&&all[i]>='2026-03-03'), L=idx.map(i=>all[i]);
  const used=LANES.filter(k=>L28.some(c=>c[k]));
  const t=theme(); const col={automation:t.fg3,peter:t.s[0],other:t.s[1]};
  const stack=(id,key,lg)=>{
    const ds=used.map(k=>({label:NAMES[k], data:idx.map(i=>{const c=L28[i]; const tot=Object.values(c).reduce((a,v)=>a+v[key],0); return tot? (c[k]?c[k][key]:0)/tot : null;}), borderColor:col[k], backgroundColor:col[k], fill:true, borderWidth:1, pointRadius:0, pointHoverRadius:4, tension:0, spanGaps:true}));
    if(charts[id]) charts[id].destroy();
    const o=base(t,pct,{}); o.scales.y.stacked=true; o.scales.y.max=1; o.scales.y.type='linear';
    charts[id]=new Chart(document.getElementById(id),{type:'line',data:{labels:L,datasets:ds},options:o,plugins:[splitBand]});
    document.getElementById(lg).innerHTML=used.map(k=>`<span><i style="background:${col[k]}"></i>${NAMES[k]}</span>`).join('');
  };
  stack('g-lines','lines','l-lines-lanes'); stack('g-prs','prs','l-prs-lanes');
  const W7=roll(7,(g,c)=>{c.prs=(c.prs||0)+Object.values(g.lanes).reduce((a,v)=>a+v.prs,0); c.authors=Math.max(c.authors||0,g.authors);});
  line('g-rate', L, [{label:'PRs / 7 days', data:idx.map(i=>W7[i].prs||0), slot:0}]);
  line('g-authors', L, [{label:'Authors / 7 days', data:idx.map(i=>W7[i].authors||0), slot:1}]);
  const R28=roll(28,(g,c)=>{for(const [k,v] of Object.entries(g.routines)) c[k]=(c[k]||0)+v;});
  const rts=[...new Set(R28.flatMap(c=>Object.keys(c)))];
  line('g-routines', L, rts.map((k,j)=>({label:k, data:idx.map(i=>R28[i][k]||0), slot:j%5})));
  const M28=roll(28,(g,c)=>{for(const [k,v] of Object.entries(g.models)) c[k]=(c[k]||0)+v;});
  const mt={}; G.forEach(g=>{for(const [k,v] of Object.entries(g.models)) mt[k]=(mt[k]||0)+v;});
  const top=Object.entries(mt).sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0]);
  line('g-models', L, top.map((k,j)=>({label:k.replace(/^Claude /,''), data:idx.map(i=>M28[i][k]||0), slot:j%5})));
}

function renderFlow(){
  const P=D.prs; if(!P||!P.length) return;
  const by=Object.fromEntries(P.map(p=>[p.date,p])); const all=S.map(r=>r.date);
  const win=(i,n)=>all.slice(Math.max(0,i-n+1),i+1).map(d=>by[d]).filter(Boolean);
  const idx=all.map((d,i)=>i).filter(i=>inRange(all[i])&&all[i]>='2026-02-18'), L=idx.map(i=>all[i]);
  const sumL=(w,f)=>w.reduce((a,p)=>a+Object.values(p.lanes).reduce((b,l)=>b+(f(l)||0),0),0);
  const q=(arr,p)=>{if(!arr.length) return null; const a=[...arr].sort((x,y)=>x-y); return a[Math.min(a.length-1,Math.floor(p*(a.length-1)))];};
  line('p-flow', L, [{label:'Opened', data:idx.map(i=>win(i,7).reduce((a,p)=>a+p.opened,0)), slot:1},{label:'Merged', data:idx.map(i=>sumL(win(i,7),l=>l.merged)), slot:0}]);
  const ttm=i=>win(i,28).flatMap(p=>Object.values(p.lanes).flatMap(l=>l.ttm_hours||[]));
  line('p-ttm', L, [{label:'Median h', data:idx.map(i=>q(ttm(i),.5)), slot:0},{label:'p90 h', data:idx.map(i=>q(ttm(i),.9)), slot:1}], {log:true});
  const g=(i,k)=>win(i,28).reduce((a,p)=>a+(p.gate[k]||0),0);
  line('p-gate', L, [{label:'Reviews', data:idx.map(i=>g(i,'reviews')), slot:0},{label:'Approvals', data:idx.map(i=>g(i,'approvals')), slot:1},{label:'Merges', data:idx.map(i=>g(i,'merges')), slot:4},{label:'Review comments', data:idx.map(i=>g(i,'review_comments')), slot:2}]);
  line('p-comments', L, [{label:'Bot', data:idx.map(i=>sumL(win(i,28),l=>l.bot_comments)), slot:4},{label:'Human', data:idx.map(i=>sumL(win(i,28),l=>l.human_comments)), slot:0}], {log:true});
  line('p-cr', L, [{label:'Bot / PR', data:idx.map(i=>{const w=win(i,28); const m=sumL(w,l=>l.merged); return m? sumL(w,l=>l.bot_comments)/m : null;}), slot:4},{label:'Human / PR', data:idx.map(i=>{const w=win(i,28); const m=sumL(w,l=>l.merged); return m? sumL(w,l=>l.human_comments)/m : null;}), slot:0}]);
  const bt={}; P.forEach(p=>{for(const [k,v] of Object.entries(p.bots)) bt[k]=(bt[k]||0)+v;});
  const top=Object.entries(bt).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);
  line('p-bots', L, top.map((k,j)=>({label:k.replace('[bot]',''), data:idx.map(i=>win(i,28).reduce((a,p)=>a+(p.bots[k]||0),0)), slot:j%5})));
}
function renderCI(){
  const A=D.actions; if(!A||!A.length) return;
  const by=Object.fromEntries(A.map(p=>[p.date,p])); const all=S.map(r=>r.date);
  const win=(i,n)=>all.slice(Math.max(0,i-n+1),i+1).map(d=>by[d]).filter(Boolean);
  const idx=all.map((d,i)=>i).filter(i=>inRange(all[i])), L=idx.map(i=>all[i]);
  const t=theme();
  const c=k=>idx.map(i=>(by[all[i]]||{conclusions:{}}).conclusions[k]||0);
  bars('a-runs', L, [{label:'Success', data:c('success'), colors:t.good, stack:'a'},{label:'Failure', data:c('failure'), colors:t.bad, stack:'a'},{label:'Cancelled', data:c('cancelled'), colors:t.fg3, stack:'a'}], {stacked:true});
  line('a-fail', L, [{label:'Failure rate', data:idx.map(i=>{const w=win(i,7); const n=w.reduce((a,p)=>a+p.runs,0); return n? w.reduce((a,p)=>a+(p.conclusions.failure||0)+(p.conclusions.cancelled||0),0)/n : null;}), slot:1}], {yfmt:pct});
  const hrs=p=>Object.values(p.workflows).reduce((a,w)=>a+(w.duration_s||0),0)/3600;
  line('a-hours', L, [{label:'Compute hours / day', data:idx.map(i=>{const w=win(i,7); return w.length? w.reduce((a,p)=>a+hrs(p),0)/w.length : null;}), slot:4}], {log:true});
  const wt={}; A.forEach(p=>{for(const [k,v] of Object.entries(p.workflows)) wt[k]=(wt[k]||0)+v.runs;});
  const top=Object.entries(wt).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);
  line('a-wf', L, top.map((k,j)=>({label:k, data:idx.map(i=>win(i,7).reduce((a,p)=>a+((p.workflows[k]||{}).runs||0),0)), slot:j%5})), {log:true});
  line('a-build', L, [{label:'Build and Test, min', data:idx.map(i=>{const w=win(i,7).map(p=>p.workflows['Build and Test']).filter(Boolean); const n=w.reduce((a,x)=>a+x.runs,0); return n? w.reduce((a,x)=>a+x.duration_s,0)/n/60 : null;}), slot:0}]);
  line('a-rerun', L, [{label:'Re-runs / 7 days', data:idx.map(i=>win(i,7).reduce((a,p)=>a+p.reruns,0)), slot:1}]);
}

function renderFiles(){
  const F=(D.files||[]).filter(p=>inRange(p.date)); if(!F.length) return;
  document.getElementById('files').hidden=false;
  const L=F.map(p=>p.date), last=F[F.length-1];
  // Five palette slots: the four largest folders today, the rest as "other".
  const cats=Object.keys(last.categories).sort((a,b)=>last.categories[b].bytes-last.categories[a].bytes);
  const top=cats.length>5? cats.slice(0,4) : cats, rest=cats.filter(k=>!top.includes(k));
  const get=(p,k,f)=>k==='other'? rest.reduce((a,r)=>a+((p.categories[r]||{})[f]||0),0) : ((p.categories[k]||{})[f]||0);
  const keys=rest.length? [...top,'other'] : top;
  const mb=v=>v==null?'':(v>=1024? (v/1024).toFixed(1)+' GB' : v.toFixed(v>=10?0:1)+' MB');
  line('f-bytes', L, keys.map((k,j)=>({label:k, data:F.map(p=>get(p,k,'bytes')/1048576), slot:j})), {yfmt:mb});
  line('f-count', L, keys.map((k,j)=>({label:k, data:F.map(p=>get(p,k,'count')), slot:j})));
  line('f-total', L, [{label:'Total stored', data:F.map(p=>p.bytes/1048576), fill:true, slot:0}], {yfmt:mb});
}

let asPick=null;
function renderAssembly(){
  const Dd=D.secDays; if(!Dd||!Dd.length) return;
  const names=[...new Set(Dd.flatMap(d=>Object.keys(d.sections)))].sort((a,b)=>a==='(solution)'?-1:b==='(solution)'?1:a.localeCompare(b));
  const sel=document.getElementById('as-pick');
  if(!sel.options.length){ names.forEach(n=>{const o=document.createElement('option'); o.value=o.textContent=n; sel.appendChild(o);}); const h=new URLSearchParams(location.hash.replace(/^#/,'')).get('assembly'); sel.value=asPick||(h&&names.includes(h)?h:'(solution)'); sel.addEventListener('change',()=>{asPick=sel.value; history.replaceState(null,'','#assembly='+encodeURIComponent(asPick)); renderAssembly();}); }
  const pick=sel.value||'(solution)';
  const days=Dd.filter(d=>inRange(d.date)), L=days.map(d=>d.date), g=k=>days.map(d=>(d.sections[pick]||{})[k]??null);
  const last=Dd[Dd.length-1];
  document.getElementById('as-config').textContent=last.config||'?';
  const newest=[...new Set(Dd.map(d=>d.version||'?'))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).pop();
  const stale=Dd.filter(d=>(d.version||'?')!==newest||d.tokSrc==='estimate').length;
  document.getElementById('as-meta').textContent=`${Dd.length} days scored, latest ${last.date} at ${last.commit}, reforge ${last.version}, run ${last.seconds?.total||'?'} s. ${stale? stale+' day(s) on an older reforge or estimated tokens, due for a rerun.' : 'Every day is on the newest reforge with exact tokens.'}`;
  line('as-score', L, [{label:'Surface', data:g('surf'), slot:0},{label:'Implementation', data:g('impl'), slot:1},{label:'Total', data:g('score'), slot:4}]);
  line('as-size', L, [{label:'Production lines', data:g('loc'), slot:0},{label:'Test lines', data:g('testLoc'), slot:1}], {log:true});
  line('as-cov', L, [{label:'Coverage %', data:g('cov'), slot:2}], {y:{max:100}});
  line('as-exp', L, [{label:'Exported read', data:g('expRead'), slot:0},{label:'Exported write', data:g('expWrite'), slot:1},{label:'Unused externally', data:g('expUnused'), slot:4}]);
  line('as-tok', L, [{label:'Production tokens', data:g('tokens'), slot:0},{label:'Test tokens', data:g('testTokens'), slot:1}], {log:true});
  line('as-cog', L, [{label:'Avg cognitive', data:g('cog'), slot:0},{label:'Max cognitive', data:g('cogMax'), slot:1}], {log:true});
  const t=theme(); const secs=Object.entries(last.sections).filter(([n])=>n!=='(solution)');
  const byScore=[...secs].sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  bars('as-today-score', byScore.map(x=>x[0]), [{label:'Score', data:byScore.map(x=>x[1].score), colors:t.s[0]}], {horizontal:true});
  const byCov=[...secs].sort((a,b)=>(b[1].cov??-1)-(a[1].cov??-1));
  bars('as-today-cov', byCov.map(x=>x[0]), [{label:'Coverage %', data:byCov.map(x=>x[1].cov??0), colors:byCov.map(x=>x[1].cov==null?t.fg3:t.s[2])}], {horizontal:true});
  const byRatio=[...secs].sort((a,b)=>(b[1].testRatio||0)-(a[1].testRatio||0));
  bars('as-today-ratio', byRatio.map(x=>x[0]), [{label:'Test / prod tokens', data:byRatio.map(x=>x[1].testRatio), colors:t.s[1]}], {horizontal:true});
  const vers=[...new Set(Dd.map(d=>d.version||'?'))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  line('as-prov', L, [{label:'Reforge', data:days.map(d=>vers.indexOf(d.version||'?')), extra:days.map(d=>`${d.version||'?'}  config ${d.config||'?'}  tokens ${d.tokSrc||'?'}${d.sdk?'  sdk override':''}`), slot:4, stepped:true}], {yfmt:v=>vers[Math.round(v)]??'', y:{min:-0.5, max:vers.length-0.5, ticks:{stepSize:1, color:t.fg3, callback:v=>Number.isInteger(v)?vers[v]:''}}});
  // Version runs over every collected day, so gaps (not yet rescored) show as their own rows.
  const verOf=Object.fromEntries([...(D.secFailed||[]),...Dd].map(d=>[d.date,(d.version||'?')+(d.build==='failed'?' (build failed)':'')]));
  const vr=[]; for(const date of [...new Set([...D.stats.map(r=>r[0]),...Object.keys(verOf)])].sort()){ const v=verOf[date]||'not scored per day yet'; const r=vr[vr.length-1]; if(r&&r.v===v){r.to=date;r.n++;} else vr.push({v,from:date,to:date,n:1}); }
  document.getElementById('as-versions').innerHTML='<table><thead><tr><th>Reforge</th><th>From</th><th>To</th><th>Days</th></tr></thead><tbody>'+vr.map(r=>`<tr><td>${r.v}</td><td>${r.from}</td><td>${r.to}</td><td>${r.n}</td></tr>`).join('')+'</tbody></table>';
  const sc=Object.fromEntries((D.statsSeconds||[]).filter(x=>x[1]!=null));
  line('as-cost', L, [{label:'Build', data:days.map(d=>d.seconds?.build??null), slot:0},{label:'Tests', data:days.map(d=>d.testSeconds??null), slot:1},{label:'Snapshot', data:days.map(d=>d.seconds?.snapshot??null), slot:2},{label:'Surface-score', data:days.map(d=>d.seconds?.surface??null), slot:4},{label:'Stats collector', data:days.map(d=>sc[d.date]??null), slot:3}], {log:true});
  const f=D.secFailed||[]; document.getElementById('as-failed').textContent = f.length? `Days without a row: ${f.map(x=>`${x.date} (${x.build})`).join(', ')}` : 'Every attempted day produced rows.';
}
function addDays(d,n){const x=new Date(d+'T00:00:00Z'); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10);}
function renderStatic(){
  const t=theme();
  const last=D.modules[D.modules.length-1];
  const sz=Object.entries(last.loc).filter(([n])=>!['Base','Analyzers'].includes(n)).sort((a,b)=>b[1]-a[1]);
  bars('m-bars', sz.map(x=>x[0]), [{label:'Lines', data:sz.map(x=>x[1]), colors:sz.map(x=>x[0]==='Web'? t.fg3 : t.s[3])}], {horizontal:true});
  const edges=[0,1000,2000,4000,8000,12000,16000,20000,30000]; const hist=edges.slice(0,-1).map((e,i)=>sz.filter(x=>x[1]>=e&&x[1]<edges[i+1]).length);
  bars('m-hist', edges.slice(0,-1).map((e,i)=>`${fmt(e)}–${fmt(edges[i+1])}`), [{label:'Sections', data:hist, slot:3, extra:edges.slice(0,-1).map((e,i)=>sz.filter(x=>x[1]>=e&&x[1]<edges[i+1]).map(x=>x[0]).join(', '))}], {rawLabels:true});
  charts['m-hist'].options.plugins.tooltip.callbacks.afterLabel=c=>c.dataset.extra[c.dataIndex]; charts['m-hist'].options.scales.x.ticks.autoSkip=false; charts['m-hist'].options.scales.x.ticks.maxRotation=40; charts['m-hist'].options.scales.x.ticks.minRotation=40; charts['m-hist'].options.scales.x.ticks.font={size:10}; charts['m-hist'].update();
  const lastDeps=D.modules[D.modules.length-1].deps;
  if(lastDeps){ const outd={}, ind={}; lastDeps.nodes.forEach(n=>{outd[n]=0;ind[n]=0;}); lastDeps.edges.forEach(([a,b])=>{ if(['Base','Analyzers'].includes(b)) return; outd[a]++; ind[b]++; });
    const nodes=lastDeps.nodes.filter(n=>!['Base','Analyzers'].includes(n)).sort((a,b)=>(outd[b]+ind[b])-(outd[a]+ind[a]));
    bars('d-today', nodes, [{label:'Referenced by', data:nodes.map(n=>ind[n]), slot:0},{label:'References', data:nodes.map(n=>outd[n]), slot:1}], {horizontal:true}); }
  if(D.semDeps){ const sd=D.semDeps.map(x=>({n:x.section, uses:x.usesSections.length, used:x.usedBySections.length})).sort((a,b)=>(b.uses+b.used)-(a.uses+a.used));
    bars('d-sem', sd.map(x=>x.n), [{label:'Depended on by', data:sd.map(x=>x.used), slot:0},{label:'Depends on', data:sd.map(x=>x.uses), slot:1}], {horizontal:true}); }
  const cross=D.surface.map(x=>({name:x.name, pts:x.cross||0})).filter(x=>x.pts>0).sort((a,b)=>b.pts-a.pts).slice(0,20);
  bars('d-cross', cross.map(x=>x.name), [{label:'Cross-section points', data:cross.map(x=>x.pts), slot:1}], {horizontal:true});
  if(D.runs){ bars('s-runs', D.runs.map(r=>r.date+' · '+r.version), [{label:'Surface', data:D.runs.map(r=>r.surface), slot:0},{label:'Internal', data:D.runs.map(r=>r.internal), slot:1}], {rawLabels:true}); charts['s-runs'].options.scales.x.ticks.autoSkip=false; charts['s-runs'].update(); }
  const tl=D.modules[D.modules.length-1].testLoc||{}; const tsz=sz.map(x=>[x[0], tl[x[0]]||0]);
  bars('m-tests', tsz.map(x=>x[0]), [{label:'Test lines', data:tsz.map(x=>x[1]), slot:3}], {horizontal:true});
  const g=D.surface.slice(0,20);
  bars('s-groups', g.map(x=>x.name), [{label:'Surface', data:g.map(x=>x.surface), stack:'a'},{label:'Internal', data:g.map(x=>x.internal), stack:'a', slot:1}], {horizontal:true, stacked:true});
  const ru=D.byRule.slice(0,16);
  bars('s-rules', ru.map(x=>x[0].replace(/([A-Z])/g,' $1').toLowerCase()), [{label:'Points', data:ru.map(x=>x[1]), slot:0}], {horizontal:true});
  // tiles
  const a=S[S.length-1], b=S.find(r=>r.date>=addDays(a.date,-30)), r0=R[R.length-1], rb=R.find(x=>x.commit_date>=addDays(a.date,-30));
  const tile=(k,v,d,good)=>`<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="d ${d==null?'':(good?'up':'down')}">${d==null?'&nbsp;':d}</div></div>`;
  const delta=(x,y,f=fmt,lowerGood=false)=>{const d=x-y; const s=(d>=0?'+':'')+f(d)+' / 30d'; return [s, lowerGood? d<=0 : d>=0];};
  let dl;
  document.getElementById('tiles').innerHTML=[
    (dl=delta(a.app,b.app), tile('App lines', fmt(a.app), dl[0], dl[1])),
    (dl=delta(a.test,b.test), tile('Test lines', fmt(a.test), dl[0], dl[1])),
    (dl=delta(a.test/(a.app+a.test), b.test/(b.app+b.test), v=>(v*100).toFixed(1)+' pt'), tile('Test ratio', pct(a.test/(a.app+a.test)), dl[0], dl[1])),
    (dl=delta(a.md,b.md,fmt,true), tile('Markdown lines', fmt(a.md), dl[0], dl[1])),
    (dl=delta(r0.avg_reach,rb.avg_reach,fmt,true), tile('Avg reach', fmt(r0.avg_reach), dl[0], dl[1])),
    (dl=delta(r0.cycle_count,rb.cycle_count,fmt,true), tile('Dependency cycles', fmt(r0.cycle_count), dl[0], dl[1])),
    (dl=delta(r0.p95_class_loc,rb.p95_class_loc,fmt,true), tile('p95 class LOC', fmt(r0.p95_class_loc), dl[0], dl[1])),
    tile('Sections', sz.length-1, 'plus the Web shell', true)
  ].join('');
  // table
  const rows=S.slice(-30).reverse(); const cols=['date','app','test','md','mig','classes','ifaces','plus','minus'];
  document.getElementById('table').innerHTML='<table><thead><tr>'+cols.map(c=>`<th>${c}</th>`).join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+cols.map(c=>`<td>${c==='date'?r[c]:fmt(r[c])}</td>`).join('')+'</tr>').join('')+'</tbody></table>';
}
document.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click',()=>{range=b.dataset.range; document.querySelectorAll('[data-range]').forEach(x=>x.setAttribute('aria-pressed',x===b)); render(); try{localStorage.setItem('hct-range',range)}catch(e){}}));
document.querySelectorAll('[data-scale]').forEach(b=>b.addEventListener('click',()=>{scale=b.dataset.scale; document.querySelectorAll('[data-scale]').forEach(x=>x.setAttribute('aria-pressed',x===b)); render();}));
document.querySelectorAll('[data-smooth]').forEach(b=>b.addEventListener('click',()=>{smooth=+b.dataset.smooth; document.querySelectorAll('[data-scale]').forEach(b=>b.addEventListener('click',()=>{scale=b.dataset.scale; document.querySelectorAll('[data-scale]').forEach(x=>x.setAttribute('aria-pressed',x===b)); render();}));
document.querySelectorAll('[data-smooth]').forEach(x=>x.setAttribute('aria-pressed',x===b)); render();}));
try{ const r=localStorage.getItem('hct-range'); if(r){range=r; document.querySelectorAll('[data-range]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.range===r));} }catch(e){}
renderStatic(); render();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{renderStatic();render();});
new MutationObserver(()=>{renderStatic();render();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});

