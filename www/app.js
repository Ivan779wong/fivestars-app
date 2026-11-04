/* Five Stars 每日作战 — standalone app (GitHub Pages PWA + Android APK via Capacitor).
   Data: Firebase (Auth + Firestore) when www/firebase-config.js is filled in; otherwise local mode on this phone only. */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const addDays=(d,n)=>{const x=new Date(d.getTime());x.setDate(x.getDate()+n);return x;};
const fromIso=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const clone=o=>JSON.parse(JSON.stringify(o));
const WD=['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
const WDS=['日','一','二','三','四','五','六'];
const THEMES=[
  {k:'SUN',t:'自由安排',d:'休息、陪家人；有空就和 B 的朋友聊聊天'},
  {k:'MON',t:'Follow up day',d:'主要 Follow up 上星期联系的朋友'},
  {k:'TUE',t:'Open market day',d:'陌生市场 / Road Show / 陌生拜访'},
  {k:'WED',t:'转介绍日',d:'原有市场拿转介绍（至少 3 个）'},
  {k:'THU',t:'学习日',d:'Case study / Role play / 签单分享 / 晚会 Zoom'},
  {k:'FRI',t:'增员日',d:'陌生增员，至少拿 2 个联络'},
  {k:'SAT',t:'预约日',d:'电话预约下星期的 appointment / 整理 name list ABC'}
];
const PTS={sign:10,A:5,B:3,C:2};
const TLAB={sign:'签单',A:'找 A',B:'找 B',C:'新 C'};
const GOAL=20, A_TARGET=10, B_TARGET=30;
const SOURCES=['活动','转介绍','社交媒体','小红书','朋友 / 亲戚','陌生拜访','其他'];
const md=s=>{const d=fromIso(s);return (d.getMonth()+1)+'月'+d.getDate()+'日';};
const uidShort=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const CFG=window.FIREBASE_CONFIG||{};
const CLOUD=!!(CFG.apiKey&&CFG.projectId);
const NATIVE=!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform());
const LN=NATIVE&&window.Capacitor.Plugins?window.Capacitor.Plugins.LocalNotifications:null;

let TODAY=iso(new Date());
const S={db:null,auth:null,uid:null,email:'',leader:false,profile:{},clients:[],days:{},board:{},
  tab:'today',tier:'A',sel:null,selClients:[],selDays:{},selProfile:{},loaded:{c:false,d:false},
  stale:false,readonly:false,lastBoard:'',signedIn:false,loginMode:'login'};
let unsubs=[], selUnsubs=[];

function score(day){return day&&day.items?day.items.reduce((n,i)=>n+(i.pts||0),0):0;}
function blankDay(date){return {date,items:[],talks:[],posted:false,focus:false,review:false};}
function getDay(date){return S.days[date]||blankDay(date);}
function active(list){return (list||S.clients).filter(c=>c.status!=='signed');}
function counts(list){const c={A:0,B:0,C:0};active(list).forEach(x=>{if(c[x.tier]!=null)c[x.tier]++;});return c;}
function nameOf(uid){const b=S.board[uid]||{};return (b.nick&&b.nick.trim())||'顾问';}

/* ---------- local store (same API subset as Firestore compat) ---------- */
function localDB(){
  const KEY='fivestars-local-db'; let store={};
  try{store=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch(_){store={};}
  const listeners=new Set();
  let pt; const persist=()=>{clearTimeout(pt);pt=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(store));}catch(_){}},200);listeners.forEach(f=>{try{f();}catch(_){}});};
  const snap=(id,d)=>({id,exists:d!==undefined,data:()=>d===undefined?undefined:clone(d),metadata:{fromCache:false,hasPendingWrites:false}});
  const doc=p=>({id:p.split('/').pop(),path:p,
    set:d=>{store[p]=clone(d);setTimeout(persist);return Promise.resolve();},
    delete:()=>{delete store[p];setTimeout(persist);return Promise.resolve();},
    get:()=>Promise.resolve(snap(p.split('/').pop(),store[p])),
    onSnapshot(n){const f=()=>n(snap(p.split('/').pop(),store[p]));listeners.add(f);setTimeout(f);return()=>listeners.delete(f);}});
  const coll=(path,ord,lim)=>({path,
    orderBy:(f,d)=>coll(path,{f,d},lim),limit:n=>coll(path,ord,n),doc:id=>doc(path+'/'+id),
    onSnapshot(n){const f=()=>{let docs=Object.keys(store).filter(k=>k.startsWith(path+'/')&&k.slice(path.length+1).indexOf('/')<0).map(k=>snap(k.split('/').pop(),store[k]));
      if(ord)docs.sort((a,b)=>{const x=String((a.data()||{})[ord.f]||''),y=String((b.data()||{})[ord.f]||'');return ord.d==='desc'?y.localeCompare(x):x.localeCompare(y);});
      if(lim)docs=docs.slice(0,lim);n({docs,size:docs.length,empty:!docs.length,metadata:{fromCache:false}});};
      listeners.add(f);setTimeout(f);return()=>listeners.delete(f);}});
  return {doc,collection:p=>coll(p)};
}

/* ---------- toast & sheet ---------- */
let toastT;
function toast(msg){const r=$('#toastRoot');r.innerHTML='<div class="toast" role="status">'+esc(msg)+'</div>';clearTimeout(toastT);toastT=setTimeout(()=>{r.innerHTML='';},2800);}
function openSheet(html){$('#sheetRoot').innerHTML='<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">'+html+'</div></div>';}
function closeSheet(){$('#sheetRoot').innerHTML='';}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});

/* ---------- writes ---------- */
const queues={};
function handleErr(e){
  const code=(e&&e.code)||'';
  if(code==='permission-denied'){S.readonly=true;toast('没有权限保存，请联系 leader');render();}
  else if(code==='resource-exhausted'){toast('操作太快或资料已满，请稍后再试');}
  else if(code==='unauthenticated'){toast('登入已过期，请重新登入');}
  else{toast('暂时连不上，网络恢复后会自动同步');}
}
function enqueue(path,fn){const p=(queues[path]||Promise.resolve()).then(fn).catch(handleErr);queues[path]=p;return p;}
function canWrite(){if(!S.db||!S.uid){toast('请先登入');return false;}if(S.readonly){toast('没有权限保存，请联系 leader');return false;}return true;}
function saveDay(day){
  if(!canWrite())return;
  S.days[day.date]=day; render();
  const path='agents/'+S.uid+'/days/'+day.date;
  enqueue(path,()=>S.db.doc(path).set(day)); syncBoard();
}
function saveClient(c){
  if(!canWrite())return;
  c.updatedAt=new Date().toISOString();
  const i=S.clients.findIndex(x=>x.id===c.id); if(i>=0)S.clients[i]=c; else S.clients.push(c);
  render();
  const path='agents/'+S.uid+'/clients/'+c.id;
  enqueue(path,()=>S.db.doc(path).set(c)); syncBoard();
}
function deleteClient(id){
  if(!canWrite())return;
  S.clients=S.clients.filter(x=>x.id!==id); render();
  const path='agents/'+S.uid+'/clients/'+id;
  enqueue(path,()=>S.db.doc(path).delete()); syncBoard();
}
function saveProfile(p){
  if(!canWrite())return;
  S.profile=p; render();
  const path='agents/'+S.uid;
  enqueue(path,()=>S.db.doc(path).set(p)); syncBoard(true);
}
let boardT;
function computeBoard(){
  const c=counts(); const month=TODAY.slice(0,7);
  const signedMonth=Object.values(S.days).filter(d=>d.date&&d.date.slice(0,7)===month).reduce((n,d)=>n+(d.items||[]).filter(i=>i.t==='sign').length,0);
  const last14={}; for(let i=0;i<14;i++){const k=iso(addDays(new Date(),-i));last14[k]=score(S.days[k]);}
  const td=getDay(TODAY);
  return {uid:S.uid,nick:S.profile.nick||'',date:TODAY,score:score(td),A:c.A,B:c.B,C:c.C,signedMonth,
    goalCases:Number(S.profile.goalCases)||0,last14,posted:!!td.posted,review:!!td.review};
}
function syncBoard(force){
  if(!force&&(!S.loaded.c||!S.loaded.d))return;
  clearTimeout(boardT);
  boardT=setTimeout(()=>{
    const b=computeBoard(); const j=JSON.stringify(b);
    if(j===S.lastBoard)return; S.lastBoard=j;
    b.updatedAt=new Date().toISOString();
    const path='board/'+S.uid;
    enqueue(path,()=>S.db.doc(path).set(b));
  },1200);
}

/* ---------- scoring ---------- */
function addItem(t,client,note){
  const day=clone(getDay(TODAY)); day.items=day.items||[];
  const item={id:uidShort(),t,pts:PTS[t],cid:client.id,name:client.name,at:new Date().toTimeString().slice(0,5),note:note||''};
  const ex=day.items.findIndex(i=>i.cid===client.id);
  if(ex>=0){
    if(day.items[ex].pts>=PTS[t]){toast(client.name+' 今天已经算过分了');return false;}
    day.items[ex]=item;
  } else day.items.push(item);
  saveDay(day); toast(TLAB[t]+' +'+PTS[t]+' 分：'+client.name);
  return true;
}
function removeItem(id){
  const day=clone(getDay(TODAY)); const it=(day.items||[]).find(i=>i.id===id); if(!it)return;
  day.items=day.items.filter(i=>i.id!==id); saveDay(day);
  if(it.t==='sign'){const c=S.clients.find(x=>x.id===it.cid); if(c&&c.status==='signed'&&c.signedAt===TODAY){const n=clone(c);n.status='active';n.tier='A';delete n.signedAt;saveClient(n);}}
}
function doSign(c){
  if(!addItem('sign',c))return;
  const n=clone(c); n.status='signed'; n.signedAt=TODAY; n.tier='A'; saveClient(n);
  refillPrompt(c.name);
}
function refillPrompt(signedName){
  const bs=active().filter(c=>c.tier==='B');
  const a=counts().A;
  const list=bs.length?'<div class="pick">'+bs.map(c=>'<button data-act="promoteA" data-id="'+esc(c.id)+'"><span class="tag B">B</span><span class="grow"><b>'+esc(c.name)+'</b><div class="small muted">'+esc(c.note||c.source||'')+'</div></span><span class="small" style="color:var(--accent);font-weight:700">升到 A</span></button>').join('')+'</div>'
    :'<div class="warnbox">B 名单是空的，先去「名单」加几位 B。</div>';
  openSheet('<h3>恭喜签下 '+esc(signedName)+'！<button class="x" data-act="close" aria-label="关闭">×</button></h3><div class="okbox">签单 +10 分。A 名单现在 <b class="num">'+a+'/'+A_TARGET+'</b>，请立刻从 B 选一位补上。</div>'+list+'<button class="btn block ghost" data-act="close">稍后再补</button>');
}

/* ---------- views ---------- */
function header(){
  const d=new Date(); const th=THEMES[d.getDay()];
  $('#hdate').textContent=(d.getMonth()+1)+'月'+d.getDate()+'日 · '+WD[d.getDay()];
  const wake=S.profile.wake?'　起床 '+S.profile.wake:'';
  $('#htheme').innerHTML='<span class="daytag">'+th.k+'</span><div><b>'+esc(th.t)+'</b><span>'+esc(th.d)+esc(wake)+'</span></div>';
}
function ringSvg(v){
  const r=56,C=2*Math.PI*r,p=Math.min(v/GOAL,1);
  const col=v>=GOAL?'var(--good)':'var(--accent)';
  return '<div class="ring"><svg viewBox="0 0 132 132" aria-hidden="true"><circle cx="66" cy="66" r="'+r+'" fill="none" stroke="var(--sunk)" stroke-width="12"/><circle class="fg" cx="66" cy="66" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="12" stroke-linecap="round" stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+(C*(1-p)).toFixed(1)+'"/></svg><div class="c"><b>'+v+'</b><span>/ '+GOAL+' 分</span></div></div>';
}
function notices(){
  let h='';
  if(!CLOUD)h+='<div class="mode">单机模式：资料只存在这支手机，leader 看不到。管理员填好 Firebase 设定后就会变成全组同步。</div>';
  if(S.stale)h+='<div class="notice">暂时连不上网络，显示的是手机里的记录，恢复后会自动同步。</div>';
  if(S.readonly)h+='<div class="notice">你的账号目前不能保存，请联系 leader。</div>';
  return h;
}
function checklistHtml(day){
  const it=day.items||[]; const has=t=>it.some(i=>i.t===t);
  const signed=has('sign'); const after=iso(addDays(new Date(),2));
  const talked=it.some(i=>i.t!=='C')||(day.talks||[]).length>0;
  const booked=active().some(x=>x.nextDate===after);
  const L=[
    {k:'wake',l:'闹钟响就起床，打开 app 看今天主题'},
    {k:'posted',l:'在社交媒体 post 至少 1 则'},
    {k:'focus',l:'做完今天的主要 3 小时：'+THEMES[new Date().getDay()].t},
    {a:has('A')||signed,l:'联络 A 的人，推进到签单',h:'按「找 A」或「签单」'},
    {a:has('B'),l:'和 B 的人聊天、做服务',h:'按「找 B」'},
    {a:has('C'),l:'拿到新 C 的联络方式',h:'按「新 C」'},
    {a:!!day.refilled,l:'签了单就立刻从 B 补一位到 A',h:'签单后从 B 升一位到 A',na:!signed},
    {a:talked,l:'晚上记录今天谈过保险的人',h:'在「晚间」记录'},
    {a:booked,l:'预约好后天的 appointment',h:'在「晚间」约后天'},
    {a:score(day)>=GOAL,l:'今日积分满 20 分，放工',h:'还差 '+Math.max(GOAL-score(day),0)+' 分'}
  ];
  const rows=L.filter(x=>!x.na);
  const done=rows.filter(x=>x.k?day[x.k]:x.a).length;
  const html=L.map(x=>{
    if(x.k)return '<button class="chk'+(day[x.k]?' on':'')+'" data-act="toggle" data-k="'+x.k+'" aria-pressed="'+(!!day[x.k])+'"><span class="box"></span><span>'+x.l+'</span></button>';
    if(x.na)return '<div class="chk auto na"><span class="box"></span><span>'+x.l+'<small>今天有签单才需要</small></span></div>';
    return '<div class="chk auto'+(x.a?' on':'')+'"><span class="box"></span><span>'+x.l+(x.a?'':'<small>'+x.h+'</small>')+'</span></div>';
  }).join('');
  return {html,done,total:rows.length};
}
function viewToday(){
  const day=getDay(TODAY), sc=score(day), left=Math.max(GOAL-sc,0), c=counts();
  const items=(day.items||[]).slice().reverse();
  const cl=checklistHtml(day);
  const tm=iso(addDays(new Date(),1));
  const appts=active().filter(x=>x.nextDate===TODAY||x.nextDate===tm).sort((a,b)=>(a.nextDate+(a.nextTime||'')).localeCompare(b.nextDate+(b.nextTime||'')));
  const meter=(k,v,t)=>{const low=t&&v<t;return '<button class="meter'+(low?' low':'')+'" data-act="goList" data-tier="'+k+'"><span class="lab">'+k+' 名单</span><span class="v">'+v+(t?'<small>/'+t+'</small>':'')+'</span>'+(t?'<span class="bar"><i style="width:'+Math.min(100,v/t*100)+'%;background:var(--t'+k+')"></i></span>':'<span class="lab">源源不绝</span>')+'</button>';};
  const team=Object.values(S.board).filter(b=>b.date===TODAY).sort((a,b)=>b.score-a.score);
    return notices()+
  '<section class="panel"><div class="score">'+ringSvg(sc)+'<div style="display:grid;gap:10px">'+
    (sc>=GOAL?'<div class="status ok">今天达标，可以放工！</div>':'<div class="status">还差 <span class="num" style="font-size:22px">'+left+'</span> 分放工</div>')+
    '<div class="btns">'+
      '<button class="sbtn sign" data-act="score" data-t="sign"><b>签单<span class="sub">签了立刻补 A</span></b><span class="pt">+10</span></button>'+
      '<button class="sbtn" data-act="score" data-t="A"><b>找 A<span class="sub">见面 / 谈保单</span></b><span class="pt" style="color:var(--tA)">+5</span></button>'+
      '<button class="sbtn" data-act="score" data-t="B"><b>找 B<span class="sub">聊天 / 做服务</span></b><span class="pt" style="color:var(--tB)">+3</span></button>'+
      '<button class="sbtn" data-act="score" data-t="C"><b>新 C<span class="sub">拿到联络方式</span></b><span class="pt" style="color:var(--tC)">+2</span></button>'+
    '</div></div></div></section>'+
  '<section class="panel"><h2>每日检查清单 <small>'+cl.done+' / '+cl.total+' 完成</small></h2><div class="checks">'+cl.html+'</div><div class="small muted">有灰色说明的项目，做到后会自动打勾。</div></section>'+
  '<section class="panel"><h2>今日得分 <small>'+items.length+' 项</small></h2><div class="rows">'+
    (items.length?items.map(i=>'<div class="row"><span class="tag '+i.t+'">'+TLAB[i.t]+'</span><div class="grow"><b>'+esc(i.name)+'</b><div class="small muted">'+esc(i.at)+(i.note?' · '+esc(i.note):'')+'</div></div><span class="pts">+'+i.pts+'</span><button class="x" data-act="rmItem" data-id="'+esc(i.id)+'" aria-label="删除这项">×</button></div>').join(''):'<div class="empty">还没有得分。按上面的按钮，每做到一项就记一项。</div>')+
  '</div></section>'+
  '<section class="panel"><h2>今天 &amp; 明天的 appointment</h2><div class="rows">'+
    (appts.length?appts.map(x=>'<div class="row"><span class="tag '+x.tier+'">'+x.tier+'</span><div class="grow"><b>'+esc(x.name)+'</b><div class="small muted">'+esc(x.contact||'')+'</div></div><span class="appt">'+(x.nextDate===TODAY?'今天':'明天')+(x.nextTime?' '+esc(x.nextTime):'')+'</span></div>').join(''):'<div class="empty">今明两天没有约。晚上复盘时从名单里约后天的人。</div>')+
  '</div></section>'+
  '<section class="panel"><h2>初恋表格 <small>A 10 位 · B 至少 30 位</small></h2><div class="meters">'+meter('A',c.A,A_TARGET)+meter('B',c.B,B_TARGET)+meter('C',c.C,0)+'</div>'+
    (c.A<A_TARGET?'<div class="warnbox">A 少了 '+(A_TARGET-c.A)+' 位，从 B 提人上来补位。</div>':'')+
  '</section>'+
  (team.length>1||(team.length&&CLOUD)?'<section class="panel"><h2>全组今日积分 <small>'+team.filter(b=>b.score>=GOAL).length+' / '+team.length+' 人已达标</small></h2><div class="lb">'+
    team.map((b,i)=>'<div class="lbr'+(b.score>=GOAL?' done':'')+(b.uid===S.uid?' me':'')+'"><span class="rk">'+(i+1)+'</span><div><div class="nm"><span>'+esc(nameOf(b.uid))+(b.uid===S.uid?'（我）':'')+'</span></div><div class="track"><i style="width:'+Math.min(100,b.score/GOAL*100)+'%"></i></div></div><span class="sc">'+b.score+'</span></div>').join('')+
  '</div></section>':'');
}
function clientCard(c,readOnly){
  const meta=[]; if(c.contact)meta.push(esc(c.contact)); if(c.source)meta.push(esc(c.source));
  if(c.status==='signed'&&c.signedAt)meta.push('签单 '+md(c.signedAt));
  let acts='';
  if(!readOnly){
    if(c.status==='signed') acts='<button class="btn" data-act="edit" data-id="'+esc(c.id)+'">编辑</button><button class="btn ghost" data-act="reopen" data-id="'+esc(c.id)+'">放回 A</button>';
    else {
      if(c.tier==='A')acts+='<button class="btn pri" data-act="signC" data-id="'+esc(c.id)+'">签单 +10</button><button class="btn" data-act="pickDo" data-t="A" data-id="'+esc(c.id)+'">今天找了 +5</button>';
      if(c.tier==='B')acts+='<button class="btn" data-act="pickDo" data-t="B" data-id="'+esc(c.id)+'">今天找了 +3</button><button class="btn ghost" data-act="move" data-to="A" data-id="'+esc(c.id)+'">升到 A</button>';
      if(c.tier==='C')acts+='<button class="btn ghost" data-act="move" data-to="B" data-id="'+esc(c.id)+'">升到 B</button>';
      if(c.tier==='A')acts+='<button class="btn ghost" data-act="move" data-to="B" data-id="'+esc(c.id)+'">降到 B</button>';
      acts+='<button class="btn" data-act="edit" data-id="'+esc(c.id)+'">编辑</button>';
    }
  }
  return '<div class="card"><div class="top"><span class="tag '+(c.status==='signed'?'sign':c.tier)+'">'+(c.status==='signed'?'已签':c.tier)+'</span><div class="grow"><div class="nm">'+esc(c.name)+'</div><div class="meta">'+meta.join('<span>·</span>')+'</div></div>'+(c.nextDate&&c.status!=='signed'?'<span class="appt">约 '+md(c.nextDate)+(c.nextTime?' '+esc(c.nextTime):'')+'</span>':'')+'</div>'+(c.note?'<div class="note">'+esc(c.note)+'</div>':'')+(acts?'<div class="acts">'+acts+'</div>':'')+'</div>';
}
function viewList(){
  const c=counts(); const signed=S.clients.filter(x=>x.status==='signed');
  const t=S.tier;
  const list=t==='S'?signed.slice().sort((a,b)=>(b.signedAt||'').localeCompare(a.signedAt||'')):active().filter(x=>x.tier===t).sort((a,b)=>(a.nextDate||'9').localeCompare(b.nextDate||'9')||(b.updatedAt||'').localeCompare(a.updatedAt||''));
  const hint={A:'可以直接谈保单的 10 位。经常出现、不断联络，直到签单。',B:'认识、有关系，还没进到讲保险。做信任、做服务，多分享保险知识，带他们到 A。',C:'从活动、转介绍、社交媒体、小红书认识的新朋友。拿到 IG、FB 或电话号都算。',S:'已经签单的顾客。记得继续做服务、拿转介绍。'}[t];
  let warn='';
  if(t==='A'&&c.A<A_TARGET)warn='<div class="warnbox">A 还差 '+(A_TARGET-c.A)+' 位才满 10 位。</div>';
  if(t==='A'&&c.A>A_TARGET)warn='<div class="warnbox">A 超过 10 位了，把最不熟的几位降回 B，专心跟进 10 位。</div>';
  if(t==='B'&&c.B<B_TARGET)warn='<div class="warnbox">B 还差 '+(B_TARGET-c.B)+' 位才到 30 位，多从 C 升上来。</div>';
  return notices()+'<section class="panel"><h2>初恋表格</h2><div class="seg" role="tablist">'+
    [['A',c.A],['B',c.B],['C',c.C],['S',signed.length]].map(([k,n])=>'<button role="tab" aria-selected="'+(t===k)+'" class="'+(t===k?'on':'')+'" data-act="tier" data-tier="'+k+'">'+(k==='S'?'已签单':k)+'<span class="num">'+n+'</span></button>').join('')+
  '</div><div class="small muted">'+hint+'</div>'+warn+
  (t!=='S'?'<button class="btn pri block" data-act="newClient" data-tier="'+t+'">＋ 加 '+t+' 名单</button>':'')+
  '<div style="display:grid;gap:8px">'+(list.length?list.map(x=>clientCard(x)).join(''):'<div class="empty">这里还没有人。</div>')+'</div></section>';
}
function viewEvening(){
  const day=getDay(TODAY);
  const after=iso(addDays(new Date(),2));
  const talked=[]; (day.items||[]).filter(i=>i.t!=='C').forEach(i=>talked.push({k:'i',id:i.id,name:i.name,note:i.note||'',tag:i.t,at:i.at}));
  (day.talks||[]).forEach(t=>talked.push({k:'t',id:t.id,name:t.name,note:t.note||'',tag:'talk',at:t.at}));
  const booked=active().filter(x=>x.nextDate===after);
  const cands=active().filter(x=>(x.tier==='A'||x.tier==='B')&&!(x.nextDate&&x.nextDate>=TODAY)).sort((a,b)=>a.tier.localeCompare(b.tier));
  const opts=active().map(x=>'<option value="'+esc(x.name)+'"></option>').join('');
  return notices()+
  '<section class="panel"><h2>今天和谁开过保险话题 <small>'+talked.length+' 位</small></h2>'+
    '<div class="rows">'+(talked.length?talked.map(x=>'<div class="row">'+(x.tag==='talk'?'<span class="tag C" style="background:var(--sunk);color:var(--muted)">记录</span>':'<span class="tag '+x.tag+'">'+TLAB[x.tag]+'</span>')+'<div class="grow"><b>'+esc(x.name)+'</b><div class="small muted">'+esc(x.at||'')+(x.note?' · '+esc(x.note):'')+'</div></div>'+(x.k==='t'?'<button class="x" data-act="rmTalk" data-id="'+esc(x.id)+'" aria-label="删除">×</button>':'')+'</div>').join(''):'<div class="empty">还没有记录。白天按积分的顾客会自动出现在这里。</div>')+'</div>'+
    '<form class="f" data-form="talk"><datalist id="dlc">'+opts+'</datalist><div class="two"><div class="fld"><label for="tk-name">顾客名字</label><input id="tk-name" name="name" list="dlc" required placeholder="例如：陈小姐"></div><div class="fld"><label for="tk-note">谈了什么 / 下一步</label><input id="tk-note" name="note" placeholder="例如：想了解医药卡"></div></div><button class="btn block">记下来</button></form>'+
  '</section>'+
  '<section class="panel"><h2>预约后天 <small>'+md(after)+' '+WD[fromIso(after).getDay()]+'</small></h2>'+
    (booked.length?'<div class="okbox">已约 '+booked.length+' 位：'+booked.map(x=>esc(x.name)+(x.nextTime?' '+esc(x.nextTime):'')).join('、')+'</div>':'<div class="warnbox">后天还没有 appointment。从下面挑人打电话或 WhatsApp。</div>')+
    '<div class="pick">'+(cands.length?cands.slice(0,15).map(x=>'<button data-act="book" data-id="'+esc(x.id)+'"><span class="tag '+x.tier+'">'+x.tier+'</span><span class="grow"><b>'+esc(x.name)+'</b><div class="small muted">'+esc(x.contact||x.note||'')+'</div></span><span class="small" style="color:var(--accent);font-weight:700">约后天</span></button>').join(''):'<div class="empty">A 和 B 名单里的人都已经有约了。</div>')+'</div>'+
  '</section>'+
  '<section class="panel"><div class="checks"><button class="chk'+(day.review?' on':'')+'" data-act="toggle" data-k="review" aria-pressed="'+(!!day.review)+'"><span class="box"></span><span>今晚复盘完成</span></button></div></section>';
}
function barsHtml(last14){
  const keys=[];for(let i=13;i>=0;i--)keys.push(iso(addDays(new Date(),-i)));
  const vals=keys.map(k=>last14?(last14[k]||0):score(S.days[k]));
  const max=Math.max(GOAL+10,...vals);
  return '<div class="bars"><div class="goal" style="top:'+(16+(1-GOAL/max)*114).toFixed(1)+'px"><span>20 分</span></div>'+
    keys.map((k,i)=>{const h=(vals[i]/max*100).toFixed(1);return '<div class="b'+(vals[i]>=GOAL?' hit':'')+(k===TODAY?' today':'')+'"><i style="height:'+h+'%"></i><small style="bottom:calc('+h+'% + 2px)">'+(vals[i]||'')+'</small></div>';}).join('')+
  '</div><div class="blabels">'+keys.map(k=>'<span>'+WDS[fromIso(k).getDay()]+'</span>').join('')+'</div>';
}
function viewMe(){
  const p=S.profile; const month=TODAY.slice(0,7);
  const monthDays=Object.values(S.days).filter(d=>d.date&&d.date.slice(0,7)===month);
  const hit=monthDays.filter(d=>score(d)>=GOAL).length;
  const signed=monthDays.reduce((n,d)=>n+(d.items||[]).filter(i=>i.t==='sign').length,0);
  let streak=0;for(let i=0;i<60;i++){const k=iso(addDays(new Date(),-i));const s=score(S.days[k]);if(s>=GOAL)streak++;else if(i===0)continue;else break;}
  const goal=Number(p.goalCases)||0;
  return notices()+
  '<section class="panel"><h2>我的进度 <small>'+(new Date().getMonth()+1)+' 月</small></h2><div class="kpis">'+
    '<div class="kpi"><div class="v">'+signed+(goal?'<span class="muted" style="font-size:16px">/'+goal+'</span>':'')+'</div><div class="lab">本月签单</div></div>'+
    '<div class="kpi"><div class="v">'+hit+'</div><div class="lab">本月达标天数</div></div>'+
    '<div class="kpi"><div class="v">'+streak+'</div><div class="lab">连续达标天数</div></div>'+
  '</div><div class="small muted">最近 14 天每日积分</div>'+barsHtml()+'</section>'+
  '<section class="panel"><h2>我的目标</h2><form class="f" data-form="profile">'+
    '<div class="two"><div class="fld"><label for="p-nick">我的名字（全组看到的）</label><input id="p-nick" name="nick" value="'+esc(p.nick||'')+'" placeholder="例如：Ivan"></div><div class="fld"><label for="p-cases">每月签单目标（份）</label><input id="p-cases" name="goalCases" type="number" min="0" inputmode="numeric" value="'+esc(p.goalCases||'')+'" placeholder="例如：10"></div></div>'+
    '<div class="fld"><label for="p-year">今年的大目标</label><input id="p-year" name="goalYear" value="'+esc(p.goalYear||'')+'" placeholder="例如：考到 MDRT、升 Unit Manager"></div>'+
    '<div class="fld"><label for="p-why">我为什么做保险</label><textarea id="p-why" name="why" placeholder="写给累的时候的自己看">'+esc(p.why||'')+'</textarea></div>'+
    '<div class="two"><div class="fld"><label for="p-wake">每天起床时间</label><input id="p-wake" name="wake" type="time" value="'+esc(p.wake||'07:00')+'"></div><div class="fld"><label for="p-rev">晚上复盘时间</label><input id="p-rev" name="reviewAt" type="time" value="'+esc(p.reviewAt||'21:30')+'"></div></div>'+
    '<button class="btn pri block">保存目标</button></form>'+
    (LN?'<button class="btn block" data-act="alarm">设定每天起床和复盘提醒</button><div class="small muted">手机会在这两个时间响通知。第一次会问你是否允许通知，请按「允许」。</div>'
       :'<button class="btn block" data-act="alarm">把起床和复盘时间加入手机日历</button><div class="small muted">下载后打开文件，日历会每天在这两个时间提醒。想要闹钟铃声，也请在手机「时钟」app 设同样的时间。</div>')+
  '</section>'+
  (CLOUD?'<section class="panel"><h2>账号</h2><div class="small muted">'+esc(S.email)+'</div><button class="btn block" data-act="logout">登出</button></section>':'');
}
const GOPEN=new Set(['who']);
document.addEventListener('toggle',e=>{const d=e.target;if(d&&d.dataset&&d.dataset.g){if(d.open)GOPEN.add(d.dataset.g);else GOPEN.delete(d.dataset.g);}},true);
function viewGuide(){
  const T=(h)=>'<div class="tblw"><table class="gt">'+h+'</table></div>';
  const sec=(id,title,body)=>'<details class="g"'+(GOPEN.has(id)?' open':'')+' id="g-'+id+'" data-g="'+id+'"><summary>'+title+'</summary><div class="gb">'+body+'</div></details>';
  const wd=new Date().getDay();
  const weekRows=[[1,'星期一','Follow up day','Follow up 上星期联系的朋友'],[2,'星期二','Open market day','陌生市场 / Road Show / 陌生拜访'],[3,'星期三','转介绍日','原有市场拿转介绍（至少 3 个）'],[4,'星期四','学习日','Case study / Role play / 签单分享 / 晚会 Zoom'],[5,'星期五','增员日','陌生增员，至少拿 2 个联络'],[6,'星期六','预约日','电话预约下星期的 appointment / 整理 name list ABC'],[0,'星期日','自由安排','休息、陪家人']]
    .map(r=>'<tr'+(r[0]===wd?' class="now"':'')+'><td>'+r[1]+(r[0]===wd?' <b class="today-tag">今天</b>':'')+'</td><td><b>'+r[2]+'</b></td><td>'+r[3]+'</td></tr>').join('');
  return '<section class="panel"><h2>Five Stars 资深顾问作战手册</h2>'+
  '<div class="small muted">每天拿满 20 分才放工，用初恋表格（ABC 名单）把客源一直滚下去。点标题展开。</div>'+
  sec('who','一、这本手册给谁用',
    '<p>给做保险超过两年的 Five Stars 顾问。</p><ul>'+
    '<li><b>核心心法：卖自己，不要卖产品。</b>让初恋表格里的每一个人天天看见你，曝光率就是成交率。</li>'+
    '<li><b>配合 app 使用：</b>目标、积分、名单、今日记录都在 app 里，leader 每天看得到全组进度。</li>'+
    '<li><b>一天工作 8 小时：</b>主要 3 小时做当天的主题工作，其余 5 小时做 Appointment → Close case → Paper work → Take report → Post IG/FB → 扩大自己人脉。</li></ul>',true)+
  sec('day','二、每日作息',
    '<p>每天在同一个时间起床：在「我的」设定起床时间，手机每天准时提醒。以下是建议时间表，可按自己情况微调。</p>'+
    T('<tr><th>时间</th><th>要做什么</th></tr><tr><td>7:00</td><td>起床；打开 app 看今天的主题和积分目标</td></tr><tr><td>8:00</td><td>在社交媒体 post 一则保险生活化内容</td></tr><tr><td>9:00 – 12:00</td><td><b>主要 3 小时</b>：做当天的主题</td></tr><tr><td>12:00 – 18:00</td><td>其余 5 小时：见顾客谈保单、签单、Paper work、交 report、参加活动认识新朋友</td></tr><tr><td>晚上</td><td>复盘：记录今天谈过保险的人，从名单预约后天的 appointment</td></tr><tr><td>放工</td><td>今日积分满 20 分</td></tr>'))+
  sec('week','三、每周工作日常（主要每日 3 小时）',
    T('<tr><th>星期</th><th>主题</th><th>具体要做</th></tr>'+weekRows)+
    '<p class="small muted">其余 5 小时的循环：Appointment → Close case → Paper work → Take report → Post IG/FB → 扩大自己人脉。</p>')+
  sec('abc','四、初恋表格：ABC 名单',
    '<p>名单永远保持 <b>A 10 位、B 至少 30 位、C 源源不绝</b>；A 签了一位，就立刻从 B 提一位上来补位。</p>'+
    T('<tr><th>等级</th><th>数量</th><th>是谁</th><th>你要做什么</th></tr>'+
      '<tr><td><span class="tag A">A</span></td><td>固定 10 位</td><td>可以直接谈保单的人</td><td>经常出现、不断联络，直到签单</td></tr>'+
      '<tr><td><span class="tag B">B</span></td><td>至少 30 位</td><td>认识、有关系，但还没进到讲保险</td><td>做信任、做服务；有时间就聊天，多分享保险知识，把他们带到 A</td></tr>'+
      '<tr><td><span class="tag C">C</span></td><td>源源不绝</td><td>新认识的人</td><td>从活动、转介绍、社交媒体、小红书认识，拿到联络方式（IG、FB、电话号都算）</td></tr>')+
    '<p><b>三条规矩：</b></p><ol><li><b>A 签单 → 立刻补位。</b>在 app 按「签单」，app 会提醒你从 B 选一位升到 A。</li><li><b>B 少于 30 位 → 从 C 升。</b>聊过几次、关系建立的 C，就升到 B。</li><li><b>C 不能断。</b>每天至少拿到新的联络方式，名单才不会干。</li></ol>'+
    '<button class="btn block" data-act="goList" data-tier="A">打开我的初恋表格</button>')+
  sec('score','五、每日积分：满 20 分才放工',
    '<p>每天给自己打分，拿满 20 分才算放工；每做到一项，就在「今天」按一下。</p>'+
    T('<tr><th>做到什么</th><th>分数</th></tr><tr><td>签单 1 份</td><td><b>10 分</b></td></tr><tr><td>找 A 的人 1 位（见面或谈保单）</td><td><b>5 分</b></td></tr><tr><td>找 B 的人 1 位（聊天、做服务、分享保险知识）</td><td><b>3 分</b></td></tr><tr><td>新 C 拿到联络方式 1 位（IG、FB、电话号都算）</td><td><b>2 分</b></td></tr>')+
    '<p><b>拿到 20 分的几种组合：</b></p><ul><li>签 2 份单 = 20 分</li><li>签 1 份 + 找 2 位 A = 20 分</li><li>找 2 位 A + 2 位 B + 2 位新 C = 20 分</li><li>找 4 位 B + 4 位新 C = 20 分</li></ul>'+
    '<p class="small muted">同一位顾客一天只算一次；leader 看得到每一分是和谁拿的。</p>')+
  sec('social','六、社交媒体曝光：每天至少 1 则',
    '<p>每天在 FB、IG 或小红书 post 至少 1 则，让初恋表格里的人天天看见你：卖自己，不要卖产品。可以轮流 post 这五类：</p>'+
    '<ol><li><b>保险生活化</b>：生活里的小事和保障的关系，例如陪家人体检、旅行前的准备。</li><li><b>做服务</b>：帮顾客办理赔款、送保单、探病的照片（先问顾客可不可以拍，不露出他们的个人资料）。</li><li><b>保险咨询</b>：一个常见问题配一句简单的解答。</li><li><b>自己的工作日常</b>：上课、Road Show、团队活动，让人看见你很认真。</li><li><b>个人生活</b>：家庭、运动、爱好，让人认识你这个人。</li></ol>'+
    '<p class="small muted">社交媒体上认识的新朋友，拿到联络方式就放进 C，算 2 分。post 完在清单勾「post 至少 1 则」。</p>')+
  sec('night','七、晚间复盘：15 分钟',
    '<p>每晚花 15 分钟做两件事：记下今天和谁开过保险话题，再从名单里预约后天的 appointment。</p>'+
    '<ol><li><b>记录今天谈过保险的人</b>：在「晚间」写下顾客名字、谈了什么、下一步。白天按积分时已经记的，只要补充备注。</li><li><b>预约后天的 appointment</b>：从 A 和 B 里挑人打电话或 WhatsApp，约好就填「下次见面」日期。</li><li><b>看一眼名单数量</b>：A 少于 10 位、B 少于 30 位，app 会变红提醒，明天要优先补。</li></ol>'+
    '<button class="btn block" data-act="tab" data-tab="evening">去晚间复盘</button>')+
  sec('app','八、App 怎么用',
    T('<tr><th>页面</th><th>在这里做什么</th></tr><tr><td>今天</td><td>看今天的主题和积分圈；按「签单 / 找 A / 找 B / 新 C」记分；每日检查清单；今明两天的约；全组排名</td></tr><tr><td>名单</td><td>初恋表格 A / B / C / 已签单；加人、升级、降级、签单</td></tr><tr><td>晚间</td><td>记录今天谈过保险的人；预约后天；复盘完成</td></tr><tr><td>手册</td><td>就是这一页</td></tr><tr><td>我的</td><td>名字、目标、起床和复盘时间、提醒；最近 14 天积分</td></tr><tr><td>团队</td><td>只有 leader 看得到：全组进度，点一位顾问看详情</td></tr>')+
    '<p><b>第一次使用：</b>先到「我的」填名字和目标、设定提醒，再到「名单」把现有的 A 10 位、B 30 位输入进去，第二天开始每做到一项就记分。</p>')+
  sec('check','九、每日检查清单',
    '<p>「今天」页面的清单就是这 10 项，做到的会自动打勾：</p><ol><li>闹钟响就起床，打开 app 看今天主题</li><li>在社交媒体 post 至少 1 则</li><li>做完今天的主要 3 小时</li><li>联络 A 的人，推进到签单</li><li>和 B 的人聊天、做服务</li><li>拿到新 C 的联络方式</li><li>签了单就立刻从 B 补一位到 A</li><li>晚上记录今天谈过保险的人</li><li>预约好后天的 appointment</li><li>今日积分满 20 分，放工</li></ol>'+
    '<button class="btn pri block" data-act="tab" data-tab="today">去今天的清单</button>')+
  '</section>';
}
function viewTeam(){
  if(!S.leader)return viewToday();
  const rows=Object.values(S.board).sort((a,b)=>((b.date===TODAY?b.score:0)-(a.date===TODAY?a.score:0)));
  const wk=[];for(let i=0;i<7;i++)wk.push(iso(addDays(new Date(),-i)));
  const pill=v=>'<span class="pill '+(v>=GOAL?'good':v>=10?'warn':'bad')+'">'+v+'</span>';
  const done=rows.filter(b=>b.date===TODAY&&b.score>=GOAL).length;
  let detail='';
  if(S.sel){
    const b=S.board[S.sel]||{}; const td=S.selDays[TODAY]||blankDay(TODAY); const sc=score(td);
    const cs=S.selClients; const c=counts(cs);
    const talks=(td.items||[]).concat((td.talks||[]).map(t=>({t:'talk',name:t.name,note:t.note,at:t.at,pts:0})));
    const tm=iso(addDays(new Date(),1)),af=iso(addDays(new Date(),2));
    const ap=active(cs).filter(x=>x.nextDate&&x.nextDate>=TODAY&&x.nextDate<=af).sort((a,b)=>a.nextDate.localeCompare(b.nextDate));
    const prof=S.selProfile||{};
    detail='<section class="panel"><h2>'+esc(nameOf(S.sel))+' <button class="btn ghost" data-act="unsel">返回全组</button></h2>'+
      (prof.goalYear||prof.goalCases?'<div class="small muted">今年目标：'+esc(prof.goalYear||'—')+(prof.goalCases?' · 每月 '+esc(prof.goalCases)+' 份':'')+'</div>':'')+
      '<div class="kpis"><div class="kpi"><div class="v">'+sc+'</div><div class="lab">今日积分</div></div><div class="kpi"><div class="v">'+(b.signedMonth||0)+'</div><div class="lab">本月签单</div></div><div class="kpi"><div class="v">'+c.A+'/'+c.B+'/'+c.C+'</div><div class="lab">A / B / C</div></div></div>'+
      '<div class="small muted">最近 14 天</div>'+barsHtml(b.last14||{})+
      '<h2 style="margin-top:6px">今天谈过保险 <small>'+talks.length+' 项</small></h2><div class="rows">'+(talks.length?talks.map(i=>'<div class="row"><span class="tag '+(i.t==='talk'?'C':i.t)+'">'+(i.t==='talk'?'记录':TLAB[i.t])+'</span><div class="grow"><b>'+esc(i.name)+'</b><div class="small muted">'+esc(i.at||'')+(i.note?' · '+esc(i.note):'')+'</div></div>'+(i.pts?'<span class="pts">+'+i.pts+'</span>':'')+'</div>').join(''):'<div class="empty">今天还没有记录。</div>')+'</div>'+
      '<h2 style="margin-top:6px">接下来的 appointment</h2><div class="rows">'+(ap.length?ap.map(x=>'<div class="row"><span class="tag '+x.tier+'">'+x.tier+'</span><div class="grow"><b>'+esc(x.name)+'</b></div><span class="appt">'+(x.nextDate===TODAY?'今天':x.nextDate===tm?'明天':'后天')+(x.nextTime?' '+esc(x.nextTime):'')+'</span></div>').join(''):'<div class="empty">今天到后天没有约。</div>')+'</div>'+
      '<h2 style="margin-top:6px">A 名单 <small>'+c.A+'/'+A_TARGET+'</small></h2><div style="display:grid;gap:8px">'+(active(cs).filter(x=>x.tier==='A').map(x=>clientCard(x,true)).join('')||'<div class="empty">A 名单是空的。</div>')+'</div>'+
    '</section>';
  }
  return detail+'<section class="panel"><h2>全组进度 <small>今天 '+done+' / '+rows.length+' 人满 20 分</small></h2>'+
    (rows.length?'<div class="tbl"><table><thead><tr><th>顾问</th><th class="n">今日</th><th class="n">7 天达标</th><th class="n">A /10</th><th class="n">B /30</th><th class="n">C</th><th class="n">本月签单</th><th>Post</th><th>最后更新</th></tr></thead><tbody>'+
    rows.map(b=>{const v=b.date===TODAY?b.score:0;const h7=wk.filter(k=>(b.last14||{})[k]>=GOAL).length;const up=b.updatedAt?new Date(b.updatedAt):null;
      return '<tr class="click" data-act="sel" data-id="'+esc(b.uid)+'" tabindex="0"><td><b>'+esc(nameOf(b.uid))+'</b></td><td class="n">'+pill(v)+'</td><td class="n">'+h7+'/7</td><td class="n'+(b.A<A_TARGET?' lowv':'')+'">'+(b.A||0)+'</td><td class="n'+(b.B<B_TARGET?' lowv':'')+'">'+(b.B||0)+'</td><td class="n">'+(b.C||0)+'</td><td class="n">'+(b.signedMonth||0)+(b.goalCases?'<span class="muted" style="font-size:13px">/'+b.goalCases+'</span>':'')+'</td><td>'+(b.date===TODAY&&b.posted?'<span style="color:var(--good)">已 post</span>':'<span class="muted">—</span>')+'</td><td class="small muted">'+(up?(iso(up)===TODAY?'今天 '+pad(up.getHours())+':'+pad(up.getMinutes()):md(iso(up))):'—')+'</td></tr>';}).join('')+
    '</tbody></table></div><div class="small muted">点一位顾问，看他今天谈过谁、A 名单和接下来的 appointment。红字 = A 不满 10 位或 B 不满 30 位。</div>'
    :'<div class="empty">还没有顾问开始使用。请顾问下载 app、注册账号，记下第一分后就会出现在这里。</div>')+
  '</section>';
}
function viewLogin(){
  const reg=S.loginMode==='register';
  return '<section class="panel login"><h2>'+(reg?'注册新账号':'登入')+'</h2>'+
    '<div class="seg" role="tablist"><button class="'+(!reg?'on':'')+'" data-act="loginMode" data-m="login">登入</button><button class="'+(reg?'on':'')+'" data-act="loginMode" data-m="register">第一次用？注册</button></div>'+
    '<form class="f" data-form="login">'+
      (reg?'<div class="fld"><label for="l-nick">你的名字（全组看到的）</label><input id="l-nick" name="nick" required placeholder="例如：Wen Lian"></div>':'')+
      '<div class="fld"><label for="l-email">Email</label><input id="l-email" name="email" type="email" autocomplete="email" required placeholder="you@gmail.com"></div>'+
      '<div class="fld"><label for="l-pw">密码'+(reg?'（至少 6 位）':'')+'</label><input id="l-pw" name="pw" type="password" autocomplete="'+(reg?'new-password':'current-password')+'" required minlength="6"></div>'+
      '<div class="err" id="l-err"></div>'+
      '<button class="btn pri block">'+(reg?'注册并开始':'登入')+'</button>'+
    '</form>'+
    (!reg?'<button class="linkbtn" data-act="forgot">忘记密码？</button>':'')+
  '</section>';
}
const ICON={
  today:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  list:'<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="2.6"/></svg>',
  evening:'<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  me:'<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.4 6.8 19.2l1-5.9L3.5 9.2l5.9-.8z"/></svg>',
  guide:'<svg viewBox="0 0 24 24"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z"/></svg>',
  team:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.5 14.3c2.4.2 4.3 1.8 4.9 4.7"/></svg>'
};
function renderTabs(){
  const bar=$('#tabbar');
  if(!S.signedIn){bar.hidden=true;return;}
  bar.hidden=false;
  const tabs=[['today','今天'],['list','名单'],['evening','晚间'],['guide','手册'],['me','我的']]; if(S.leader)tabs.push(['team','团队']);
  $('#tabs').innerHTML=tabs.map(([k,l])=>'<button class="'+(S.tab===k?'on':'')+'" data-act="tab" data-tab="'+k+'" aria-current="'+(S.tab===k?'page':'false')+'">'+ICON[k]+l+'</button>').join('');
}
function render(){
  header(); renderTabs();
  const ae=document.activeElement;
  if(ae&&ae.closest&&ae.closest('#view form')&&ae.tagName!=='BUTTON')return; // don't wipe a form being typed in
  if(!S.signedIn){$('#view').innerHTML=viewLogin();return;}
  const v={today:viewToday,list:viewList,evening:viewEvening,guide:viewGuide,me:viewMe,team:viewTeam}[S.tab]||viewToday;
  $('#view').innerHTML=v();
}

/* ---------- sheets ---------- */
function clientForm(c,opts){
  c=c||{}; opts=opts||{};
  const tier=c.tier||opts.tier||'C';
  const title=c.id?'编辑 '+esc(c.name):(opts.score?TLAB[opts.score]+' +'+PTS[opts.score]+'：新顾客':'加入名单');
  return '<h3>'+title+'<button class="x" type="button" data-act="close" aria-label="关闭">×</button></h3>'+
  '<form class="f" data-form="client" data-id="'+esc(c.id||'')+'" data-score="'+esc(opts.score||'')+'">'+
    '<div class="fld"><label for="c-name">名字</label><input id="c-name" name="name" required value="'+esc(c.name||'')+'" placeholder="例如：林先生"></div>'+
    '<div class="fld"><label for="c-contact">联络方式（电话 / IG / FB）</label><input id="c-contact" name="contact" '+(opts.score==='C'?'required ':'')+'value="'+esc(c.contact||'')+'" placeholder="012-3456789 或 @ig_name"></div>'+
    '<div class="fld"><span class="l">等级</span><div class="radios">'+['A','B','C'].map(k=>'<label><input type="radio" name="tier" value="'+k+'"'+(tier===k?' checked':'')+'><span>'+k+(k==='A'?' 可谈保单':k==='B'?' 有关系':' 新认识')+'</span></label>').join('')+'</div></div>'+
    '<div class="two"><div class="fld"><label for="c-src">从哪里认识</label><select id="c-src" name="source"><option value="">—</option>'+SOURCES.map(s=>'<option'+(c.source===s?' selected':'')+'>'+s+'</option>').join('')+'</select></div>'+
    '<div class="fld"><label for="c-date">下次见面</label><input id="c-date" name="nextDate" type="date" value="'+esc(c.nextDate||'')+'"></div></div>'+
    '<div class="fld"><label for="c-time">时间（可不填）</label><input id="c-time" name="nextTime" type="time" value="'+esc(c.nextTime||'')+'"></div>'+
    '<div class="fld"><label for="c-note">备注（家庭、需要、谈到哪里）</label><textarea id="c-note" name="note">'+esc(c.note||'')+'</textarea></div>'+
    '<button class="btn pri block">'+(opts.score?'保存并 +'+PTS[opts.score]+' 分':'保存')+'</button>'+
    (c.id?'<button type="button" class="btn block danger" data-act="askDel" data-id="'+esc(c.id)+'">删除这位顾客</button>':'')+
  '</form>';
}
function scoreSheet(t){
  if(t==='C'){openSheet(clientForm(null,{tier:'C',score:'C'}));return;}
  const tiers=t==='sign'?['A','B']:[t];
  const list=active().filter(c=>tiers.includes(c.tier)).sort((a,b)=>a.tier.localeCompare(b.tier)||(a.nextDate||'9').localeCompare(b.nextDate||'9'));
  const doneIds=new Set((getDay(TODAY).items||[]).map(i=>i.cid));
  const sub={sign:'选签单的顾客',A:'今天见了 / 谈了哪一位 A？',B:'今天和哪一位 B 聊天、做服务？'}[t];
  openSheet('<h3>'+TLAB[t]+' +'+PTS[t]+'<button class="x" data-act="close" aria-label="关闭">×</button></h3><div class="small muted">'+sub+'</div>'+
    (t!=='sign'?'<div class="fld"><label for="pk-note">备注（可不填）</label><input id="pk-note" placeholder="例如：谈了医药卡，下星期再见"></div>':'')+
    '<div class="pick">'+(list.length?list.map(c=>'<button data-act="pickDo" data-t="'+t+'" data-id="'+esc(c.id)+'"'+(doneIds.has(c.id)&&t!=='sign'?' style="opacity:.55"':'')+'><span class="tag '+c.tier+'">'+c.tier+'</span><span class="grow"><b>'+esc(c.name)+'</b><div class="small muted">'+(doneIds.has(c.id)?'今天已算分 · ':'')+esc(c.note||c.contact||'')+'</div></span></button>').join(''):'<div class="empty">'+(t==='sign'?'A 和 B':t)+' 名单还没有人。</div>')+'</div>'+
    '<button class="btn block" data-act="newClient" data-tier="'+(t==='sign'?'A':t)+'" data-score="'+t+'">＋ 不在名单里，新增一位</button>');
}

/* ---------- reminders ---------- */
async function scheduleNative(silent){
  if(!LN)return false;
  try{
    const perm=await LN.requestPermissions();
    if(perm.display!=='granted'){if(!silent)toast('请在手机设定里允许「每日作战」发通知');return false;}
    const p=S.profile; const wake=(p.wake||'07:00').split(':').map(Number); const rev=(p.reviewAt||'21:30').split(':').map(Number);
    try{await LN.cancel({notifications:[{id:101},{id:102}]});}catch(_){}
    await LN.schedule({notifications:[
      {id:101,title:'起床！今天也要拿满 20 分',body:'打开每日作战，看今天的主题：'+THEMES[(new Date().getDay()+1)%7].t,schedule:{on:{hour:wake[0],minute:wake[1]},allowWhileIdle:true}},
      {id:102,title:'晚间复盘',body:'记录今天谈过保险的人，预约后天的 appointment',schedule:{on:{hour:rev[0],minute:rev[1]},allowWhileIdle:true}}
    ]});
    if(!silent)toast('已设定：每天 '+(p.wake||'07:00')+' 起床、'+(p.reviewAt||'21:30')+' 复盘提醒');
    return true;
  }catch(e){if(!silent)toast('提醒设定失败，请在手机「时钟」app 手动设定');return false;}
}
function downloadIcs(){
  const p=S.profile; const wake=(p.wake||'07:00').replace(':',''); const rev=(p.reviewAt||'21:30').replace(':','');
  const d=TODAY.replace(/-/g,''); const stamp=new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'Z';
  const ev=(id,t,sum,desc)=>['BEGIN:VEVENT','UID:'+id+'-'+(S.uid||'me')+'@fivestars','DTSTAMP:'+stamp,'DTSTART:'+d+'T'+t+'00','DURATION:PT15M','RRULE:FREQ=DAILY','SUMMARY:'+sum,'DESCRIPTION:'+desc,'BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+sum,'TRIGGER:PT0M','END:VALARM','END:VEVENT'];
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Five Stars Share//Daily//ZH','CALSCALE:GREGORIAN']
    .concat(ev('wake',wake,'起床！今天也要拿满 20 分','打开每日作战，看今天的主题'))
    .concat(ev('review',rev,'晚间复盘','记录今天谈过保险的人，预约后天的 appointment'))
    .concat(['END:VCALENDAR']).join('\r\n');
  const url=URL.createObjectURL(new Blob([ics],{type:'text/calendar'}));
  const a=document.createElement('a'); a.href=url; a.download='每日作战提醒.ics'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
  toast('已下载，打开文件加入日历');
}

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]'); if(!el)return;
  const a=el.dataset.act, id=el.dataset.id;
  if(a==='scrim'){if(e.target===el)closeSheet();return;}
  if(a==='close'){closeSheet();return;}
  if(a==='loginMode'){S.loginMode=el.dataset.m;render();return;}
  if(a==='forgot'){const em=($('#l-email')||{}).value||'';if(!em){$('#l-err').textContent='请先填你的 Email，再按「忘记密码」';return;}
    S.auth.sendPasswordResetEmail(em.trim()).then(()=>toast('重设密码的 email 已寄出，请查看信箱')).catch(()=>{$('#l-err').textContent='寄不出去，请检查 Email 是否正确';});return;}
  if(a==='logout'){if(S.auth)S.auth.signOut();return;}
  if(a==='tab'){S.tab=el.dataset.tab;closeSheet();render();window.scrollTo(0,0);return;}
  if(a==='tier'){S.tier=el.dataset.tier;render();return;}
  if(a==='goList'){S.tab='list';S.tier=el.dataset.tier;render();window.scrollTo(0,0);return;}
  if(a==='score'){scoreSheet(el.dataset.t);return;}
  if(a==='toggle'){const d=clone(getDay(TODAY));d[el.dataset.k]=!d[el.dataset.k];saveDay(d);return;}
  if(a==='rmItem'){removeItem(id);return;}
  if(a==='rmTalk'){const d=clone(getDay(TODAY));d.talks=(d.talks||[]).filter(t=>t.id!==id);saveDay(d);return;}
  if(a==='newClient'){openSheet(clientForm(null,{tier:el.dataset.tier==='S'?'C':el.dataset.tier,score:el.dataset.score||''}));return;}
  if(a==='edit'){const c=S.clients.find(x=>x.id===id);if(c)openSheet(clientForm(c));return;}
  if(a==='askDel'){const c=S.clients.find(x=>x.id===id);if(!c)return;openSheet('<h3>删除 '+esc(c.name)+'？</h3><div class="small muted">这位顾客的资料会从名单里删除，已经拿到的积分会保留。</div><div class="two"><button class="btn block" data-act="close">取消</button><button class="btn block pri" data-act="doDel" data-id="'+esc(id)+'">删除</button></div>');return;}
  if(a==='doDel'){deleteClient(id);closeSheet();toast('已删除');return;}
  if(a==='pickDo'){
    const c=S.clients.find(x=>x.id===id); if(!c)return;
    const noteEl=document.getElementById('pk-note'); const note=noteEl?noteEl.value.trim():'';
    const t=el.dataset.t; closeSheet();
    if(t==='sign')doSign(c); else addItem(t,c,note);
    return;
  }
  if(a==='signC'){const c=S.clients.find(x=>x.id===id);if(c)doSign(c);return;}
  if(a==='promoteA'){const c=S.clients.find(x=>x.id===id);if(!c)return;const n=clone(c);n.tier='A';saveClient(n);const dd=clone(getDay(TODAY));if(!dd.refilled){dd.refilled=true;saveDay(dd);}closeSheet();toast(c.name+' 升到 A 了');return;}
  if(a==='move'){const c=S.clients.find(x=>x.id===id);if(!c)return;const n=clone(c);n.tier=el.dataset.to;saveClient(n);if(el.dataset.to==='A'&&(getDay(TODAY).items||[]).some(i=>i.t==='sign')&&!getDay(TODAY).refilled){const dd=clone(getDay(TODAY));dd.refilled=true;saveDay(dd);}toast(c.name+' → '+el.dataset.to);return;}
  if(a==='reopen'){const c=S.clients.find(x=>x.id===id);if(!c)return;const n=clone(c);n.status='active';n.tier='A';delete n.signedAt;saveClient(n);return;}
  if(a==='book'){const c=S.clients.find(x=>x.id===id);if(!c)return;openSheet(clientForm(Object.assign(clone(c),{nextDate:iso(addDays(new Date(),2))})));return;}
  if(a==='alarm'){if(LN)scheduleNative(false);else downloadIcs();return;}
  if(a==='sel'){selectAgent(id);return;}
  if(a==='unsel'){selectAgent(null);return;}
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'){const r=e.target.closest&&e.target.closest('tr[data-act="sel"]');if(r)selectAgent(r.dataset.id);}});
const AUTH_MSG={'auth/email-already-in-use':'这个 Email 已经注册过了，请直接登入','auth/invalid-email':'Email 格式不对','auth/weak-password':'密码至少 6 位',
  'auth/invalid-credential':'Email 或密码不对','auth/wrong-password':'Email 或密码不对','auth/user-not-found':'这个 Email 还没注册','auth/too-many-requests':'试太多次了，请稍后再试','auth/network-request-failed':'连不上网络，请检查网络'};
document.addEventListener('submit',e=>{
  const f=e.target; if(!f.dataset||!f.dataset.form)return; e.preventDefault();
  const fd=new FormData(f); const v=k=>String(fd.get(k)||'').trim();
  if(f.dataset.form==='login'){
    const err=$('#l-err'); err.textContent='';
    const btn=f.querySelector('button'); btn.disabled=true; btn.textContent='请稍等…';
    const done=()=>{btn.disabled=false;btn.textContent=S.loginMode==='register'?'注册并开始':'登入';};
    if(S.loginMode==='register'){
      const nick=v('nick');
      S.auth.createUserWithEmailAndPassword(v('email'),String(fd.get('pw')||'')).then(cred=>{
        S.pendingNick=nick;
        return S.db.doc('agents/'+cred.user.uid).set({nick,wake:'07:00',reviewAt:'21:30'});
      }).catch(x=>{err.textContent=AUTH_MSG[x&&x.code]||'注册失败，请再试一次';done();});
    } else {
      S.auth.signInWithEmailAndPassword(v('email'),String(fd.get('pw')||'')).catch(x=>{err.textContent=AUTH_MSG[x&&x.code]||'登入失败，请再试一次';done();});
    }
    return;
  }
  if(f.dataset.form==='client'){
    const id=f.dataset.id; const old=id?S.clients.find(x=>x.id===id):null;
    const c=Object.assign(old?clone(old):{id:uidShort(),status:'active',createdAt:new Date().toISOString()},
      {name:v('name'),contact:v('contact'),tier:v('tier')||'C',source:v('source'),nextDate:v('nextDate'),nextTime:v('nextTime'),note:v('note')});
    if(!c.name)return;
    const sc=f.dataset.score;
    if(sc==='sign'){c.tier='A';}
    f.removeAttribute('data-form'); closeSheet();
    saveClient(c);
    if(sc==='sign')doSign(c); else if(sc)addItem(sc,c);
    else toast(old?'已保存':'已加入 '+c.tier+' 名单');
    return;
  }
  if(f.dataset.form==='talk'){
    const name=v('name'); if(!name)return;
    const d=clone(getDay(TODAY)); d.talks=d.talks||[]; d.talks.push({id:uidShort(),name,note:v('note'),at:new Date().toTimeString().slice(0,5)});
    f.reset(); if(document.activeElement)document.activeElement.blur(); saveDay(d); toast('记下了：'+name); return;
  }
  if(f.dataset.form==='profile'){
    const p=Object.assign(clone(S.profile),{nick:v('nick'),goalCases:v('goalCases'),goalYear:v('goalYear'),why:v('why'),wake:v('wake'),reviewAt:v('reviewAt')});
    if(document.activeElement)document.activeElement.blur(); saveProfile(p); toast('目标已保存');
    if(LN)scheduleNative(true);
    return;
  }
});

/* ---------- leader drill-down ---------- */
function selectAgent(id){
  selUnsubs.forEach(u=>{try{u();}catch(_){}}); selUnsubs=[];
  S.sel=id; S.selClients=[]; S.selDays={}; S.selProfile={}; render(); window.scrollTo(0,0);
  if(!id||!S.db)return;
  const quiet=()=>{};
  selUnsubs.push(S.db.collection('agents/'+id+'/clients').onSnapshot(s=>{S.selClients=s.docs.map(d=>Object.assign({id:d.id},d.data()));render();},quiet));
  selUnsubs.push(S.db.doc('agents/'+id+'/days/'+TODAY).onSnapshot(s=>{S.selDays={};if(s.exists)S.selDays[TODAY]=s.data();render();},quiet));
  selUnsubs.push(S.db.doc('agents/'+id).onSnapshot(s=>{S.selProfile=s.exists?s.data():{};render();},quiet));
}

/* ---------- session ---------- */
function stopAll(){unsubs.forEach(u=>{try{u();}catch(_){}});unsubs=[];selUnsubs.forEach(u=>{try{u();}catch(_){}});selUnsubs=[];}
let synced=false;
function firstSync(){
  if(synced||!S.loaded.c||!S.loaded.d)return; synced=true;
  const mine=S.board[S.uid];
  if(!mine||mine.date!==TODAY||(S.pendingNick&&mine.nick!==S.profile.nick))syncBoard(true);
}
function start(uid,email){
  stopAll(); synced=false;
  Object.assign(S,{uid,email:email||'',signedIn:true,profile:{},clients:[],days:{},board:{},loaded:{c:false,d:false},readonly:false,lastBoard:'',sel:null,tab:'today',stale:false});
  render();
  const db=S.db;
  const timer=setTimeout(()=>{if(!S.loaded.c||!S.loaded.d){S.stale=true;render();}},10000);
  const fresh=s=>{if(!s.metadata.fromCache){if(S.loaded.c&&S.loaded.d)clearTimeout(timer);if(S.stale){S.stale=false;}}};
  const quiet=e=>{if(e&&e.code==='permission-denied'){S.readonly=true;render();}};
  unsubs.push(db.doc('agents/'+uid).onSnapshot(s=>{S.profile=s.exists?s.data():{};if(S.loaded.c&&S.loaded.d&&S.profile.nick&&(S.board[uid]||{}).nick!==S.profile.nick)syncBoard(true);render();},quiet));
  unsubs.push(db.collection('agents/'+uid+'/clients').onSnapshot(s=>{S.clients=s.docs.map(d=>Object.assign({id:d.id},d.data()));if(!s.metadata.fromCache&&!S.loaded.c){S.loaded.c=true;firstSync();}fresh(s);render();},quiet));
  unsubs.push(db.collection('agents/'+uid+'/days').orderBy('date','desc').limit(62).onSnapshot(s=>{const m={};s.docs.forEach(d=>{const x=d.data();if(x&&x.date)m[x.date]=x;});S.days=m;if(!s.metadata.fromCache&&!S.loaded.d){S.loaded.d=true;firstSync();}fresh(s);render();},quiet));
  unsubs.push(db.collection('board').onSnapshot(s=>{const m={};s.docs.forEach(d=>{m[d.id]=Object.assign({uid:d.id},d.data());});S.board=m;if(S.board[uid]&&!S.lastBoard){const b=clone(S.board[uid]);delete b.updatedAt;S.lastBoard=JSON.stringify(b);}render();},()=>{}));
  if(CLOUD){
    db.doc('config/leaders').get().then(s=>{const list=(s.exists&&(s.data().emails||[]))||[];S.leader=list.map(x=>String(x).toLowerCase().trim()).includes(String(email||'').toLowerCase());render();}).catch(()=>{S.leader=false;});
  } else { S.leader=true; }
  if(LN)setTimeout(()=>{if(S.profile.wake)scheduleNative(true);},3000);
}
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
async function boot(){
  render();
  if(!CLOUD){S.db=localDB();start('me','');return;}
  const V='10.12.2', base='https://www.gstatic.com/firebasejs/'+V+'/';
  try{
    await loadScript(base+'firebase-app-compat.js');
    await Promise.all([loadScript(base+'firebase-auth-compat.js'),loadScript(base+'firebase-firestore-compat.js')]);
  }catch(_){
    $('#view').innerHTML='<div class="notice">连不上网络，app 打不开。请连上网络后再打开一次。</div>';return;
  }
  firebase.initializeApp(CFG);
  const fdb=firebase.firestore();
  try{await fdb.enablePersistence({synchronizeTabs:true});}catch(_){}
  S.db=fdb; S.auth=firebase.auth();
  S.auth.onAuthStateChanged(u=>{
    if(u){start(u.uid,u.email);}
    else{stopAll();Object.assign(S,{signedIn:false,uid:null,leader:false,profile:{},clients:[],days:{},board:{}});closeSheet();render();}
  });
}
setInterval(()=>{const t=iso(new Date());if(t!==TODAY){TODAY=t;render();}},60000);
if('serviceWorker' in navigator&&!NATIVE&&location.protocol==='https:'){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{});});}
boot();
})();
