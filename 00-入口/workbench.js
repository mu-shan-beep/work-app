/* 工作台第一版：通栏导航、进度卡片、生活分类。数据仍由现有本地服务管理。 */
const WB = {lane:'', status:'', search:'', lifeSearch:'', lifeStatus:'', detailId:null, detailFocus:null, bodyOverflow:'', pages:new Map(), pageModel:null, pageObserver:null, quickId:null, quickFocus:null, quickAnchor:null, quickBusy:false};
function wi(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true" class="wi" data-icon="${name}">${WB_LUCIDE_ICONS[name] || WB_LUCIDE_ICONS.layers}</svg>`; }
const WB_MORANDI=['#355A70','#6E8D9D','#A4ABA7','#C8C9C5','#738F89','#9090A0','#A79884','#758A9E'];
// 进度使用更鲜明的独立配色，页面主题仍保持深海蓝。
const WB_RING_COLORS=['#2278E3','#0B94B5','#0C9F7B','#7057DA','#B14FA3','#3068CA','#159BA2','#5267D8'];
WB.sections=new Map();
function wbSection(key){return WB.sections.get(key)||'active';}
function wbSectionTasks(tasks,key){return tasks.filter(t=>(taskStat(t)==='done')===(wbSection(key)==='done'));}
function wbSections(tasks,key){
  const done=tasks.filter(t=>taskStat(t)==='done').length;
  return `<div class="wb-task-sections" role="group" aria-label="任务分区">${[['active','未完成',tasks.length-done],['done','已完成',done]].map(([section,label,count])=>`<button data-wb-section="${section}" data-section-key="${esc(key)}" aria-pressed="${wbSection(key)===section}">${label}<span>${count}</span></button>`).join('')}</div>`;
}
function wbSemanticIcon(text,fallback='layers') {
  const options=[[/牛|鹅|鸟/,'bird'],[/虎|猫/,'cat'],[/王戎|果|李/,'cherry'],[/长城|兵马|建筑/,'landmark'],[/园|树|植物/,'tree'],[/山|岳/,'mountain'],[/基因|遗传|孟德尔/,'dna'],[/函数|数学|方程/,'function'],[/运动的描述|自由落体|物理/,'physics'],[/音乐|音频/,'music'],[/代码|编程|Python/,'code'],[/读书|读完|课文/,'book'],[/漫画|分镜/,'comic'],[/故事|人物/,'person'],[/喝水/,'water'],[/运动|活动|动一动|走|散步/,'walk'],[/作息|手机|睡/,'moon'],[/眼|抬头|远处/,'eyes'],[/拍|照片/,'camera'],[/电话|联系/,'phone'],[/吃|饭/,'meal'],[/信用卡/,'credit'],[/存一笔/,'piggy'],[/账|房租/,'wallet'],[/课件|ppt/i,'presentation'],[/教案|教学设计/,'graduate']];
  return options.find(([r])=>r.test(text))?.[1]||fallback;
}
function wbTab() {
  if (S.route.view === 'today') return 'today';
  if (S.route.view === 'life' || (S.route.view==='lane' && laneOf(S.route.id).kind==='life')) return 'life';
  if (S.route.view === 'settings') return 'settings';
  return 'overview';
}
function workbenchHeader() {
  const active = wbTab();
  return `<header class="wb-hero"><div class="wb-hero-inner"><img class="wb-header-art wb-ui-decor" src="/assets/ui-header-decor.png" alt="" aria-hidden="true"><div class="wb-brandrow"><h1><img class="wb-brand-icon" src="/assets/app-icon.png" alt="">个人工作台</h1><span class="wb-date">${todayStr()}</span></div><p>工作有进度，生活有记录。</p><nav class="wb-tabs" aria-label="主导航">${[
    ['today','today','今日安排'],['overview','chart','工作进度'],['life','heart','生活清单'],['settings','user','我的']
  ].map(([v,i,n])=>`<button class="wb-tab ${active===v?'selected':''}" data-go="${v}" data-id="main" ${active===v?'aria-current="page"':''}>${wi(i)}${n}</button>`).join('')}</nav></div></header>`;
}
function wbStats() {
  const outs=S.tasks.flatMap(t=>t.outputs||[]);
  return `<section class="wb-stats" aria-label="工作统计">${[
    [S.tasks.length,'工作任务','check','purple'],[S.tasks.filter(t=>totalN(t)>0&&taskStat(t)==='done').length,'产出齐备','flag','green'],
    [outs.filter(o=>o.status==='confirm').length,'产出待确认','clock','amber'],[outs.filter(o=>o.status!=='done').length,'待完成产出','layers','blue']
  ].map(([v,n,i,c])=>`<div class="wb-stat ${c}"><span class="wb-stat-icon ${c}">${wi(i)}</span><div><b class="num">${v}</b><span>${n}</span></div></div>`).join('')}</section>`;
}
function wbEmpty(title, text, action='') { return `<div class="wb-empty"><span>${wi('folder')}</span><h2>${title}</h2><p>${text}</p>${action}</div>`; }
function wbLaneTheme(lane) {
  const index=Math.max(0,S.lanes.findIndex(l=>l.id===lane.id));
  const color=lane.accent||WB_MORANDI[index%WB_MORANDI.length];
  return {color,index,icon:wbSemanticIcon(lane.name,lane.kind==='life'?'heart':'folder')};
}
function wbRingSegments(t) {
  const outputs=t.outputs||[],n=outputs.length;
  if(!n)return '';
  const slot=100/n, gap=Math.min(1.8,slot*.12),len=slot-gap;
  const offset=wbLaneTheme(laneOf(t.lane)).index;
  return outputs.map((o,i)=>{
    let dash=`${len} ${100-len}`;
    // 尚未完成的彩色段用断线，不能看起来像已经完成的实线段。
    if(o.status==='doing'||o.status==='confirm'){
      const parts=[];let remaining=len;
      while(remaining>0){const line=Math.min(o.status==='doing'?2.1:4.2,remaining);parts.push(line);remaining-=line;const space=Math.min(1.5,remaining);remaining-=space;parts.push(space+(remaining<=0?100-len:0));}
      dash=parts.join(' ');
    }
    return `<circle class="wb-icon-value wb-output-arc arc-${o.status||'todo'}" cx="60" cy="60" r="51" pathLength="100" stroke-dasharray="${dash}" stroke-dashoffset="${-i*slot-gap/2}" style="--arc-color:${WB_RING_COLORS[(i+offset)%WB_RING_COLORS.length]}" data-output-state="${esc(o.status||'todo')}" data-output-key="${esc(o.key||'')}"/>`;
  }).join('');
}
function renderProjectCard(t) {
  const lane=laneOf(t.lane), st=taskStat(t), p=pct(t), outputs=t.outputs||[], theme=wbLaneTheme(lane);
  const pending=outputs.filter(o=>o.status!=='done');
  const current=pending.find(o=>o.status==='confirm')||pending.find(o=>o.status==='doing')||pending[0];
  const stage=current?(current.status==='confirm'?'待确认':current.status==='doing'?'进行中':'待完成')+' · '+current.name:outputs.length?'产出已齐备':'尚无产出';
  return `<article class="wb-desktop-item tcard" data-task="${esc(t.id)}" draggable="true" aria-haspopup="dialog" aria-label="${esc(t.title)}，完成 ${p}%，${esc(stage)}，点击查看详情" title="${esc(t.title)} · ${esc(lane.name)} · ${esc(stage)}" style="--project-color:${theme.color}">
    <button type="button" class="wb-progress-icon wb-progress-trigger" data-quick-progress="${esc(t.id)}" aria-label="修改${esc(t.title)}的进度" aria-haspopup="dialog"><svg class="wb-icon-ring" viewBox="0 0 120 120" aria-hidden="true" data-percent="${p}"><circle class="wb-icon-track" cx="60" cy="60" r="51"/>${wbRingSegments(t)}</svg><span class="wb-progress-center"><strong class="num">${p}<small>%</small></strong><span>${doneN(t)} / ${outputs.length} 项</span></span><span class="wb-ring-category">${wi(wbSemanticIcon(t.title,theme.icon))}</span>${t.today?'<span class="wb-icon-pin">今天</span>':''}</button>
    <div class="sc-name-line"><button class="wb-desktop-name" data-task-detail="${esc(t.id)}">${esc(t.title)}</button><span class="sc-edit-wrap"><button class="sc-mini" data-sc-edit="${esc(t.id)}" data-scope="task" data-field="title" aria-label="修改${esc(t.title)}名称">${wi('edit')}</button></span></div><button class="sc-today-pin ${t.today?'on':''}" data-sc-pin="${esc(t.id)}" aria-label="${t.today?'移出今天':'加入今天'}" aria-pressed="${!!t.today}">${wi('today')}</button>
    <span data-quick-progress="${esc(t.id)}" data-task-status="${st}" class="wb-desktop-stage ${st==='done'?'complete':''}">${wi(st==='done'?'check':st==='confirm'?'flag':'clock')}${esc(t.next||stage)}</span>
    <div class="wb-task-tools"><button data-task-detail="${esc(t.id)}" aria-label="查看${esc(t.title)}详情">${wi('file')}详情</button><button data-sc-folder="${esc(t.id)}" aria-label="打开${esc(t.title)}文件夹">${wi('folder')}</button><button data-more="${esc(t.id)}" aria-label="${esc(t.title)}的更多操作">${wi('more')}</button></div>
  </article>`;
}

// 任务的完整操作收进详情弹窗，桌面只保留图标和名称。
function wbOpenTask(id) {
  if (!S.tasks.some(t=>t.id===id)) return;
  wbCloseQuick(false);
  closeCtx();
  let overlay=document.getElementById('wb-task-overlay');
  if (!overlay) {
    overlay=document.createElement('div');
    overlay.id='wb-task-overlay';
    overlay.className='wb-task-overlay';
    overlay.innerHTML=`<section class="wb-task-window" role="dialog" aria-modal="true" aria-labelledby="wb-detail-title"><header class="wb-task-windowbar"><span id="wb-detail-title">任务详情</span><button type="button" data-close-task aria-label="关闭任务详情">✕</button></header><div id="wb-task-content"></div></section>`;
    overlay.addEventListener('click',e=>{if(e.target===overlay)wbCloseTask();});
    document.body.appendChild(overlay);
  }
  WB.detailFocus=document.activeElement;
  WB.bodyOverflow=document.body.style.overflow;
  WB.detailId=id;
  overlay.hidden=false;
  document.getElementById('app').inert=true;
  document.body.style.overflow='hidden';
  wbRefreshTask();
  overlay.querySelector('[data-close-task]').focus();
}
function wbRefreshTask() {
  if(!WB.detailId)return;
  const task=S.tasks.find(t=>t.id===WB.detailId);
  if(!task)return wbCloseTask();
  const content=document.getElementById('wb-task-content');
  const scroll=content.scrollTop;
  const focus=document.activeElement;
  const key=focus?.dataset?.key;
  const cycle=focus?.hasAttribute('data-cyc');
  document.getElementById('wb-detail-title').textContent=laneOf(task.lane).name+' / 任务详情';
  renderTask(task.id,content);
  content.scrollTop=scroll;
  if(cycle&&key) [...content.querySelectorAll('[data-cyc]')].find(b=>b.dataset.key===key)?.focus({preventScroll:true});
}
function wbCloseTask() {
  if(!WB.detailId)return;
  const id=WB.detailId;
  // 先触发下一步输入框失焦，沿用已有自动保存行为。
  if(document.activeElement?.closest('#wb-task-content'))document.activeElement.blur();
  WB.detailId=null;
  document.getElementById('wb-task-overlay').hidden=true;
  document.getElementById('app').inert=false;
  document.body.style.overflow=WB.bodyOverflow;
  document.getElementById('wb-task-content').innerHTML='';
  const target=WB.detailFocus?.isConnected?WB.detailFocus:[...document.querySelectorAll('[data-task-detail]')].find(el=>el.dataset.taskDetail===id);
  target?.focus({preventScroll:true});
  $('#pop').classList.remove('on');
  closeCtx();
}
// 图标单击、Enter、空格都打开详情；右键继续使用原任务菜单。
document.addEventListener('click',e=>{
  const close=e.target.closest('[data-close-task]');
  const icon=e.target.closest('[data-task-detail]');
  if(!close&&!icon)return;
  e.preventDefault();e.stopImmediatePropagation();
  if(close)wbCloseTask();else wbOpenTask(icon.dataset.taskDetail);
});
document.addEventListener('keydown',e=>{
  if(!WB.detailId||$('#modal').classList.contains('on')||$('#pop').classList.contains('on'))return;
  if(e.key==='Escape'){e.preventDefault();wbCloseTask();return;}
  if(e.key!=='Tab')return;
  const nodes=[...document.querySelectorAll('#wb-task-overlay button:not(:disabled),#wb-task-overlay select,#wb-task-overlay textarea')].filter(el=>el.getClientRects().length);
  const first=nodes[0],last=nodes[nodes.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
});

function wbFilters() {
  return `<div class="wb-toolbar"><div><h2>${wi('clipboard')}手头的项目</h2><span class="wb-toolbar-sub">点圆环改进度，操作就在旁边。</span></div><div class="wb-tools"><label class="wb-search">${wi('search')}<input id="wb-search" aria-label="搜索工作任务" placeholder="搜索任务…" value="${esc(WB.search)}"></label><select id="wb-lane" aria-label="按工作分组筛选"><option value="">全部分组</option>${S.lanes.filter(l=>l.kind==='work').map(l=>`<option value="${esc(l.id)}" ${WB.lane===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select><select id="wb-status" aria-label="按任务状态筛选"><option value="">全部状态</option>${Object.entries(ST).filter(([k])=>k!=='done').map(([k,v])=>`<option value="${k}" ${WB.status===k?'selected':''}>${v.t}</option>`).join('')}</select><button class="btn primary" data-newtask="${esc(WB.lane)}">${wi('plus')}新建任务</button></div></div>`;
}
function renderWorkResults() {
  const grid=$('#wb-projects'); if(!grid)return;
  const q=WB.search.trim().toLowerCase();
  const base=S.tasks.filter(t=>(!WB.lane||t.lane===WB.lane)&&(!q||[t.title,t.next,t.meta,laneOf(t.lane).name].join(' ').toLowerCase().includes(q)));
  const completed=wbSection('work')==='done';
  const tasks=wbSectionTasks(base,'work').filter(t=>completed||!WB.status||taskStat(t)===WB.status);
  $('#wb-work-sections').innerHTML=wbSections(base,'work');
  const status=$('#wb-status');status.disabled=completed;status.value=completed?'':WB.status;
  // 分区内保持原有顺序，完成的任务只进入已完成区。
  if(!SC.order.length)SC.order=S.tasks.map(t=>t.id);
  const sorted=tasks.slice().sort((a,b)=>SC.order.indexOf(a.id)-SC.order.indexOf(b.id));
  WB.pageModel={grid,tasks:sorted,key:'work:'+wbSection('work'),sectionKey:'work'};
  wbDrawPage();
  $('#wb-result-count').textContent=`共 ${tasks.length} 件`;
}
function renderWorkPage() {
  if (WB.lane && !S.lanes.some(l=>l.id===WB.lane && l.kind==='work')) WB.lane='';
  $('#main').innerHTML=`<div class="wb-content wb-desktop-page">${wbStats()}${wbFilters()}<div class="wb-result"><div id="wb-work-sections">${wbSections(S.tasks,'work')}</div><span id="wb-result-count" class="wb-section-count" aria-live="polite"></span><button class="wb-text-btn" data-newlane="work">${wi('plus')}新建工作分组</button></div><div class="wb-project-grid" id="wb-projects"></div>${wbPager()}${wbFooter()}</div>`;
  renderWorkResults();
}
function wbFooter() { return `<footer class="wb-footer">${wi('folder')}数据保存在本机 <span>·</span><button data-go="settings" data-id="main">分组与设置</button></footer>`; }
function renderTodayPage() {
  const habits=S.life.filter(i=>i.kind==='habit');
  $('#main').innerHTML=`<div class="wb-content wb-desktop-page">${wbStats()}<div class="wb-toolbar"><div><h2>${wi('sun')}今天先做这几件</h2><span class="wb-toolbar-sub">点圆环改进度，操作就在旁边。</span></div><button class="btn primary" data-picktoday>${wi('plus')}添加今日任务</button></div><section class="wb-project-grid wb-today" id="wb-today-projects" data-drop-today="1"></section>${wbPager()}<section class="wb-today-habits" aria-label="今日习惯"><span>今日打卡</span>${habits.map(x=>`<button data-check="${esc(x.id)}" aria-pressed="${!!x.doneToday}">${wi(x.doneToday?'check':'heart')}${esc(x.title)}</button>`).join('')}<button class="wb-text-btn" data-go="life" data-id="main">生活清单 ${wi('arrow')}</button></section>${wbFooter()}</div>`;
}

function wbLifeCard(it,index=0) {
  const bill=it.kind==='bill',habit=it.kind==='habit';
  const on=bill?isPaid(it):habit?it.doneToday:!!it.doneAt;
  const status=bill?(on?'本月已付':'待核对'):habit?(on?'今天已打卡':'今天还未打卡'):(on?'已经完成':'想去做');
  const attr=bill?'data-sc-pay':habit?'data-check':'data-wish';
  let extra=habit?`<div class="wb-habit-history" aria-label="最近七天打卡">${Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return `<button data-sc-day="${iso(d)}" data-life-id="${esc(it.id)}" class="${(it.logs||[]).includes(iso(d))?'on':''}" aria-label="${iso(d)}补记">${WD[d.getDay()].slice(1)}</button>`;}).join('')}</div><span class="wb-life-meta">连续 ${it.streak||0} 天 · 最长 ${it.best||0} 天</span>`:bill?`<span class="wb-bill-amount" data-sc-edit="${esc(it.id)}" data-scope="life" data-field="amount" role="button" tabindex="0">${it.amount?'¥ '+Number(it.amount).toLocaleString():'点击填写金额'}</span><span class="wb-life-meta" data-sc-edit="${esc(it.id)}" data-scope="life" data-field="dueDay" role="button" tabindex="0">每月 ${it.dueDay||1} 日</span>`:`<span class="wb-life-meta">${it.doneAt?esc(it.doneAt):esc(it.note||'想做的时候，就记下来。')}</span>`;
  return `<article class="wb-life-card ${on?'is-done':''}"><div class="wb-life-cardtop"><span class="wb-life-number">${String(index+1).padStart(3,'0')}</span>${wi(wbSemanticIcon(it.title,bill?'wallet':habit?'heart':'book'))}</div><h3><span data-sc-edit="${esc(it.id)}" data-scope="life" data-field="title" role="button" tabindex="0">${esc(it.title)}</span><button class="sc-mini" data-sc-life-remove="${esc(it.id)}" aria-label="移除${esc(it.title)}">${wi('trash')}</button></h3><div class="wb-life-extra">${extra}</div><div class="wb-life-cardfoot"><span class="wb-life-label ${on?'done':''}">${status}</span>${`<button class="wb-life-action ${on?'done':''}" ${attr}="${esc(it.id)}" aria-label="${on?'取消':'记录'}${esc(it.title)}">${wi(on?'check':'plus')}</button>`}</div></article>`;
}
function renderLifePage() {
  const wish=S.life.filter(i=>i.kind==='wish');
  const done=wish.filter(i=>i.doneAt).length;
  let h=`<div class="wb-content"><section class="wb-life-progress"><div><b>${done}</b><span> / ${wish.length} 件愿望已完成</span></div><div class="wb-life-meter"><i style="width:${wish.length?done/wish.length*100:0}%"></i></div><span>生活有自己的节奏。</span></section><div class="wb-toolbar"><div><h2>${wi('flower')}生活清单</h2></div><div class="wb-tools"><label class="wb-search">${wi('search')}<input id="wb-life-search" aria-label="搜索生活记录" placeholder="搜索一件小事…" value="${esc(WB.lifeSearch)}"></label><select id="wb-life-status" aria-label="筛选生活记录"><option value="">全部记录</option><option value="pending" ${WB.lifeStatus==='pending'?'selected':''}>尚未完成</option><option value="done" ${WB.lifeStatus==='done'?'selected':''}>已经完成</option></select><button class="btn primary" data-newlane="life">${wi('plus')}新建生活分组</button></div></div><div id="wb-life-results"></div>${wbFooter()}</div>`;
  $('#main').innerHTML=h;renderLifeResults();
}
function renderLifeResults() {
  const q=WB.lifeSearch.trim().toLowerCase();
  $('#wb-life-results').innerHTML=S.lanes.filter(l=>l.kind==='life').map(l=>{
    const all=S.life.filter(i=>i.lane===l.id);const items=all.filter(i=>{const on=i.kind==='habit'?i.doneToday:i.kind==='bill'?isPaid(i):!!i.doneAt;return (!q||[i.title,i.note].join(' ').toLowerCase().includes(q))&&(!WB.lifeStatus||(WB.lifeStatus==='done'?on:!on));});
    if(!items.length&&(q||WB.lifeStatus))return '';
    return `<section class="wb-life-section"><div class="wb-sectionhead"><h2>${wi(wbLaneTheme(l).icon)}${esc(l.name)}<span>${all.length}</span></h2><div><button class="wb-text-btn" data-laneset="${esc(l.id)}">${wi('settings')}分组设置</button><button class="wb-text-btn" data-newlife="${esc(l.id)}">${wi('plus')}新建条目</button></div></div><div class="wb-life-grid">${items.map(wbLifeCard).join('')||'<p class="subtle">这个分组还没有记录，点「新建条目」开始。</p>'}</div></section>`;
  }).join('')||wbEmpty('还没有匹配的生活记录','换个关键词，或创建自己的生活分组。');
}
function renderSettingsPage() {
  const native=!!window.webkit?.messageHandlers?.workbench;
  const groups=kind=>S.lanes.filter(l=>l.kind===kind).map(l=>`<div><button data-go="lane" data-id="${esc(l.id)}"><span class="wb-group-icon" style="--project-color:${wbLaneTheme(l).color}">${wi(wbLaneTheme(l).icon)}</span><strong>${esc(l.name)}</strong><span>${kind==='work'?`${tasksIn(l.id).length} 件任务 · ${(l.outputs||[]).length} 项默认产出`:`${S.life.filter(i=>i.lane===l.id).length} 条记录`}</span></button><button class="btn sm" data-laneset="${esc(l.id)}" aria-label="设置${esc(l.name)}">${wi('settings')}设置</button></div>`).join('');
  $('#main').innerHTML=`<div class="wb-content wb-settings-page"><div class="wb-toolbar"><div><h2>${wi('settings')}我的工作台</h2></div></div><div class="wb-settings-grid">
    <section class="wb-settings-block"><div class="wb-sectionhead"><h2>${wi('graduate')}工作分组</h2><button class="btn sm" data-newlane="work">${wi('plus')}新建分组</button></div><div class="wb-group-list">${groups('work')||'<p class="subtle">新建分组，开始整理工作。</p>'}</div></section>
    <section class="wb-settings-block"><div class="wb-sectionhead"><h2>${wi('heart')}生活分组</h2><button class="btn sm" data-newlane="life">${wi('plus')}新建分组</button></div><div class="wb-group-list">${groups('life')||'<p class="subtle">新建分组，记录生活。</p>'}</div></section>
    <section class="wb-settings-block"><div class="wb-sectionhead"><h2>${wi('settings')}App 设置</h2>${native?'<button class="btn primary sm" data-native-settings>打开设置</button>':''}</div><p class="subtle">登录自启、默认页面、窗口行为、界面大小和数据备份。</p><span class="wb-settings-note">${native?'也可按 ⌘ , 打开原生设置。':'应用设置在 Mac 桌面版中提供。'}</span></section>
    <section class="wb-settings-block"><div class="wb-sectionhead"><h2>${wi('folder')}本地文件</h2><button class="btn sm" data-sync-files>${wi('sync')}重新同步</button></div><p class="subtle">检查关联目录的产出份数，并把文件齐备的「未开始」项标记完成。</p><span class="wb-settings-note">原始文件仍保存在你的目录里。</span></section>
  </div>${wbFooter()}</div>`;
  document.querySelector('[data-native-settings]')?.addEventListener('click',()=>window.webkit.messageHandlers.workbench.postMessage({action:'settings'}));
}
function wbPickToday() {
  openModal('安排今天',`<p class="subtle">选取现有任务加入今天，也可以移出已安排的任务。</p><div class="wb-pick-list">${S.tasks.map(t=>`<div><span><b>${esc(t.title)}</b><small>${esc(laneOf(t.lane).name)} · ${doneN(t)}/${totalN(t)} 项完成</small></span><button class="btn ${t.today?'':'primary'}" data-picker-pin="${esc(t.id)}">${t.today?'移出今天':'加入今天'}</button></div>`).join('')}</div>`,'<button class="btn primary" id="wb-pick-close">完成</button>');
  $('#wb-pick-close').onclick=closeModal;
}
// 只处理新界面的交互，复用旧有录入与保存接口。
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-more],[data-picktoday],[data-picker-pin],[data-sync-files],[data-clearfilters]');if(!b)return;
  e.preventDefault();e.stopImmediatePropagation();
  if(b.hasAttribute('data-more')){const r=b.getBoundingClientRect();return openCtx({clientX:r.left,clientY:r.bottom+5},b.dataset.more);}
  if(b.hasAttribute('data-picktoday'))return wbPickToday();
  if(b.hasAttribute('data-sync-files'))return $('#btnSync').click();
  if(b.hasAttribute('data-clearfilters')){WB.lane=WB.status=WB.search='';WB.pages.set('work:'+wbSection('work'),0);return render();}
  const t=S.tasks.find(t=>t.id===b.dataset.pickerPin);if(!t)return;
  b.disabled=true;
  try{const today=!t.today;await api('/api/task',{taskId:t.id,today});t.today=today;render();wbPickToday();}catch(err){toast('保存失败，请重试');b.disabled=false;}
});
document.addEventListener('input',e=>{
  if(e.target.id==='wb-search'){WB.search=e.target.value;WB.pages.set('work:'+wbSection('work'),0);renderWorkResults();}
  if(e.target.id==='wb-life-search'){WB.lifeSearch=e.target.value;renderLifeResults();}
});
document.addEventListener('change',e=>{
  if(e.target.id==='wb-lane'){WB.lane=e.target.value;WB.pages.set('work:'+wbSection('work'),0);renderWorkResults();}
  if(e.target.id==='wb-status'){WB.status=e.target.value;WB.pages.set('work:'+wbSection('work'),0);renderWorkResults();}
  if(e.target.id==='wb-life-status'){WB.lifeStatus=e.target.value;renderLifeResults();}
});

/* 以实际窗口高度分页，任务桌面本身不滚动。 */
function wbPager() {
  return '<nav class="wb-pagination" aria-label="任务分页"><span class="wb-page-caption" aria-live="polite"></span><div class="wb-page-buttons"></div></nav>';
}
function wbSetupPagination() {
  WB.pageObserver?.disconnect();
  let grid=document.getElementById('wb-projects');
  if(!grid) {
    grid=document.getElementById('wb-lane-projects');
    if(grid){const key='lane:'+S.route.id;grid.insertAdjacentHTML('beforebegin',`<div class="wb-result">${wbSections(tasksIn(S.route.id),key)}</div>`);WB.pageModel={grid,tasks:wbSectionTasks(tasksIn(S.route.id),key),key:key+':'+wbSection(key),sectionKey:key};}
  }
  if(!grid) {
    grid=document.getElementById('wb-today-projects');
    if(grid){const tasks=S.tasks.filter(t=>t.today);grid.insertAdjacentHTML('beforebegin',`<div class="wb-result">${wbSections(tasks,'today')}</div>`);WB.pageModel={grid,tasks:wbSectionTasks(tasks,'today'),key:'today:'+wbSection('today'),sectionKey:'today'};}
  }
  document.body.classList.toggle('wb-paged',!!grid);
  if(!grid){WB.pageModel=null;return;}
  grid.parentElement.classList.add('wb-desktop-page');
  WB.pageObserver=new ResizeObserver(()=>requestAnimationFrame(()=>wbDrawPage()));
  WB.pageObserver.observe(grid);
  requestAnimationFrame(()=>wbDrawPage());
}
function wbDrawPage() {
  const model=WB.pageModel;
  if(!model||!model.grid.isConnected)return;
  const {grid,tasks,key}=model;
  const style=getComputedStyle(grid);
  const cols=Math.max(1,style.gridTemplateColumns.split(/\s+/).filter(Boolean).length);
  const height=parseFloat(style.getPropertyValue('--wb-icon-height'))||150;
  const gap=parseFloat(style.rowGap)||0;
  const rows=Math.max(1,Math.floor((grid.clientHeight+gap)/(height+gap)));
  const size=cols*rows;
  const pages=Math.max(1,Math.ceil(tasks.length/size));
  const page=Math.max(0,Math.min(WB.pages.get(key)||0,pages-1));
  WB.pages.set(key,page);
  // 不在尺寸未变化时替换 DOM，保留图标焦点与拖动状态。
  const signature=[key,page,size,tasks.map(t=>[t.id,t.title,t.lane,t.today,pct(t),taskStat(t),(t.outputs||[]).map(o=>o.name+':'+o.status).join(',')].join(':')).join('|')].join('/');
  if(grid.dataset.pageSignature!==signature) {
    grid.dataset.pageSignature=signature;
    const completed=wbSection(model.sectionKey)==='done',today=model.sectionKey==='today';
    grid.innerHTML=tasks.length?tasks.slice(page*size,(page+1)*size).map(renderProjectCard).join(''):wbEmpty(completed?'还没有已完成的任务':today?'今天没有未完成任务':'没有待处理的任务',completed?'完成的任务会自动收进这里，随时可以查看和修改。':'完成的任务已收进「已完成」分区。',completed?'':today?'<button class="btn primary" data-picktoday>挑选今日任务</button>':'<button class="btn" data-clearfilters>清除筛选</button>');
  }
  const pager=grid.parentElement.querySelector('.wb-pagination');
  if(!pager)return;
  pager.querySelector('.wb-page-caption').textContent=tasks.length?`第 ${page+1} / ${pages} 页 · ${page*size+1}–${Math.min((page+1)*size,tasks.length)} / ${tasks.length} 件`:'共 0 件';
  const from=Math.max(0,Math.min(page-2,pages-5)),to=Math.min(pages,from+5);
  pager.querySelector('.wb-page-buttons').innerHTML=`<button data-wb-page="${page-1}" ${page===0?'disabled':''} aria-label="上一页">‹</button>${Array.from({length:to-from},(_,i)=>{const n=from+i;return `<button data-wb-page="${n}" ${n===page?'aria-current="page"':''} aria-label="第 ${n+1} 页">${n+1}</button>`;}).join('')}<button data-wb-page="${page+1}" ${page>=pages-1?'disabled':''} aria-label="下一页">›</button>`;
}
document.addEventListener('click',e=>{
  const section=e.target.closest('[data-wb-section]');
  if(section){e.preventDefault();wbCloseQuick(false);WB.sections.set(section.dataset.sectionKey,section.dataset.wbSection);render();document.querySelector(`[data-section-key="${CSS.escape(section.dataset.sectionKey)}"][aria-pressed="true"]`)?.focus({preventScroll:true});return;}
  const button=e.target.closest('[data-wb-page]');
  if(!button||button.disabled||!WB.pageModel)return;
  e.preventDefault();
  WB.pages.set(WB.pageModel.key,Number(button.dataset.wbPage));
  wbDrawPage();
  // 替换分页按钮后让焦点留在当前页，键盘可继续翻页。
  document.querySelector('.wb-pagination [aria-current="page"]')?.focus({preventScroll:true});
});

/* 圆环上直接改产出，无需进入任务详情。 */
function wbOpenQuick(id,trigger) {
  if(!S.tasks.some(t=>t.id===id))return;
  closeCtx();WB.quickId=id;WB.quickFocus=trigger;WB.quickAnchor=trigger.getBoundingClientRect();
  wbRefreshQuick();document.querySelector('#wb-quick-progress select, #wb-quick-progress button')?.focus({preventScroll:true});
}
function wbCloseQuick(restore=true) {
  const id=WB.quickId;WB.quickId=null;
  document.getElementById('wb-quick-progress')?.remove();
  if(restore){const target=WB.quickFocus?.isConnected?WB.quickFocus:[...document.querySelectorAll('[data-quick-progress]')].find(e=>e.dataset.quickProgress===id);target?.focus({preventScroll:true});}
}
function wbRefreshQuick() {
  if(!WB.quickId)return;
  const task=S.tasks.find(t=>t.id===WB.quickId);if(!task)return wbCloseQuick(false);
  let box=document.getElementById('wb-quick-progress');
  if(!box){box=document.createElement('section');box.id='wb-quick-progress';box.className='wb-quick-progress';box.setAttribute('role','dialog');box.setAttribute('aria-label','直接修改进度');document.body.appendChild(box);}
  const active=document.activeElement?.dataset?.quickOutput;
  box.innerHTML=`<header><div><strong>${esc(task.title)}</strong><span>${doneN(task)} / ${totalN(task)} 项完成 · ${pct(task)}%</span></div><button data-close-quick aria-label="关闭进度面板">${wi('close')}</button></header><div class="sc-quick-body"><div class="sc-task-meta"><label>归类<select data-sc-lane="${esc(task.id)}">${scOptions('work',task.lane)}</select></label><label>课时<input data-sc-hours="${esc(task.id)}" type="number" min="1" max="12" value="${task.hours||1}"></label><button class="btn" data-sc-folder="${esc(task.id)}" data-replace="true">${wi('folder')}${task.path?'更换目录':'关联目录'}</button></div><div class="wb-quick-rows">${(task.outputs||[]).map(o=>`<div class="sc-output"><div class="sc-output-title"><span data-sc-edit="${esc(task.id)}" data-scope="output" data-key="${esc(o.key)}" data-field="name">${esc(o.name)}</span><span data-sc-edit="${esc(task.id)}" data-scope="output" data-key="${esc(o.key)}" data-field="need" class="sc-need">${o.need} 份</span><button class="sc-mini" data-sc-remove-output="${esc(o.key)}" data-parent="${esc(task.id)}" aria-label="移除${esc(o.name)}">${wi('trash')}</button></div><div class="sc-statuses" role="group" aria-label="${esc(o.name)}状态">${Object.entries(ST).map(([k,v])=>`<button data-sc-status="${k}" data-output="${esc(o.key)}" aria-pressed="${o.status===k}" ${WB.quickBusy?'disabled':''}>${v.t}</button>`).join('')}</div><details><summary>${o.note?'查看 / 修改备注':'+ 备注'}</summary><textarea data-sc-draft="${esc(task.id)}" data-sc-field="note" data-sc-key="${esc(o.key)}" aria-label="${esc(o.name)}备注">${esc(SC.drafts.get(task.id+':'+o.key+':note')??o.note??'')}</textarea></details></div>`).join('')}</div><form id="sc-add-output"><input class="inp" name="name" placeholder="＋输入产出名称，Enter 添加" aria-label="新增产出" required><button class="sc-mini" type="submit" aria-label="添加产出">${wi('plus')}</button></form><label class="sc-next">下一步<textarea data-sc-draft="${esc(task.id)}" data-sc-field="next" aria-label="下一步">${esc(SC.drafts.get(task.id+'::next')??task.next??'')}</textarea></label><span id="sc-save-status" role="status"></span></div><footer><button class="btn primary" data-quick-all="done" ${WB.quickBusy||!totalN(task)?'disabled':''}>${wi('check')}全部完成</button><button class="btn" data-quick-edit="${esc(task.id)}">${wi('edit')}完整编辑</button><span>改完即保存</span></footer><p class="wb-quick-error" role="alert"></p>`;

  const trigger=[...document.querySelectorAll('[data-quick-progress]')].find(e=>e.dataset.quickProgress===task.id);
  const rect=trigger?.getBoundingClientRect()||WB.quickAnchor;
  const w=Math.min(370,innerWidth-24);box.style.width=w+'px';
  box.style.maxHeight=Math.max(180,innerHeight-24)+'px';
  const h=box.getBoundingClientRect().height;
  const left=Math.max(12,Math.min(rect.left,innerWidth-w-12));
  const top=rect.bottom+10+h<=innerHeight-12?rect.bottom+10:Math.max(12,Math.min(rect.top-h-10,innerHeight-h-12));
  box.style.left=left+'px';box.style.top=top+'px';
  if(active)[...box.querySelectorAll('[data-quick-output]')].find(el=>el.dataset.quickOutput===active)?.focus({preventScroll:true});
}
async function wbSaveQuick(key,status) {
  if(WB.quickBusy)return;
  const task=S.tasks.find(t=>t.id===WB.quickId);if(!task)return;
  WB.quickBusy=true;wbRefreshQuick();
  const previous=JSON.parse(JSON.stringify(task.outputs));
  try {
    if(key){const r=await api('/api/output',{taskId:task.id,key,status});const o=task.outputs.find(o=>o.key===key);Object.assign(o,r.output);}
    else{const r=await api('/api/task',{taskId:task.id,allStatus:status});Object.assign(task,r.task);}
    WB.quickBusy=false;render();
    if(!key)toast('已全部完成',{label:'撤销',run:async()=>{try{const r=await api('/api/task',{taskId:task.id,outputs:previous});Object.assign(task,r.task);render();toast('已撤销');}catch(e){toast('撤销失败，请重试');}}});
    else toast(taskStat(task)==='done'?'已保存，任务已移入「已完成」':previous.every(o=>o.status==='done')?'已保存，任务已移回「未完成」':'已保存');
  } catch(e) {WB.quickBusy=false;wbRefreshQuick();const error=document.querySelector('.wb-quick-error');if(error)error.textContent='保存失败，请重试。';}
}
document.addEventListener('click',e=>{
  const trigger=e.target.closest('[data-quick-progress]');
  if(trigger){e.preventDefault();e.stopImmediatePropagation();wbOpenQuick(trigger.dataset.quickProgress,trigger);return;}
  const close=e.target.closest('[data-close-quick]'),all=e.target.closest('[data-quick-all]'),edit=e.target.closest('[data-quick-edit]');
  if(close||all||edit){e.preventDefault();e.stopImmediatePropagation();if(close)wbCloseQuick();else if(all)wbSaveQuick(null,all.dataset.quickAll);else {const id=edit.dataset.quickEdit;wbCloseQuick(false);openTaskForm(id);}return;}
  if(WB.quickId&&!e.target.closest('#wb-quick-progress'))wbCloseQuick(false);
},true);
document.addEventListener('change',e=>{if(e.target.matches('[data-quick-output]'))wbSaveQuick(e.target.dataset.quickOutput,e.target.value);});
document.addEventListener('keydown',e=>{if(WB.quickId&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();wbCloseQuick();}},true);
window.addEventListener('resize',()=>{if(WB.quickId)requestAnimationFrame(wbRefreshQuick);});
