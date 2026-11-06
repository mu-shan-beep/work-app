/* 所有高频编辑共用就地录入、自动保存与可恢复删除。 */
const SC={drafts:new Map(),busy:new Set(),order:[],queue:Promise.resolve()};
function scError(el,msg){let p=el.parentElement.querySelector('.sc-error');if(!p){p=document.createElement('small');p.className='sc-error';p.setAttribute('role','alert');el.parentElement.appendChild(p);}p.textContent=msg;}
function scOptions(kind,value){return S.lanes.filter(l=>l.kind===kind).map(l=>`<option value="${esc(l.id)}" ${l.id===value?'selected':''}>${esc(l.name)}</option>`).join('');}
async function scTaskPatch(id,patch){const t=S.tasks.find(t=>t.id===id);const r=await api('/api/task',{taskId:id,...patch});Object.assign(t,r.task);return t;}
function scEdit(el,scope,id,field,value,extra={}){
  if(el.querySelector('input,textarea,select'))return;
  const input=document.createElement(extra.multiline?'textarea':extra.options?'select':'input');input.className='sc-inline';input.setAttribute('aria-label',extra.label||'修改内容');
  if(extra.options)input.innerHTML=extra.options;else input.value=value??'';
  if(extra.type)input.type=extra.type;if(extra.options)input.value=value;
  const original=el.innerHTML;el.replaceChildren(input);input.focus();if(input.select)input.select();let busy=false,cancel=false;
  const save=async()=>{if(busy||cancel)return;let val=input.value.trim();if(field==='title'||field==='name'){if(!val){scError(input,'名称不能为空');return;}}
    if(['hours','need','dueDay','amount'].includes(field)){val=Number(val);const max=field==='hours'?12:field==='dueDay'?31:field==='need'?100:Infinity;if(!Number.isFinite(val)||val<(field==='amount'?0:1)||val>max||field!=='amount'&&!Number.isInteger(val)){scError(input,'请输入有效数值');return;}}
    busy=true;input.setAttribute('aria-busy','true');
    try{if(scope==='task')await scTaskPatch(id,{[field]:val});else if(scope==='life'){const r=await api('/api/life/item',{id,[field]:val});Object.assign(S.life.find(x=>x.id===id),r.item);}else {const r=await api('/api/output',{taskId:id,key:extra.key,[field]:val});Object.assign(S.tasks.find(t=>t.id===id).outputs.find(o=>o.key===extra.key),r.output);}render();toast('已保存');}
    catch(e){busy=false;input.removeAttribute('aria-busy');scError(input,'保存失败，输入已保留；按 Enter 重试。');}
  };
  input.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();cancel=true;el.innerHTML=original;}if(e.key==='Enter'&&!e.isComposing&&(!extra.multiline||e.ctrlKey||e.metaKey)){e.preventDefault();save();}};
  input.onblur=()=>{if(!busy&&!cancel)save();};
}
function scCreateTask(laneId){
  const works=S.lanes.filter(l=>l.kind==='work');if(!works.length)return openLaneForm(null,'work');
  let recent='';try{recent=localStorage.getItem('wb_recent_lane')||'';}catch(e){}
  const lane=works.find(l=>l.id===(laneId||WB.lane||recent))?.id||works[0].id;
  openModal('新建任务',`<form id="sc-create"><label class="fld">任务名称<input id="sc-title" class="inp" placeholder="输入名称，按 Enter 创建" required maxlength="40"></label><label class="fld">分组<select class="inp" id="sc-lane">${scOptions('work',lane)}</select></label><details class="sc-advanced"><summary>课时、文件夹（可稍后补充）</summary><label class="fld">课时 / 集数<input id="sc-hours" class="inp" type="number" min="1" max="12" value="1"></label><input id="sc-path" type="hidden"><button type="button" class="btn" id="sc-folder">${wi('folder')}从文件夹选择</button><p class="hint" id="sc-folder-label"></p></details><p class="sc-error" id="sc-create-error" role="alert"></p><button type="submit" hidden>创建</button></form>`,`<button class="btn" id="sc-from-folder">从文件夹创建</button><span class="sp"></span><button class="btn" id="sc-cancel">取消</button><button class="btn primary" id="sc-submit">创建</button>`);
  const form=$('#sc-create'),name=$('#sc-title'),select=$('#sc-lane'),path=$('#sc-path'),label=$('#sc-folder-label');name.focus();
  const choose=async()=>{const b=$('#sc-from-folder');b.disabled=true;try{await openPicker(path.value,p=>{if(!form.isConnected)return;path.value=p;label.textContent=p;if(!name.value.trim())name.value=p.split('/').filter(Boolean).pop();form.querySelector('details').open=true;name.focus();});}catch(e){$('#sc-create-error').textContent=e.message;}finally{b.disabled=false;}};
  $('#sc-folder').onclick=choose;$('#sc-from-folder').onclick=choose;$('#sc-cancel').onclick=closeModal;
  const submit=async e=>{e?.preventDefault();if(!form.reportValidity()||form.dataset.busy)return;form.dataset.busy='1';$('#sc-submit').disabled=true;
    try{const r=await api('/api/task/add',{title:name.value.trim(),lane:select.value,hours:Number($('#sc-hours').value),path:path.value});S.tasks.unshift(r.task);try{localStorage.setItem('wb_recent_lane',select.value);}catch(e){}
      WB.search='';WB.status='';WB.lane=select.value;WB.sections.set('work','active');WB.pages.set('work:'+wbSection('work'),0);S.route={view:'overview',id:null};SC.order.unshift(r.task.id);closeModal();render();toast('已创建，可以继续添加任务');}
    catch(e){form.dataset.busy='';$('#sc-submit').disabled=false;$('#sc-create-error').textContent=e.message||'创建失败，内容已保留';}};
  form.onsubmit=submit;$('#sc-submit').onclick=submit;
}
async function scFolder(id,replace=false){const t=S.tasks.find(t=>t.id===id);if(!t)return;
  if(t.path&&!replace){try{await api('/api/open',{path:t.path});return;}catch(e){toast('目录已移动，请重新选择');}}
  try{await openPicker(t.path,p=>{SC.queue=SC.queue.then(async()=>{await scTaskPatch(id,{path:p});render();toast('文件夹已关联');}).catch(()=>toast('关联失败，请重试'));});}catch(e){toast(e.message);}
}
async function scRemove(kind,id,taskId){
  try{const r=await api('/api/record/remove',{kind,id,taskId});if(kind==='task')S.tasks=S.tasks.filter(t=>t.id!==id);else if(kind==='life')S.life=S.life.filter(x=>x.id!==id);else S.tasks.find(t=>t.id===taskId).outputs=S.tasks.find(t=>t.id===taskId).outputs.filter(o=>o.key!==id);render();
    toast('已移除，原始文件不受影响',{label:'撤销',run:async()=>{try{await api('/api/record/restore',{kind,trashId:r.trashId,taskId});await load();toast('已恢复');}catch(e){toast('恢复失败，请重试');}}});}
  catch(e){toast(e.message);}
}
async function scPin(id){try{const t=S.tasks.find(t=>t.id===id);await scTaskPatch(id,{today:!t.today});render();}catch(e){toast('保存失败，请重试');}}
function scLifeEdit(id,field,el){const it=S.life.find(i=>i.id===id);scEdit(el,'life',id,field,it[field],{label:'修改'+({title:'名称',amount:'金额',dueDay:'每月到期日',note:'备注'}[field]||field),type:['amount','dueDay'].includes(field)?'number':undefined});}
function scNewLife(lid){const l=laneOf(lid),bill=l.model==='bill';openModal('新建'+(bill?'账单':l.model==='habit'?'习惯':'愿望'),`<form id="sc-life-form"><label class="fld">名称<input class="inp" id="sc-life-title" required></label>${bill?'<label class="fld">金额<input class="inp" id="sc-life-amount" type="number" min="0" step="0.01" value="0"></label><label class="fld">每月几号<input class="inp" id="sc-life-day" type="number" min="1" max="31" value="1"></label>':''}<p id="sc-life-error" class="sc-error" role="alert"></p><button hidden type="submit">创建</button></form>`,`<span class="sp"></span><button class="btn primary" id="sc-life-save">创建</button>`);const f=$('#sc-life-form');$('#sc-life-title').focus();const save=async e=>{e?.preventDefault();if(!f.reportValidity()||f.dataset.busy)return;f.dataset.busy='1';try{const r=await api('/api/life/add',{lane:lid,kind:l.model,title:$('#sc-life-title').value.trim(),amount:bill?Number($('#sc-life-amount').value):0,dueDay:bill?Number($('#sc-life-day').value):1});S.life.push(r.item);closeModal();render();toast('已创建');}catch(e){f.dataset.busy='';$('#sc-life-error').textContent='保存失败，内容已保留';}};f.onsubmit=save;$('#sc-life-save').onclick=save;}
const scTimers=new Map();
async function scSaveDraft(input){const id=input.dataset.scDraft,field=input.dataset.scField,key=input.dataset.scKey||'',token=id+':'+key+':'+field,value=input.value;
  clearTimeout(scTimers.get(token));SC.drafts.set(token,value);
  SC.queue=SC.queue.catch(()=>{}).then(async()=>{try{if(field==='next')await scTaskPatch(id,{next:value});else {const r=await api('/api/output',{taskId:id,key,note:value});Object.assign(S.tasks.find(t=>t.id===id).outputs.find(o=>o.key===key),r.output);}if(SC.drafts.get(token)===value)SC.drafts.delete(token);const s=$('#sc-save-status');if(s)s.textContent='已保存';}catch(e){const s=$('#sc-save-status');if(s)s.textContent='保存失败，草稿已保留；离开输入框可重试';toast('保存失败，草稿已保留');}});return SC.queue;
}
const scOriginalQuick=wbRefreshQuick;
wbRefreshQuick=function(){const box=$('#wb-quick-progress'),active=document.activeElement;const token=active?.dataset?.scDraft?[active.dataset.scDraft,active.dataset.scField,active.dataset.scKey||'']:null;const range=token?[active.selectionStart,active.selectionEnd]:null;const scroll=box?.querySelector('.sc-quick-body')?.scrollTop||0;const notes=box?[...box.querySelectorAll('.sc-output details')].map(d=>d.open):[];scOriginalQuick();const now=$('#wb-quick-progress');if(!now)return;const body=now.querySelector('.sc-quick-body');if(body)body.scrollTop=scroll;now.querySelectorAll('.sc-output details').forEach((d,i)=>d.open=notes[i]||false);if(token){const next=[...now.querySelectorAll('[data-sc-draft]')].find(el=>el.dataset.scDraft===token[0]&&el.dataset.scField===token[1]&&(el.dataset.scKey||'')===token[2]);if(next){next.focus({preventScroll:true});try{next.setSelectionRange(...range);}catch(e){}}}};
document.addEventListener('input',e=>{const el=e.target;if(!el.matches('[data-sc-draft]'))return;const token=el.dataset.scDraft+':'+(el.dataset.scKey||'')+':'+el.dataset.scField;SC.drafts.set(token,el.value);clearTimeout(scTimers.get(token));scTimers.set(token,setTimeout(()=>scSaveDraft(el),650));});
document.addEventListener('focusout',e=>{if(e.target.matches('[data-sc-draft]'))scSaveDraft(e.target);});
document.addEventListener('submit',async e=>{if(e.target.id!=='sc-add-output')return;e.preventDefault();e.stopImmediatePropagation();const f=e.target;if(f.dataset.busy)return;const name=f.elements.name.value.trim();if(!name)return;f.dataset.busy='1';try{const r=await api('/api/output/add',{taskId:WB.quickId,name});Object.assign(S.tasks.find(t=>t.id===WB.quickId),r.task);render();$('#sc-add-output input')?.focus();}catch(err){f.dataset.busy='';scError(f.elements.name,'保存失败，按 Enter 重试');}},true);
document.addEventListener('change',async e=>{const el=e.target;
  if(el.matches('[data-sc-lane]')){try{await scTaskPatch(el.dataset.scLane,{lane:el.value});render();}catch(err){toast('归类失败');}}
  if(el.matches('[data-sc-hours]')){const v=Number(el.value);if(!Number.isInteger(v)||v<1||v>12){scError(el,'课时为 1–12');return;}try{await scTaskPatch(el.dataset.scHours,{hours:v});render();}catch(err){scError(el,'保存失败，请重试');}}
});
document.addEventListener('click',async e=>{
  if(e.target.closest('input,select,textarea'))return;
  const b=e.target.closest('[data-sc-edit],[data-sc-status],[data-sc-folder],[data-sc-pin],[data-sc-pay],[data-sc-day],[data-sc-life-remove],[data-sc-remove-output]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();
  if(b.dataset.scEdit){const {scope,field}=b.dataset,id=b.dataset.scEdit;if(scope==='life')return scLifeEdit(id,field,b);const task=S.tasks.find(t=>t.id===id),obj=scope==='output'?task.outputs.find(o=>o.key===b.dataset.key):task;return scEdit(scope==='task'&&field==='title'?(b.closest('.sc-name-line')||b):b,scope,id,field,obj[field],{key:b.dataset.key,type:field==='need'?'number':undefined,label:'修改'+field});}
  if(b.hasAttribute('data-sc-status'))return wbSaveQuick(b.dataset.output,b.dataset.scStatus);
  if(b.dataset.scFolder)return scFolder(b.dataset.scFolder,b.dataset.replace==='true');
  if(b.dataset.scPin)return scPin(b.dataset.scPin);
  if(b.dataset.scLifeRemove)return scRemove('life',b.dataset.scLifeRemove);
  if(b.dataset.scRemoveOutput)return scRemove('output',b.dataset.scRemoveOutput,b.dataset.parent);
  if(b.dataset.scPay){const it=S.life.find(i=>i.id===b.dataset.scPay),previous=it.paidMonth;const d=new Date(),month=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');try{const r=await api('/api/life/item',{id:it.id,paidMonth:isPaid(it)?'':month});Object.assign(it,r.item);render();toast(it.paidMonth?'已标记付清':'已恢复待付');}catch(err){it.paidMonth=previous;toast('保存失败');}return;}
  if(b.dataset.scDay){const it=S.life.find(i=>i.id===b.dataset.lifeId);try{const r=await api('/api/life/check',{id:it.id,day:b.dataset.scDay});Object.assign(it,r.item);render();}catch(err){toast('补记失败');}}
},true);
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-sc-edit]')){e.preventDefault();e.target.click();}});
