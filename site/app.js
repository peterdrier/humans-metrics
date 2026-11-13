// Each dataset is docs/data/<key>.json, written by site/build.py.
const KEYS = ["statsCols", "stats", "refCols", "ref", "modules", "git", "prs", "actions", "secDays", "statsSeconds", "secFailed", "semDeps", "top", "files", "reachTop", "topFiles", "generated"];
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

let range='all', res='day', scale='log';
const inRange = d => range==='all' ? true : range==='split' ? d>=SPLIT : d>='2026-07-20';

// The time axis at the current resolution. Each point has an end date; a window of n calendar days ending there picks the rows.
// day: every collected day in range, a chart's own window (n) kept. 7d: windows of at least 7 days. week: one point per UTC week
// (labelled by its Monday, ending Sunday), windows of at least 7 days, so a weekly window is exactly that week.
//   level(get)    a reading such as lines or a percentile: the day's value, the 7-day mean, or the week's last value
//   avg(get)      a per-day reading best averaged over the week, such as collection seconds
//   flow(get, n)  a count: summed over the window
//   win(f, n)     anything else, such as a rate or a median: f gets the window's rows
//   row()         the row a level reads, for hover detail
function tl(rows, key='date', from=''){
  const ds=rows.map(r=>r[key]).filter(d=>d>=from&&inRange(d));
  const pts=res==='week'? [...new Set(ds.map(weekOf))].map(w=>({label:w, end:addDays(w,6)})) : ds.map(d=>({label:d, end:d}));
  const at=(end,n)=>{const lo=addDays(end,-n); return rows.filter(r=>r[key]<=end&&r[key]>lo&&r[key]>=from);};
  const n_=n=>res==='day'? n : Math.max(7,n);
  const mean=v=>{v=v.filter(x=>x!=null&&isFinite(x)); return v.length? v.reduce((a,b)=>a+b,0)/v.length : null;};
  const last=p=>{const w=at(p.end,res==='week'?7:1); return w[w.length-1];};
  const L=pts.map(p=>p.label); L.week=res==='week';
  return { L,
    level: get=>pts.map(p=>{ if(res==='7d') return mean(at(p.end,7).map(get)); const r=last(p); return r? get(r) : null; }),
    avg: get=>pts.map(p=>mean(at(p.end,res==='day'?1:7).map(get))),
    flow: (get,n=1)=>pts.map(p=>at(p.end,n_(n)).reduce((a,r)=>a+(get(r)||0),0)),
    win: (f,n=1)=>pts.map(p=>f(at(p.end,n_(n)))),
    row: ()=>pts.map(last) };
}

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
      callbacks:{ title:c=>c.length&&c[0].chart.data.labels.week? 'Week of '+c[0].label : c[0]?.label, label:c=>` ${c.dataset.label}: ${(yfmt||fmt)(c.parsed.y)}${c.dataset.extra? '  '+(c.dataset.extra[c.dataIndex]||''):''}` } }, ...extra.plugins },
    scales:{ x:{type:'category', ticks:{color:t.fg3, maxTicksLimit:8, maxRotation:0, autoSkip:true, callback:function(v){const l=this.getLabelForValue(v);return l? l.slice(5):'';}}, grid:{display:false}, border:{color:t.line}},
             y:{type: logy?'logarithmic':'linear', ticks:{color:t.fg3, maxTicksLimit:5, callback:v=>(yfmt||fmt)(v)}, grid:{color:t.grid}, border:{display:false}, beginAtZero:!logy, ...extra.y} } };
}
const splitBand = { id:'band', afterDraw(ch){ const x=ch.scales.x, ls=ch.data.labels; let i=-1; ls.forEach((l,j)=>{ if(/^\d{4}-\d\d-\d\d$/.test(l)&&l<=SPLIT) i=j; }); if(i<0||ls[ls.length-1]<=SPLIT) return; const px=x.getPixelForValue(i); const c=ch.ctx; c.save(); c.strokeStyle=css('--fg-3'); c.setLineDash([3,3]); c.lineWidth=1; c.beginPath(); c.moveTo(px,ch.chartArea.top); c.lineTo(px,ch.chartArea.bottom); c.stroke(); c.restore(); } };
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
  const lg=document.getElementById('l-'+id.slice(2)); if(lg && series.length>1) lg.innerHTML=series.map((s,i)=>`<span><i style="background:${typeof s.colors==='string'? s.colors : t.s[s.slot??i]}"></i>${s.label}</span>`).join('');
}
const pct = v => (v*100).toFixed(1)+'%';

function render(){
  document.querySelectorAll('[data-per]').forEach(h=>h.textContent=h.dataset.per.replace('{per}',{day:'day','7d':'7 days',week:'week'}[res]));
  const T=tl(S), L=T.L, lv=T.level;
  line('c-lines', L, [{label:'App lines', data:lv(r=>r.app), fill:true},{label:'Test lines', data:lv(r=>r.test), fill:true}], {log:true});
  line('c-mix', L, [{label:'C#', data:lv(r=>r.cs/r.app)},{label:'Razor', data:lv(r=>r.cshtml/r.app)},{label:'RESX', data:lv(r=>r.resx/r.app)}], {yfmt:pct});
  line('c-classes', L, [{label:'Classes', data:lv(r=>r.classes)}], {log:true});
  line('c-ifaces', L, [{label:'Interfaces', data:lv(r=>r.ifaces)}], {log:true});
  line('c-ctrl', L, [{label:'Controllers', data:lv(r=>r.ctrl)},{label:'Views', data:lv(r=>r.views), slot:1}], {log:true});
  line('c-resx', L, [{label:'Resx keys', data:lv(r=>r.keys)}]);
  line('c-md', L, [{label:'Markdown lines', data:lv(r=>r.md), slot:1, fill:true}], {log:true});
  line('c-mig', L, [{label:'Migration lines', data:lv(r=>r.mig), slot:1, fill:true}], {log:true});
  line('c-cmt', L, [{label:'Comment share', data:lv(r=>r.cscmt/r.cs), slot:1}], {yfmt:pct});
  line('c-docratio', L, [{label:'MD lines per app line', data:lv(r=>r.md/r.app), slot:1}]);
  renderChurn();
  line('c-lpc', L, [{label:'App lines per class', data:lv(r=>r.app/r.classes), slot:1}]);
  // One bar per UTC week (Monday start): last level of the week minus last level of the week before. The repo starts empty, so week one counts from zero.
  const wkEnd={}; S.forEach(r=>{wkEnd[weekOf(r.date)]=r.app+r.test;});
  const wks=Object.keys(wkEnd).sort(), lastDay=S[S.length-1].date;
  const wk=wks.map((w,i)=>({date:w, v:wkEnd[w]-(i?wkEnd[wks[i-1]]:0), partial:addDays(w,6)>lastDay})).filter(r=>inRange(r.date));
  const WL=wk.map(r=>r.date); WL.week=true;
  bars('c-weekly', WL, [{label:'Net lines', data:wk.map(r=>r.v), extra:wk.map(r=>r.partial?'week to date':''), colors:wk.map(r=>r.v>=0?theme().s[0]:theme().bad)}]);
  // reforge
  const TR=tl(R,'commit_date'), RR=TR.row();
  const one=(key,label,yfmt,extraKey,slot=2,log=false)=>line('r-'+key, TR.L, [{label, data:TR.level(x=>x[key]), extra:extraKey? RR.map(x=>x? String(x[extraKey]).replace(/^src\/(Sections\/)?/,'') : '') : null, slot}], {yfmt, log});
  one('avg_reach','Avg reach'); one('p95_reach','p95 reach'); one('max_reach','Max reach',null,'max_reach_file',2,true);
  const TT=tl((D.reachTop||[]).map(([date,reach,file])=>({date,reach,file})));
  line('r-reach_real', TT.L, [{label:'Max reach, wiring left out', data:TT.level(x=>x.reach), extra:TT.row().map(x=>x? x.file.replace(/^src\/(Sections\/)?/,'') : ''), slot:2}], {});
  one('core_size_pct','Core size',pct); one('cycle_count','Cycles'); one('avg_fanout','Avg fan-out'); one('max_fanout','Max fan-out',null,'max_fanout_file');
  one('avg_cyclomatic','Avg cyclomatic'); one('p95_cyclomatic','p95 cyclomatic'); one('max_cyclomatic','Max cyclomatic',null,'max_cyclomatic_method');
  one('avg_class_loc','Avg class LOC',null,null,2,true); one('p95_class_loc','p95 class LOC',null,null,2,true); one('max_class_loc','Max class LOC',null,'max_class_loc_name',2,true);
  // modules
  const TM=tl(D.modules), ML=TM.L, MR=TM.row();
  const sizes=m=>Object.entries(m.loc).filter(([n])=>!['Base','Analyzers'].includes(n)).map(([n,v])=>[n,v]).sort((a,b)=>b[1]-a[1]);
  const q=(arr,p)=>{const a=[...arr].sort((x,y)=>x-y); return a[Math.min(a.length-1,Math.floor(p*(a.length-1)))];};
  const gini=arr=>{const a=[...arr].sort((x,y)=>x-y),n=a.length,sum=a.reduce((x,y)=>x+y,0); if(!sum) return 0; let g=0; a.forEach((v,i)=>g+=(2*(i+1)-n-1)*v); return g/(n*sum);};
  line('m-count', ML, [{label:'Modules', data:TM.level(m=>sizes(m).length), slot:4, stepped:true}], {log:true});
  const TP=tl(D.modules,'date',SPLIT);
  line('m-quant', TP.L, [{label:'Median', data:TP.level(m=>q(sizes(m).map(x=>x[1]),.5)), slot:4},{label:'p90', data:TP.level(m=>q(sizes(m).map(x=>x[1]),.9)), slot:1}], {log:true});
  line('m-maxshare', ML, [{label:'Largest module share', data:TM.level(m=>{const z=sizes(m).map(x=>x[1]);return z[0]/z.reduce((a,b)=>a+b,0);}), slot:4}], {yfmt:pct});
  // dependencies
  const ds=k=>TM.level(m=>m.depSummary? m.depSummary[k] : null);
  line('d-edges', ML, [{label:'Modules', data:ds('nodeCount'), slot:0},{label:'Edges', data:ds('edgeCount'), slot:1}], {log:true});
  line('d-density', ML, [{label:'Density', data:ds('density'), slot:4}], {yfmt:pct});
  line('d-fanout', ML, [{label:'Avg fan-out', data:ds('avgFanOut'), slot:0},{label:'Max fan-out', data:ds('maxFanOut'), extra:MR.map(m=>m?.depSummary?.maxFanOutNode), slot:1}]);
  line('d-fanin', ML, [{label:'Max fan-in', data:ds('maxFanIn'), extra:MR.map(m=>m?.depSummary?.maxFanInNode), slot:4}]);
  renderLanes(); renderFlow(); renderCI(); renderAssembly(); renderFiles(); renderRules();
  line('m-gini', ML, [{label:'Gini', data:TM.level(m=>gini(sizes(m).map(x=>x[1]))), slot:4}], {y:{max:1}});
}

// Gross churn from git, not the net change of the stats rows. The axis is clipped at the 95th percentile bar so one-off moves
// (migration consolidations, file moves) do not flatten everything else; the caption names the largest clipped bars.
function renderChurn(){
  const G=D.git; if(!G||!G.length) return;
  const T=tl(G), t=theme(), sum=(g,k)=>Object.values(g.lanes).reduce((a,v)=>a+(v[k]||0),0);
  const add=T.flow(g=>sum(g,'added')), del=T.flow(g=>sum(g,'deleted'));
  const nz=[...add,...del].filter(v=>v>0).sort((a,b)=>a-b), p95=nz.length? nz[Math.floor(.95*(nz.length-1))] : 0;
  const cap=Math.max(1000, Math.ceil(p95/10000)*10000);
  bars('c-churn', T.L, [{label:'Added', data:add, colors:t.good},{label:'Removed', data:del.map(v=>-v), colors:t.bad}], {stacked:true, y:{beginAtZero:true, min:-cap, max:cap}});
  const big=T.L.map((l,i)=>[l,add[i],del[i]]).filter(([,a,d])=>a>cap||d>cap).sort((x,y)=>Math.max(y[1],y[2])-Math.max(x[1],x[2]));
  const show=big.slice(0,4).map(([l,a,d])=>`${l.slice(5)} (+${fmt(a)} / -${fmt(d)})`).join(', ');
  document.getElementById('c-churn-why').textContent='Lines added (up) and removed (down), from git numstat over non-merge commits, all files (migrations and docs included). '
    + `Axis clipped at ${fmt(cap)}, the 95th percentile bar.` + (big.length? ` ${big.length} bar${big.length>1?'s':''} past it, largest ${show}. Hover shows the raw figure.` : '');
}

function renderLanes(){
  const G=D.git; if(!G||!G.length) return;
  const LANES=['automation','peter','other'];
  const NAMES={automation:'Automation',peter:'Peter',other:'Others'};
  const T=tl(G,'date','2026-03-03'), L=T.L;
  const roll=(n,f)=>T.win(w=>{const c={}; w.forEach(g=>f(g,c)); return c;}, n);
  const L28=roll(28,(g,c)=>{for(const [k,v] of Object.entries(g.lanes)){c[k]=c[k]||{prs:0,lines:0}; c[k].prs+=v.prs; c[k].lines+=v.added+v.deleted;}});
  const used=LANES.filter(k=>L28.some(c=>c[k]));
  const t=theme(); const col={automation:t.fg3,peter:t.s[0],other:t.s[1]};
  const stack=(id,key,lg)=>{
    const ds=used.map(k=>({label:NAMES[k], data:L28.map(c=>{ const tot=Object.values(c).reduce((a,v)=>a+v[key],0); return tot? (c[k]?c[k][key]:0)/tot : null;}), borderColor:col[k], backgroundColor:col[k], fill:true, borderWidth:1, pointRadius:0, pointHoverRadius:4, tension:0, spanGaps:true}));
    if(charts[id]) charts[id].destroy();
    const o=base(t,pct,{}); o.scales.y.stacked=true; o.scales.y.max=1; o.scales.y.type='linear';
    charts[id]=new Chart(document.getElementById(id),{type:'line',data:{labels:L,datasets:ds},options:o,plugins:[splitBand]});
    document.getElementById(lg).innerHTML=used.map(k=>`<span><i style="background:${col[k]}"></i>${NAMES[k]}</span>`).join('');
  };
  stack('g-lines','lines','l-lines-lanes'); stack('g-prs','prs','l-prs-lanes');
  line('g-rate', L, [{label:'PRs / 7 days', data:T.flow(g=>Object.values(g.lanes).reduce((a,v)=>a+v.prs,0),7), slot:0}]);
  line('g-authors', L, [{label:'Authors / 7 days', data:T.win(w=>Math.max(0,...w.map(g=>g.authors)),7), slot:1}]);
  const R28=roll(28,(g,c)=>{for(const [k,v] of Object.entries(g.routines)) c[k]=(c[k]||0)+v;});
  const rts=[...new Set(R28.flatMap(c=>Object.keys(c)))];
  line('g-routines', L, rts.map((k,j)=>({label:k, data:R28.map(c=>c[k]||0), slot:j%5})));
  const M28=roll(28,(g,c)=>{for(const [k,v] of Object.entries(g.models)) c[k]=(c[k]||0)+v;});
  const mt={}; G.forEach(g=>{for(const [k,v] of Object.entries(g.models)) mt[k]=(mt[k]||0)+v;});
  const top=Object.entries(mt).sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0]);
  line('g-models', L, top.map((k,j)=>({label:k.replace(/^Claude /,''), data:M28.map(c=>c[k]||0), slot:j%5})));
}

function renderFlow(){
  const P=D.prs; if(!P||!P.length) return;
  const T=tl(P,'date','2026-02-18'), L=T.L;
  const sumL=(w,f)=>w.reduce((a,p)=>a+Object.values(p.lanes).reduce((b,l)=>b+(f(l)||0),0),0);
  const q=(arr,p)=>{if(!arr.length) return null; const a=[...arr].sort((x,y)=>x-y); return a[Math.min(a.length-1,Math.floor(p*(a.length-1)))];};
  line('p-flow', L, [{label:'Opened', data:T.flow(p=>p.opened,7), slot:1},{label:'Merged', data:T.win(w=>sumL(w,l=>l.merged),7), slot:0}]);
  const ttm=w=>w.flatMap(p=>Object.values(p.lanes).flatMap(l=>l.ttm_hours||[]));
  line('p-ttm', L, [{label:'Median h', data:T.win(w=>q(ttm(w),.5),28), slot:0},{label:'p90 h', data:T.win(w=>q(ttm(w),.9),28), slot:1}], {log:true});
  const g=k=>T.flow(p=>p.gate[k],28);
  line('p-gate', L, [{label:'Reviews', data:g('reviews'), slot:0},{label:'Approvals', data:g('approvals'), slot:1},{label:'Merges', data:g('merges'), slot:4},{label:'Review comments', data:g('review_comments'), slot:2}]);
  line('p-comments', L, [{label:'Bot', data:T.win(w=>sumL(w,l=>l.bot_comments),28), slot:4},{label:'Human', data:T.win(w=>sumL(w,l=>l.human_comments),28), slot:0}], {log:true});
  const per=k=>T.win(w=>{const m=sumL(w,l=>l.merged); return m? sumL(w,l=>l[k])/m : null;},28);
  line('p-cr', L, [{label:'Bot / PR', data:per('bot_comments'), slot:4},{label:'Human / PR', data:per('human_comments'), slot:0}]);
  const bt={}; P.forEach(p=>{for(const [k,v] of Object.entries(p.bots)) bt[k]=(bt[k]||0)+v;});
  const top=Object.entries(bt).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);
  line('p-bots', L, top.map((k,j)=>({label:k.replace('[bot]',''), data:T.flow(p=>p.bots[k],28), slot:j%5})));
}
function renderCI(){
  const A=D.actions; if(!A||!A.length) return;
  const T=tl(A), L=T.L;
  const t=theme();
  const c=k=>T.flow(p=>p.conclusions[k]);
  bars('a-runs', L, [{label:'Success', data:c('success'), colors:t.good, stack:'a'},{label:'Failure', data:c('failure'), colors:t.bad, stack:'a'},{label:'Cancelled', data:c('cancelled'), colors:t.fg3, stack:'a'}], {stacked:true});
  line('a-fail', L, [{label:'Failure rate', data:T.win(w=>{const n=w.reduce((a,p)=>a+p.runs,0); return n? w.reduce((a,p)=>a+(p.conclusions.failure||0)+(p.conclusions.cancelled||0),0)/n : null;},7), slot:1}], {yfmt:pct});
  const hrs=p=>Object.values(p.workflows).reduce((a,w)=>a+(w.duration_s||0),0)/3600;
  line('a-hours', L, [{label:'Compute hours / day', data:T.win(w=>w.length? w.reduce((a,p)=>a+hrs(p),0)/7 : null,7), slot:4}], {log:true});
  const wt={}; A.forEach(p=>{for(const [k,v] of Object.entries(p.workflows)) wt[k]=(wt[k]||0)+v.runs;});
  const top=Object.entries(wt).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);
  line('a-wf', L, top.map((k,j)=>({label:k, data:T.flow(p=>(p.workflows[k]||{}).runs,7), slot:j%5})), {log:true});
  line('a-build', L, [{label:'Build and Test, min', data:T.win(w=>{w=w.map(p=>p.workflows['Build and Test']).filter(Boolean); const n=w.reduce((a,x)=>a+x.runs,0); return n? w.reduce((a,x)=>a+x.duration_s,0)/n/60 : null;},7), slot:0}]);
  streak('a-int','Integration tests'); streak('a-e2e','E2E Tests (QA)');
  line('a-rerun', L, [{label:'Re-runs / 7 days', data:T.flow(p=>p.reruns,7), slot:1}]);
}

// One workflow by day, last 60 collected days: runs that did not fail and runs that failed, with the streak spelled out.
function streak(id, wf){
  const A=D.actions, t=theme(), rows=A.map(p=>({date:p.date, w:p.workflows[wf]})).filter(r=>r.w&&r.w.runs&&r.w.success!=null);   // older records cannot tell a pass from a cancelled run
  const why=document.getElementById(id+'-why'); if(!rows.length){ why.textContent='No runs collected.'; return; }
  const win=rows.slice(-60), ok=r=>r.w.success, other=r=>r.w.runs-r.w.success-(r.w.failure||0);
  bars(id, win.map(r=>r.date), [{label:'Passed', data:win.map(ok), colors:t.good, stack:'a'},{label:'Failed', data:win.map(r=>r.w.failure||0), colors:t.bad, stack:'a'},{label:'Cancelled or skipped', data:win.map(other), colors:t.fg3, stack:'a'}], {stacked:true});
  const last=rows[rows.length-1], green=[...rows].reverse().find(r=>ok(r)>0);
  let n=0; for(let i=rows.length-1;i>=0&&ok(rows[i])===0;i--) n++;
  const w14=rows.filter(r=>r.date>addDays(last.date,-14)), f14=w14.reduce((a,r)=>a+(r.w.failure||0),0), r14=w14.reduce((a,r)=>a+r.w.runs,0);
  why.textContent=(n? `No passing run on the last ${n} day${n>1?'s':''} with runs, since ${rows[rows.length-n].date}. ` : `Last run day ${last.date} had a passing run. `)
    + (n&&green? `Last day with a pass: ${green.date}. ` : n? `No passing run since pass counts begin on ${rows[0].date}. ` : '')
    + `${f14} of ${r14} runs failed in the 14 days to ${last.date}.`;
}

// Decision panels: 30-day movers per section and per rule, and the top lists of the latest reforge day.
function renderFocus(){
  const Dd=D.secDays; if(!Dd||!Dd.length) return;
  const last=Dd[Dd.length-1], base=Dd.find(d=>d.date>=addDays(last.date,-30));
  const sign=v=>(v>0?'+':'')+fmt(v);
  const cell=(v,lowerGood=true,unit='')=>v==null? '<td class="dim">new</td>' : `<td class="${v===0?'dim':((v<0)===lowerGood?'good':'bad')}">${sign(v)}${unit}</td>`;
  const tbl=(id,head,rows)=>{document.getElementById(id).innerHTML='<table><thead><tr>'+head.map(h=>`<th>${h}</th>`).join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.join('')+'</tr>').join('')+'</tbody></table>';};
  const td=v=>`<td>${v}</td>`;
  const mv=Object.entries(last.sections).filter(([n])=>n!=='(solution)').map(([n,v])=>{const b=base.sections[n]; const d=k=>b&&b[k]!=null&&v[k]!=null? v[k]-b[k] : null;
    return {n, v, score:d('score'), loc:d('loc'), methods:d('methods'), cov:d('cov'), sort:b? v.score-b.score : v.score};});
  const row=m=>[td(m.n), td(fmt(m.v.score)), cell(m.score), cell(m.loc), cell(m.methods), td(m.v.cov==null?'':m.v.cov+'%'), cell(m.cov,false,' pt')];
  const head=['Section','Score','30d','Lines','Methods','Cov','30d'];
  tbl('fo-up', head, [...mv].sort((a,b)=>b.sort-a.sort).filter(m=>m.sort>0).slice(0,10).map(row));
  tbl('fo-down', head, [...mv].sort((a,b)=>a.sort-b.sort).filter(m=>m.sort<0).slice(0,10).map(row));
  const sol=last.sections['(solution)'], sb=base.sections['(solution)'];
  document.getElementById('fo-sub').textContent=`What moved between ${base.date} and ${last.date}, and what stands out on the latest day. These panels ignore the range filter. Solution over the same window: score ${sign(sol.score-sb.score)} to ${fmt(sol.score)}, production lines ${sign(sol.loc-sb.loc)}, methods ${sign(sol.methods-sb.methods)}, coverage ${sign(sol.cov-sb.cov)} pt to ${sol.cov}%.`;
  const [lastR,baseR]=ruleDays();
  const rules=!lastR? [] : Object.keys({...baseR.byRule,...lastR.byRule}).map(k=>({k, now:lastR.byRule[k]||0, d:(lastR.byRule[k]||0)-(baseR.byRule[k]||0)})).filter(r=>r.d).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,10);
  if(lastR) document.getElementById('fo-rules-why').textContent=`Change in points per surface-score rule between ${baseR.date} and ${lastR.date}, largest moves first.`;
  tbl('fo-rules', ['Rule','Points','30d','Change'], rules.map(r=>[td(ruleName(r.k)), td(fmt(r.now)), cell(r.d), cell(r.now-r.d? Math.round(1000*r.d/(r.now-r.d))/10 : null, true, '%')]));
  const F=D.topFiles;
  if(F){ document.getElementById('fo-reach-why').textContent=`Each section's file of highest reach on ${F.date}, its Section.cs left out. Reach is the files it depends on, directly or through others; fan-out the files it names directly.`;
    tbl('fo-reach', ['File','Section','Reach','Fan-out'], F.sections.slice(0,10).map(f=>[td(f.file.split('/').pop()), td(f.section), td(f.reach), td(f.fanOut)])); }
  const T=D.top; if(!T) return;
  document.getElementById('fo-methods-why').textContent=`Cyclomatic complexity on ${T.date}, the most complex method of each class, migrations left out.`;
  tbl('fo-methods', ['Method','Section','Cyclomatic'], T.methods.map(m=>[td(m.name), td(m.section), td(m.cyclomatic)]));
  const crow=c=>[td(c.name), td(c.section), td(fmt(c.lines)), td(c.methods), td(c.risk)];
  tbl('fo-classes', ['Class','Section','Lines','Methods','Risk'], T.classes.map(crow));
  tbl('fo-risk', ['Class','Section','Lines','Methods','Risk'], T.risk.map(crow));
}
// The latest day with rule totals (a day whose surface-score pass failed has rows but none) and the first such day inside its 30-day window.
function ruleDays(){ const R=D.secDays.filter(d=>d.byRule), last=R[R.length-1]; return last? [last, R.find(d=>d.date>=addDays(last.date,-30))] : []; }
const ruleName=k=>k.replace(/([A-Z])/g,' $1').toLowerCase();

// Score by rule: the five largest rules on the latest day plus the rest, stacked over time, as points and as shares.
function renderRules(){
  const Dd=D.secDays; if(!Dd||!Dd.length) return;
  const t=theme(), [last,base]=ruleDays(); if(!last) return;
  const T=tl(Dd.filter(d=>d.byRule)), L=T.L;
  const top=Object.entries(last.byRule).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);
  const col=[...t.s, t.fg3], keys=[...top,'other'];
  const val=(d,k)=>k==='other'? Object.entries(d.byRule).filter(([r])=>!top.includes(r)).reduce((a,[,v])=>a+Math.max(v,0),0) : (d.byRule[k]||0);
  const area=(id,share)=>{
    const ds=keys.map((k,i)=>({label:k==='other'?'other rules':ruleName(k), data:T.level(d=>{const v=val(d,k); return share? v/keys.reduce((a,x)=>a+val(d,x),0) : v;}), borderColor:col[i], backgroundColor:col[i], fill:true, borderWidth:1, pointRadius:0, pointHoverRadius:4, tension:0, spanGaps:true}));
    if(charts[id]) charts[id].destroy();
    const o=base_(t,share); o.scales.y.stacked=true; o.scales.y.type='linear'; if(share) o.scales.y.max=1;
    charts[id]=new Chart(document.getElementById(id),{type:'line',data:{labels:L,datasets:ds},options:o,plugins:[splitBand]});
    document.getElementById('l-'+id.slice(2)).innerHTML=keys.map((k,i)=>`<span><i style="background:${col[i]}"></i>${k==='other'?'other rules':ruleName(k)}</span>`).join('');
  };
  area('s-ruletime',false); area('s-ruleshare',true);
  const ru=Object.entries(last.byRule).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  bars('s-rules', ru.map(x=>ruleName(x[0])), [{label:'Points', data:ru.map(x=>x[1]), slot:0}], {horizontal:true});
  charts['s-rules'].options.plugins.tooltip.callbacks.afterLabel=c=>{const k=ru[c.dataIndex][0], d=ru[c.dataIndex][1]-(base.byRule[k]||0); return ` ${d>0?'+':''}${fmt(d)} since ${base.date}`;}; charts['s-rules'].update();
}
const base_=(t,share)=>base(t, share? pct : null, {});

function renderFiles(){
  const F0=D.files||[], F=F0.filter(p=>inRange(p.date)); if(!F.length) return;
  document.getElementById('files').hidden=false;
  const T=tl(F0), L=T.L, last=F[F.length-1];
  // Five palette slots: the four largest folders today, the rest as "other".
  const cats=Object.keys(last.categories).sort((a,b)=>last.categories[b].bytes-last.categories[a].bytes);
  const top=cats.length>5? cats.slice(0,4) : cats, rest=cats.filter(k=>!top.includes(k));
  const get=(p,k,f)=>k==='other'? rest.reduce((a,r)=>a+((p.categories[r]||{})[f]||0),0) : ((p.categories[k]||{})[f]||0);
  const keys=rest.length? [...top,'other'] : top;
  const mb=v=>v==null?'':(v>=1024? (v/1024).toFixed(1)+' GB' : v.toFixed(v>=10?0:1)+' MB');
  line('f-bytes', L, keys.map((k,j)=>({label:k, data:T.level(p=>get(p,k,'bytes')/1048576), slot:j})), {yfmt:mb});
  line('f-count', L, keys.map((k,j)=>({label:k, data:T.level(p=>get(p,k,'count')), slot:j})));
  line('f-total', L, [{label:'Total stored', data:T.level(p=>p.bytes/1048576), fill:true, slot:0}], {yfmt:mb});
}

let asPick=null;
function renderAssembly(){
  const Dd=D.secDays; if(!Dd||!Dd.length) return;
  const names=[...new Set(Dd.flatMap(d=>Object.keys(d.sections)))].sort((a,b)=>a==='(solution)'?-1:b==='(solution)'?1:a.localeCompare(b));
  const sel=document.getElementById('as-pick');
  if(!sel.options.length){ names.forEach(n=>{const o=document.createElement('option'); o.value=o.textContent=n; sel.appendChild(o);}); const h=new URLSearchParams(location.hash.replace(/^#/,'')).get('assembly'); sel.value=asPick||(h&&names.includes(h)?h:'(solution)'); sel.addEventListener('change',()=>{asPick=sel.value; history.replaceState(null,'','#assembly='+encodeURIComponent(asPick)); renderAssembly();}); }
  const pick=sel.value||'(solution)';
  const T=tl(Dd), L=T.L, g=k=>T.level(d=>(d.sections[pick]||{})[k]??null), days=T.row();
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
  line('as-prov', L, [{label:'Reforge', data:days.map(d=>d? vers.indexOf(d.version||'?') : null), extra:days.map(d=>!d? '' : `${d.version||'?'}  config ${d.config||'?'}  tokens ${d.tokSrc||'?'}${d.sdk?'  sdk override':''}`), slot:4, stepped:true}], {yfmt:v=>vers[Math.round(v)]??'', y:{min:-0.5, max:vers.length-0.5, ticks:{stepSize:1, color:t.fg3, callback:v=>Number.isInteger(v)?vers[v]:''}}});
  // Version runs over every collected day, so gaps (not yet rescored) show as their own rows.
  const verOf=Object.fromEntries([...(D.secFailed||[]),...Dd].map(d=>[d.date,(d.version||'?')+(d.build==='failed'?' (build failed)':'')]));
  const vr=[]; for(const date of [...new Set([...D.stats.map(r=>r[0]),...Object.keys(verOf)])].sort()){ const v=verOf[date]||'not scored per day yet'; const r=vr[vr.length-1]; if(r&&r.v===v){r.to=date;r.n++;} else vr.push({v,from:date,to:date,n:1}); }
  document.getElementById('as-versions').innerHTML='<table><thead><tr><th>Reforge</th><th>From</th><th>To</th><th>Days</th></tr></thead><tbody>'+vr.map(r=>`<tr><td>${r.v}</td><td>${r.from}</td><td>${r.to}</td><td>${r.n}</td></tr>`).join('')+'</tbody></table>';
  const sc=Object.fromEntries((D.statsSeconds||[]).filter(x=>x[1]!=null));
  line('as-cost', L, [{label:'Build', data:T.avg(d=>d.seconds?.build??null), slot:0},{label:'Tests', data:T.avg(d=>d.testSeconds??null), slot:1},{label:'Snapshot', data:T.avg(d=>d.seconds?.snapshot??null), slot:2},{label:'Surface-score', data:T.avg(d=>d.seconds?.surface??null), slot:4},{label:'Stats collector', data:T.avg(d=>sc[d.date]??null), slot:3}], {log:true});
  const f=D.secFailed||[]; document.getElementById('as-failed').textContent = f.length? `Days without a row: ${f.map(x=>`${x.date} (${x.build})`).join(', ')}` : 'Every attempted day produced rows.';
}
function addDays(d,n){const x=new Date(d+'T00:00:00Z'); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10);}
function weekOf(d){return addDays(d,-((new Date(d+'T00:00:00Z').getUTCDay()+6)%7));}
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
  if(D.semDeps){ const sd=[...D.semDeps.sections].sort((a,b)=>(b.uses+b.usedBy)-(a.uses+a.usedBy));
    bars('d-sem', sd.map(x=>x.section), [{label:'Depended on by', data:sd.map(x=>x.usedBy), slot:0},{label:'Depends on', data:sd.map(x=>x.uses), slot:1}], {horizontal:true});
    document.getElementById('d-sem-why').textContent=`Semantic edges on ${D.semDeps.date}: section A injects a service interface owned by section B. Blue is how many sections depend on this one, orange how many it depends on. ${sd.length} sections, ${D.semDeps.edges} edges, Base left out since every section calls it.`;
    const cr=[...D.semDeps.sections].sort((a,b)=>(b.callsIn+b.callsOut)-(a.callsIn+a.callsOut)).slice(0,20);
    bars('d-cross', cr.map(x=>x.section), [{label:'Calls into it', data:cr.map(x=>x.callsIn), slot:0},{label:'Calls it makes', data:cr.map(x=>x.callsOut), slot:1}], {horizontal:true}); }
  const tl=D.modules[D.modules.length-1].testLoc||{}; const tsz=sz.map(x=>[x[0], tl[x[0]]||0]);
  bars('m-tests', tsz.map(x=>x[0]), [{label:'Test lines', data:tsz.map(x=>x[1]), slot:3}], {horizontal:true});
  renderFocus();
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
document.querySelectorAll('[data-res]').forEach(b=>b.addEventListener('click',()=>{res=b.dataset.res; document.querySelectorAll('[data-res]').forEach(x=>x.setAttribute('aria-pressed',x===b)); render(); try{localStorage.setItem('hct-res',res)}catch(e){}}));
try{ const r=localStorage.getItem('hct-range'); if(r){range=r; document.querySelectorAll('[data-range]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.range===r));} }catch(e){}
try{ const r=localStorage.getItem('hct-res'); if(['day','7d','week'].includes(r)){res=r; document.querySelectorAll('[data-res]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.res===r));} }catch(e){}
renderStatic(); render();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{renderStatic();render();});
new MutationObserver(()=>{renderStatic();render();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});

