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
function scCreateTask(laneId,presetId){
  const works=S.lanes.filter(l=>l.kind==='work');if(!works.length)return openLaneForm(null,'work');
  let recent='';try{recent=localStorage.getItem('wb_recent_lane')||'';}catch(e){}
  const lane=works.find(l=>l.id===(laneId||WB.lane||recent))?.id||works[0].id;
  const presets=(S.presets||[]).filter(p=>works.some(l=>l.id===p.lane));
  let recentPreset=presetId||'';try{if(!recentPreset)recentPreset=localStorage.getItem('wb_recent_preset')||'';}catch(e){}
  let parent='';try{parent=localStorage.getItem('wb_recent_parent')||'';}catch(e){}
  let explicitPath='',keepTouched=false;
  const presetOf=id=>(S.presets||[]).find(p=>p.id===id);
  const laneOf=id=>S.lanes.find(l=>l.id===id);
  openModal('新建任务',`<form id="sc-create">
    <div class="sc-field"><label for="sc-preset">套用模板</label>
      <div class="sc-pickrow">
        <select class="inp" id="sc-preset"><option value="">不使用模板</option>${presets.map(p=>`<option value="${p.id}" ${p.id===recentPreset?'selected':''}>${esc(p.name)} · ${esc((laneOf(p.lane)||{}).name||'')}${p.hours>1?' · '+p.hours+' 课时':''}</option>`).join('')}</select>
        <button type="button" class="btn tint" id="sc-preset-new">${wi('plus')}新建模板</button>
      </div></div>
    <div class="sc-field"><label for="sc-title">任务名称</label>
      <input id="sc-title" class="inp" placeholder="输入名称，按 Enter 创建" maxlength="40"></div>
    <div class="sc-pair">
      <div class="sc-field"><label for="sc-lane">分组</label><select class="inp" id="sc-lane">${scOptions('work',lane)}</select></div>
      <div class="sc-field"><label for="sc-hours">课时</label><input id="sc-hours" class="inp" type="number" min="1" max="12" value="1"></div>
    </div>
    <div class="sc-pair">
      <div class="sc-field"><label for="sc-parent">父目录<span class="sc-sub">按名称自动找同名子文件夹</span></label>
        <input class="inp" id="sc-parent" readonly placeholder="不选也可以，稍后补"></div>
      <div class="sc-field"><button type="button" class="btn" id="sc-parent-pick">选择</button></div>
    </div>
    <div class="sc-field"><label for="sc-next">下一步<span class="sc-sub">可空</span></label>
      <input id="sc-next" class="inp" maxlength="200"></div>
    <div class="sc-out-preview" id="sc-out-preview"></div>
    <div class="sc-keep"><label class="sc-keep-label"><input type="checkbox" id="sc-keep"><span class="sc-keep-track"></span>保存为模板</label><span class="sc-keep-hint">下次新建直接套用</span></div>
    <div class="sc-field" id="sc-keep-box" hidden><label for="sc-keep-name">模板名称</label><input class="inp" id="sc-keep-name" maxlength="24" placeholder="例：四年级教案包"></div>
    <p class="sc-error" id="sc-create-error" role="alert"></p>
    <button type="submit" hidden>创建</button></form>`,
    `<button class="btn" id="sc-from-folder">从文件夹创建</button><span class="sp"></span><button class="btn" id="sc-cancel">取消</button><button class="btn primary" id="sc-submit">创建</button>`);
  const form=$('#sc-create'),name=$('#sc-title'),select=$('#sc-lane'),hours=$('#sc-hours'),parentInput=$('#sc-parent'),nextInput=$('#sc-next'),presetSel=$('#sc-preset');
  const keep=$('#sc-keep'),keepBox=$('#sc-keep-box'),keepName=$('#sc-keep-name');
  parentInput.value=parent;
  const preview=()=>{const box=$('#sc-out-preview');if(!box)return;
    const p=presetOf(presetSel.value),l=laneOf(select.value);
    const outs=(p&&p.outputs&&p.outputs.length)?p.outputs:(l&&l.outputs)||[];const h=Number(hours.value)||1;
    if(!outs.length){box.innerHTML='<span class="sc-out-label">这个分组还没有产出项</span><span class="sc-out-items">建完可以去分组设置里加</span>';return;}
    const items=outs.map(o=>{const n=o.per==='hours'?h:1;return o.name+(n>1?' × '+n:'');});
    box.innerHTML=`<span class="sc-out-label">将生成 ${items.length} 项产出</span><span class="sc-out-items">${items.map(esc).join(' · ')}</span>`;};
  if(recentPreset&&presets.some(p=>p.id===recentPreset)){const p=presetOf(recentPreset);if(p){select.value=presets.some(x=>x.lane===p.lane)?p.lane:select.value;hours.value=p.hours||1;nextInput.value=p.next||'';if(!parent){parent=p.parent||'';parentInput.value=parent;}}}
  preview();
  /* 开关打开时，模板名跟着任务名走；用户改过就不再覆盖 */
  const suggestKeep=()=>name.value.trim()||'新任务模板';
  const syncKeep=()=>{if(!keepTouched)keepName.value=suggestKeep();};
  keep.onchange=()=>{keepBox.hidden=!keep.checked;if(keep.checked){syncKeep();keepName.focus();keepName.select();}};
  keepName.oninput=()=>{keepTouched=true;};
  name.oninput=syncKeep;
  presetSel.onchange=()=>{const p=presetOf(presetSel.value);if(p){if(works.some(l=>l.id===p.lane))select.value=p.lane;hours.value=p.hours||1;nextInput.value=p.next||'';parent=p.parent||'';parentInput.value=parent;}preview();syncKeep();};
  select.onchange=()=>{preview();syncKeep();};
  hours.oninput=()=>{preview();syncKeep();};
  $('#sc-parent-pick').onclick=async()=>{try{await openPicker(parent,p=>{if(!form.isConnected)return;parent=p;parentInput.value=p;});}catch(e){$('#sc-create-error').textContent=e.message;}};
  $('#sc-preset-new').onclick=()=>openPresetForm(null,p=>scCreateTask(select.value,p.id));
  $('#sc-cancel').onclick=closeModal;
  $('#sc-from-folder').onclick=async()=>{const b=$('#sc-from-folder');b.disabled=true;try{await openPicker(parent,p=>{if(!form.isConnected)return;explicitPath=p;parent=p.split('/').slice(0,-1).join('/')||p;parentInput.value=parent;if(!name.value.trim())name.value=p.split('/').filter(Boolean).pop();name.focus();syncKeep();});}catch(e){$('#sc-create-error').textContent=e.message;}finally{b.disabled=false;}};
  /* 把这次的分组/课时/父目录/下一步/产出存成模板；同名同分组则更新，不堆重复 */
  const saveAsPreset=async()=>{
    const p=presetOf(presetSel.value),l=laneOf(select.value);
    const eff=((p&&p.outputs&&p.outputs.length)?p.outputs:(l&&l.outputs)||[]).map(o=>({
      key:o.key,name:o.name,per:o.per==='hours'?'hours':1,detect:detectOf(o)}));
    const body={name:(keepName.value.trim()||suggestKeep()).slice(0,24),lane:select.value,
      hours:Number(hours.value)||1,parent:parent,next:nextInput.value.trim()};
    if(eff.length&&!sameOutputs(eff,presetOutputsOf(select.value)))body.outputs=eff;
    const exist=(S.presets||[]).find(x=>x.name===body.name&&x.lane===body.lane);
    if(exist){const r=await api('/api/preset/item',Object.assign({id:exist.id},body));Object.assign(exist,r.preset);return {preset:r.preset,updated:true};}
    const r=await api('/api/preset/add',body);S.presets=S.presets||[];S.presets.push(r.preset);return {preset:r.preset,updated:false};
  };
  const submit=async e=>{e?.preventDefault();if(form.dataset.busy)return;
    const p=presetOf(presetSel.value);
    const title=name.value.trim();
    if(!title){$('#sc-create-error').textContent='任务名称不能为空';name.focus();return;}
    const base={presetId:p?p.id:'',lane:select.value,hours:Number(hours.value)||1,parent,next:nextInput.value.trim(),path:explicitPath};
    form.dataset.busy='1';$('#sc-submit').disabled=true;
    let msg='已创建，可以继续添加任务';
    try{
      const r=await api('/api/task/add',Object.assign({title},base));
      S.tasks.unshift(r.task);
      if(typeof SC!=='undefined'&&SC.order)SC.order.unshift(r.task.id);
      if(keep.checked){
        try{const k=await saveAsPreset();if(k){try{localStorage.setItem('wb_recent_preset',k.preset.id);}catch(e){}msg+=`，已${k.updated?'更新':'存为'}模板「${k.preset.name}」`;}}
        catch(err){msg+='，但模板没存上：'+(err.message||'请稍后在模板里新建');}
      }
      try{localStorage.setItem('wb_recent_lane',select.value);if(parent)localStorage.setItem('wb_recent_parent',parent);
        if(!keep.checked&&p)localStorage.setItem('wb_recent_preset',p.id);}catch(e){}
      WB.search='';WB.status='';WB.lane=select.value;WB.sections.set('work','active');WB.pages.set('work:'+wbSection('work'),0);S.route={view:'overview',id:null};closeModal();render();toast(msg);
    }catch(e){form.dataset.busy='';$('#sc-submit').disabled=false;$('#sc-create-error').textContent=e.message||'创建失败，内容已保留';}};
  form.onsubmit=submit;$('#sc-submit').onclick=submit;
  name.focus();
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
