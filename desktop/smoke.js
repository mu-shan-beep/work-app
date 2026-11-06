try {
// Runs only against an isolated WB_APP_DATA_DIR in the native WKWebView.
const check=(ok,message)=>{if(!ok)throw new Error(message)};
const until=async(test)=>{for(let i=0;i<100;i++){if(test())return;await new Promise(r=>setTimeout(r,100));}throw new Error('UI wait timed out');};
const pause=()=>new Promise(r=>setTimeout(r,180));
await until(()=>typeof S!=='undefined'&&S.tasks.length&&document.querySelector('[data-newtask]'));
const initial=S.tasks.length;
document.querySelector('[data-newtask]').click();
document.querySelector('#sc-title').value='App 原生验证任务';
document.querySelector('#sc-create').requestSubmit();
await until(()=>!document.querySelector('#modal.on'));
const task=S.tasks.find(t=>t.title==='App 原生验证任务');check(task,'new task');
let card=()=>document.querySelector(`[data-task="${task.id}"]`);
card().querySelector('[data-sc-edit]').click();
const name=card().querySelector('.sc-inline');name.value='App 改名验证';name.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
await until(()=>task.title==='App 改名验证');
card().querySelector('[data-sc-pin]').click();await until(()=>task.today===true);
card().querySelector('button[data-quick-progress]').click();
document.querySelector('[data-quick-all]').click();await until(()=>taskStat(task)==='done'&&!WB.quickBusy);
wbCloseQuick(false);document.querySelector('[data-wb-section=done]').click();
const search=document.querySelector('#wb-search');search.value='App 改名验证';search.dispatchEvent(new Event('input',{bubbles:true}));
await until(()=>card());check(pct(task)===100,'complete ring');
card().querySelector('button[data-quick-progress]').click();
document.querySelector('[data-sc-status=doing]').click();await until(()=>taskStat(task)!=='done'&&!WB.quickBusy);
wbCloseQuick(false);document.querySelector('[data-wb-section=active]').click();await until(()=>card());
card().querySelector('button[data-quick-progress]').click();
let next=document.querySelector('[data-sc-field=next]');next.value='App 保存验证';next.dispatchEvent(new Event('input',{bubbles:true}));next.focus();next.blur();await SC.queue;
check(task.next==='App 保存验证','next saved');
wbCloseQuick(false);document.querySelector('[data-go=life]').click();
if(!document.querySelector('.wb-life-card')){
  const lane=S.lanes.find(l=>l.kind==='life'&&l.model==='bill')||S.lanes.find(l=>l.kind==='life');
  check(lane,'life group');document.querySelector(`[data-newlife="${lane.id}"]`).click();
  document.querySelector('#sc-life-title').value='App 生活验证';
  if(document.querySelector('#sc-life-amount'))document.querySelector('#sc-life-amount').value='12.50';
  document.querySelector('#sc-life-form').requestSubmit();await until(()=>!document.querySelector('#modal.on'));
}
check(document.querySelector('.wb-life-card'),'life cards');
const bill=document.querySelector('[data-sc-pay]');
if(bill){const id=bill.dataset.scPay,item=S.life.find(i=>i.id===id),old=item.paidMonth;bill.click();await until(()=>item.paidMonth!==old);document.querySelector(`[data-sc-pay="${id}"]`).click();await pause();}
document.querySelector('[data-go=overview]').click();await until(()=>card());
await scRemove('task',task.id);check(!S.tasks.some(t=>t.id===task.id),'remove');
document.querySelector('#toast .ta').click();await until(()=>S.tasks.some(t=>t.id===task.id));
card().querySelector('button[data-quick-progress]').click();
next=document.querySelector('[data-sc-field=next]');next.focus();next.value='退出自动保存验证';next.dispatchEvent(new Event('input',{bubbles:true}));
check(!window.wbAppErrors.length,window.wbAppErrors.join(';'));
check(document.documentElement.scrollWidth<=innerWidth,'horizontal overflow');
return JSON.stringify({ready:true,initialTasks:initial,tasks:S.tasks.length,life:S.life.length,taskId:task.id,url:location.href,errors:window.wbAppErrors,checks:['create','rename','today','complete','reopen','next','life','bill','remove-undo','no-overflow']});

} catch(e) { return JSON.stringify({error:String(e),stack:e.stack,errors:window.wbAppErrors}); }
