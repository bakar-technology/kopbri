const templates = [
  {model:'ChatGPT', color:'#75e5ba', glyph:'✳', profession:'Yazılım mühendisi'},
  {model:'Claude', color:'#ffae8a', glyph:'✷', profession:'Araştırma analisti'},
  {model:'Gemini', color:'#ac9bff', glyph:'✦', profession:'Veri analisti'}
];
const $ = id => document.getElementById(id);
const saved = JSON.parse(localStorage.getItem('kopbri-demo-v1') || 'null');
const agents = Array.isArray(saved?.agents) ? saved.agents : [{...templates[0],name:'İpek',profession:'İnsan kaynakları',role:'İşe alım ve ekip planlaması',voice:'feminine',recruiter:true}];
const activeAgents = () => agents.map((agent,index)=>({agent,index})).filter(({agent})=>!agent.archived);
const isActive = index => Boolean(agents[index] && !agents[index].archived);
const profession = agent => agent.profession || templates.find(template=>template.model===(agent.model ?? agent.name))?.profession || 'Uzman';
const tasks = saved?.tasks ?? [];
const messages = saved?.messages ?? [];
const voiceThreads = saved?.voiceThreads ?? {};
const states = ['Sırada','Çalışıyor','Tamamlandı'];
let selected = -1, editingAgent = -1;
let voiceAgentIndex = null;
let meetingMode=false;
const officeUpdates = new BroadcastChannel('kopbri-office-updates');
const officePresence = new BroadcastChannel('kopbri-office-presence');
const usageUpdates = new BroadcastChannel('kopbri-usage');
const speakingAgents=new Map();
function announceWork(index,working,remote=false){
  if(working)speakingAgents.set(index,Date.now()+180000);else speakingAgents.delete(index);
  if(!remote)officePresence.postMessage({index,working});
  if(working && stroll?.index===index)stopStroll(false);
  renderAgents();
}
officePresence.onmessage=({data})=>announceWork(data.index,data.working,true);
let runningTask = false;
const names = ['Ada','Atlas','Mira','Deniz','Nova','Poyraz','Luna','Aras','Arya','Ekin'];
const engines = {ChatGPT:'codex',Claude:'claude',Gemini:'gemini'};
const desktop = window.parent.bb;
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function userContent(tag,text,cls) {
  const node=el(tag,text,cls);
  node.dataset.userContent='';
  return node;
}
function badge(agent) {
  const node = el('span',agent.glyph,'badge');
  node.style.setProperty('--tone',agent.color);
  return node;
}
function current(i) { return tasks.findLast(task => (task.agent === i || (task.state===1 && task.executor===i)) && task.state !== 2); }
function select(i) { selected = i; render(); }
function renderAgents(active=activeAgents()) {
  $('teamCount').textContent = 'EKİP / '+String(active.length).padStart(2,'0');
  $('agents').dataset.dense = active.length > 6;
  $('agents').replaceChildren(...active.map(({agent,index:i}) => {
    const button = el('button',null,'agent'+(i===selected?' selected':''));
    button.style.setProperty('--tone',agent.color);
    const name = el('span');
    const status=stroll?.index===i ? stroll.label : (speakingAgents.get(i)||0)>Date.now() ? 'Görüşmede' : current(i) ? states[current(i).state] : 'Müsait';
    name.append(userContent('b',agent.name),el('small',profession(agent)+' · '+status));
    button.title=agent.model ?? agent.name;
    button.append(badge(agent),name);
    button.onclick = () => select(i);
    return button;
  }));
}
function render() {
  if(stroll && !canStroll(stroll.index))stopStroll(false);
  const active=activeAgents();
  if (!isActive(selected)) selected = active[0]?.index ?? -1;
  $('new').disabled = active.length===0;
  renderAgents(active);
  const task = current(selected);
  if (selected<0) {
    $('detail').replaceChildren(el('h2','Ofis hazır'),el('p','İlk ajanı ekleyerek masanı ve çalışma ekibini oluştur.'));
  } else {
    const agent=agents[selected], actions=el('div',null,'agent-actions');
    const edit=el('button','Düzenle','secondary');
    edit.onclick=()=>openAgentEditor(selected);
    const remove=el('button','Ajanı sil','secondary');
    remove.onclick=()=>{
      $('removeAgentName').textContent=agent.name+' ofisten kaldırılacak. Görevleri ve sohbet geçmişi saklanır.';
      $('removeAgentDialog').returnValue='cancel';
      $('removeAgentDialog').dataset.agent=String(selected);
      $('removeAgentDialog').showModal();
    };
    actions.append(edit,remove);
    $('detail').replaceChildren(el('small',profession(agent)+' / AKTİF GÖREV'),task ? userContent('h2',task.title) : el('h2','Görev bekliyor'),userContent('p',task?.role || agent.role),actions);
  }
  $('taskList').replaceChildren(...tasks.map(task => {
    const row = el('div',null,'row');
    const info = el('div');
    info.append(userContent('b',task.title),userContent('p',task.role),el('small',agents[task.agent].name+' · '+states[task.state]));
    if (task.workspace) {
      const scope=userContent('small',task.workspace);
      scope.className='task-workspace';
      info.append(scope);
    }
    if (task.executor!=null && task.executor!==task.agent && agents[task.executor]) {
      info.append(el('p','Devralan ajan · '+agents[task.executor].name+' · '+agents[task.executor].model),
        el('small',budgetReason(task.routeReason)));
      if (task.routeRemaining!=null) info.append(el('p','Devir öncesi kalan bütçe · '+task.routeRemaining.toLocaleString(window.kopbriLanguage?.() || 'tr')+' token'));
    }
    if (task.result) {
      const result=el('details');
      result.append(el('summary','Görev sonucu'),userContent('p',task.result));
      info.append(result);
    }
    if (task.state===0 && !task.result) {
      const preference=el('label',null,'check');
      const checkbox=el('input');
      checkbox.type='checkbox'; checkbox.checked=task.autoRoute!==false;
      checkbox.onchange=()=>{task.autoRoute=checkbox.checked;save();};
      preference.append(checkbox,document.createTextNode(' Bütçe yetmezse başka ajana devret'));
      info.append(preference);
    }
    if (task.automatic || task.team) {
      const planner = agents[task.analyst];
      info.append(el('small',planner ? 'Analist · '+planner.name : 'Analist atanmadı'));
      if (task.phase && task.state!==2) info.append(el('p',task.phase));
      if (task.plan) {
        const plan=el('details');
        plan.append(el('summary','Analistin planı'),userContent('p',task.plan));
        info.append(plan);
      }
    }
    row.append(badge(agents[task.agent]),info);
    if (task.state < 2) {
      const button = el('button',!isActive(task.agent)?'Ajan silindi':task.state === 0 ? 'Çalıştır' : 'Çalışıyor');
      button.disabled = runningTask || !isActive(task.agent);
      button.onclick = () => runTask(task);
      row.append(button);
    }
    if (task.error) info.append(el('p',task.error,'runError'));
    return row;
  }));
  if (!tasks.length) $('taskList').append(el('p','İlk görevini oluştur ve bir ajan seç.'));
  const groups=new Map();
  $('messages').replaceChildren(el('p','Görev sonuçları ve ajan görüşmeleri'));
  for(const message of messages) {
    const row = el('div',null,'row');
    const info = el('div');
    info.append(userContent('b',agents[message.agent].name),userContent('p',message.body));
    row.append(badge(agents[message.agent]),info);
    if (!message.exchange) { $('messages').append(row); continue; }
    if (!groups.has(message.exchange)) {
      const thread=el('details',null,'voice-archive');
      thread.append(el('summary',message.meeting?'Ekip toplantısı':'Ajanlar arası görüşme'),userContent('p',message.topic));
      $('messages').append(thread);
      groups.set(message.exchange,thread);
    }
    groups.get(message.exchange).append(row);
  }
  for(const [id,thread] of Object.entries(voiceThreads)) {
    const agent=agents[id];
    if(!agent || !thread.length)continue;
    const history=el('details',null,'voice-archive');
    history.append(el('summary',agent.name+' · Sesli görüşme geçmişi'+(agent.archived?' · Silindi':'')));
    for(const item of thread){
      const row=el('div',null,'row');
      row.append(item.side==='user'?el('b','Sen'):userContent('b',agents[item.author]?.name || agent.name),userContent('p',item.text));
      history.append(row);
    }
    $('messages').append(history);
  }
  document.querySelectorAll('.desk').forEach(desk => {
    const i=Number(desk.dataset.agent);
    desk.dataset.selected = i===selected;
    desk.querySelector('.status').setAttribute('fill',current(i) ? '#75e5ba' : '#a9a4bd');
  });
}
function save() {
  const body = JSON.stringify({agents,tasks,messages,voiceThreads});
  localStorage.setItem('kopbri-demo-v1',body);
  officeUpdates.postMessage(body);
  fetch('/api/office',{method:'POST',headers:{'Content-Type':'application/json','X-BB':'1'},body}).catch(console.error);
}
const views = {office:['Ajan Ofisi','Ekibinin masasına göz at, görevleri ve konuşmaları takip et.'],tasks:['Görevler','Rolleri belirle ve her görevin durumunu takip et.'],chat:['Konuşmalar','Ajanların aynı görev etrafında nasıl iletişim kurduğunu gör.']};
function tab(key) {
  document.body.dataset.view = key;
  document.querySelectorAll('.view').forEach(view => view.hidden = view.id !== key);
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active',button.dataset.tab===key));
  $('heading').textContent = $('crumb').textContent = views[key][0];
  $('subtitle').textContent = views[key][1];
  document.dispatchEvent(new CustomEvent('kopbri-office-view',{detail:key}));
}
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => tab(button.dataset.tab));
const agentSelect = $('form').elements.agent;
function taskDialog(title='') {
  const active=activeAgents();
  if (!active.length){openAgentEditor();return;}
  agentSelect.replaceChildren(...active.map(({agent,index}) => new Option(agent.name+' · '+profession(agent),index)));
  agentSelect.value = selected;
  $('form').elements.title.value = title;
  $('taskFormStatus').textContent='';
  $('dialog').showModal();
}
$('new').onclick = () => taskDialog();
function openAgentEditor(index=-1) {
  if (index<0 && (activeAgents().length>=10 || agents.length>=200)) return;
  editingAgent=index;
  const form=$('agentForm'), agent=agents[index];
  form.reset();
  $('agentFormTitle').textContent=agent?'Ajanı düzenle':'Yeni ajan';
  $('agentFormSubmit').textContent=agent?'Kaydet':'Ajan ekle';
  form.elements.name.value = agent?.name ?? (names.find(name => !activeAgents().some(({agent})=>agent.name.toLocaleLowerCase('tr')===name.toLocaleLowerCase('tr'))) || 'Ajan '+(agents.length+1));
  if (agent) {
    form.elements.model.value=Math.max(0,templates.findIndex(item=>item.model===(agent.model ?? agent.name)));
    form.elements.profession.value=profession(agent);
    form.elements.role.value=agent.role;
    form.elements.voice.value=voiceProfile(index);
  }
  $('agentDialog').showModal();
}
$('newAgent').onclick = () => openAgentEditor();
$('removeAgentDialog').onclose = () => {
  const dialog=$('removeAgentDialog'), index=Number(dialog.dataset.agent);
  if(dialog.returnValue!=='remove' || !isActive(index))return;
  agents[index].archived=true;
  save();drawDesks();render();
  if($('voiceDialog').open)refreshVoiceAgent();
};
$('agentForm').onsubmit = event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const name = data.get('name').trim(), job=data.get('profession').trim(), role = data.get('role').trim() || job;
  if (!name || !job || (editingAgent<0 && (activeAgents().length>=10 || agents.length>=200))) return;
  const base = templates[Number(data.get('model'))];
  const agent={...base,name,role,profession:job,voice:data.get('voice')==='masculine'?'masculine':'feminine'};
  const index=editingAgent<0?agents.length:editingAgent;
  agents[index]=agent;
  save(); drawDesks(); select(index);
  if($('voiceDialog').open)refreshVoiceAgent(index);
  event.target.reset(); $('agentDialog').close();
};
$('cancelAgent').onclick = () => $('agentDialog').close();
$('close').onclick = () => $('dialog').close();
$('form').onsubmit = async event => {
  event.preventDefault();
  const form=event.target;
  const data = new FormData(form);
  const title = data.get('title').trim();
  if (!title) return;
  const agent = Number(data.get('agent'));
  if (!isActive(agent))return;
  const submit=form.querySelector('button.primary');
  if (submit.disabled) return;
  submit.disabled=true;
  try {
    const workspace=await taskWorkspace();
    if (!$('dialog').open || !isActive(agent)) return;
    tasks.push({title,agent,role:data.get('role').trim(),team:data.has('team'),folder:data.has('folder'),workspace,state:0});
    save(); select(agent); tab('tasks'); form.reset(); $('dialog').close();
  } catch (error) {
    const status=$('taskFormStatus');
    status.textContent=error.message;
  } finally {submit.disabled=false;}
};

let awaitingApproval;
function looksLikeEdit(text) {
  const value = text.toLocaleLowerCase('tr');
  return /dosya|klasör|proje|repo|kod|belge|notu/.test(value) &&
    /yaz|oluştur|düzenle|değiştir|kaydet|ekle|sil|taşı|düzelt|güncelle|yenile/.test(value);
}
async function requestFolderAccess(index,prompt,speak,workspace,signal) {
  if (!desktop?.folderAccess) throw Error('Klasör izinleri masaüstü uygulamasında kullanılabilir.');
  const engine = engines[agents[index].model ?? agents[index].name];
  const status = await desktop.folderAccess('status',engine);
  if (!status) throw Error('Çalışma klasörü bulunamadı.');
  if (workspace && await taskWorkspace(signal)!==workspace) throw Error('Bu görev için kayıtlı çalışma klasörünü aç.');
  signal?.throwIfAborted();
  if (status.approved) return null;
  if (awaitingApproval) throw Error('Önce açık klasör izin isteğini yanıtla.');
  const dialog = $('folderDialog');
  $('folderAgent').textContent = agents[index].name+' · '+status.folder;
  $('folderRequest').textContent = prompt.slice(0,420);
  $('folderHint').textContent = speak ? 'Sesle onaylamak için kısayolu basılı tutup “Bu klasördeki tüm işlemlere tamam” de.' : 'Klasör onayı bu uygulama oturumu boyunca geçerli.';
  const abort=()=>dialog.close('cancel');
  let choice;
  try {
    choice = await new Promise(resolve => {
      awaitingApproval = {resolve,speak};
      dialog.returnValue = 'cancel';
      dialog.showModal();
      signal?.addEventListener('abort',abort,{once:true});
      if (speak) playReply(window.kopbriLanguage?.()==='en'
        ? 'Do you approve operations in this folder, sir? You can say “Allow all operations in this folder”.'
        : 'Bu çalışma klasöründeki işlemlere onay veriyor musunuz, efendim? Bu klasördeki tüm işlemlere tamam diyebilirsiniz.',agents[index].name);
    });
  } finally {
    signal?.removeEventListener('abort',abort);
    awaitingApproval=null;
  }
  signal?.throwIfAborted();
  if (choice==='cancel') throw Error('Klasör işlemi iptal edildi.');
  const grant = await desktop.folderAccess(choice,engine,status.folder);
  if (!grant) throw Error('Çalışma klasörü değişti. İzin isteğini yeniden aç.');
  return grant.token ?? null;
}
$('folderDialog').onclose = () => {
  stopPlayback();
  awaitingApproval?.resolve($('folderDialog').returnValue);
};
function handleSpokenApproval(text) {
  const normalized = text.toLocaleLowerCase('tr').replace(/[^\p{L}\s]/gu,'').replace(/\s+/g,' ').trim();
  const all = /^(?:evet )?(?:bu )?klasördeki (?:tüm|bütün) işlemlere (?:tamam|okey|onay veriyorum|izin veriyorum)$/.test(normalized);
  const once = /^(?:evet )?(?:yalnızca |sadece )?bu (?:işleme|göreve) (?:tamam|okey|onay veriyorum|izin veriyorum)$/.test(normalized);
  const english = text.toLowerCase().replace(/[^a-z\s]/g,'').replace(/\s+/g,' ').trim();
  if (all || english==='allow all operations in this folder') $('folderDialog').close('session');
  else if (once || english==='allow for this task') $('folderDialog').close('once');
  else if (/^(?:hayır|iptal|izin vermiyorum|no|cancel)$/.test(normalized)) $('folderDialog').close('cancel');
  else $('folderHint').textContent = 'Onay anlaşılmadı. Tam ifadeyi söyle veya aşağıdan bir seçenek seç.';
}
function agentPrompt(index,prompt) {
  const agent = agents[index];
  return 'Ajan adın: '+agent.name+'\nMesleğin: '+profession(agent)+'\nUzmanlık rolün: '+(agent.role || '')+'\nKullanıcının son mesajındaki dilde yanıt ver. Kullanıcıya doğrudan verdiğin yanıtta ilk cümlede doğal biçimde Türkçe “efendim”, İngilizce “sir” diye hitap et. Ajanlar arası geri bildirimde ve istenen özel çıktı biçimlerinde hitap ekleme.\n\n'+prompt;
}
const agentEngine=index=>engines[agents[index].model ?? agents[index].name];
const permissionMarker='[[KOPBRI_KLASOR_IZNI]]';
const permissionPrompt=prompt=>prompt+'\n\nBu isteği tamamlamak için çalışma klasöründe dosya oluşturmak veya değiştirmek şartsa yalnızca '+permissionMarker+' yaz.';
async function askAgent(index,prompt,signal,folderGrant,onText,onTool,workspace) {
  const agent=agents[index], engine=agentEngine(index), text=agentPrompt(index,prompt);
  const response = await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-BB':'1'},
    body:JSON.stringify({engine,text,title:'Ajan · '+agent.name,images:[],filePaths:[],saver:true,folderGrant,workspace}),signal});
  if (!response.ok) throw Error(await response.json().then(data=>data.error).catch(()=>null) || 'Model bağlantısı başarısız.');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = '', output = '';
  try {
    for (;;) {
      const {value,done} = await reader.read();
      if (done) break;
      const lines = (rest+value).split('\n');
      rest = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.t==='error') throw Error(event.msg);
        if (event.t==='delta') {
          output += event.text;
          onText?.(output);
        }
        if (event.t==='tool') onTool?.(event);
      }
    }
  } finally {
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
    usageUpdates.postMessage('refresh');
  }
  if (!output.trim()) throw Error('Model boş bir yanıt döndürdü.');
  return output.trim();
}
async function runWithPermission(index,prompt,request,signal,explicitEdit,speak,onText,onTool,workspace) {
  if (explicitEdit || looksLikeEdit(request)) {
    const grant = await requestFolderAccess(index,request,speak,workspace,signal);
    return askAgent(index,prompt,signal,grant,onText,onTool,workspace);
  }
  const result = await askAgent(index,permissionPrompt(prompt),signal,undefined,text=>{
    if (!permissionMarker.startsWith(text.trim()) && !text.trim().startsWith(permissionMarker)) onText?.(text);
  },onTool,workspace);
  if (result.trim()!==permissionMarker) return result;
  const grant = await requestFolderAccess(index,request,speak,workspace,signal);
  return askAgent(index,prompt,signal,grant,onText,onTool,workspace);
}
function toolActivity(event) {
  const name=String(event.name || '').toLowerCase();
  const detail=String(event.detail || '').toLowerCase();
  if (/calculator|calculate|math|hesap/.test(name) || (/^(komut|bash|shell|exec)$/.test(name) &&
      /\b(?:bc|calc|measure-object|expr)\b|\[math\]::/.test(detail))) return 'Hesap yapıyor';
  if (/search|grep|glob|find|web/.test(name)) return 'Arama yapıyor';
  if (/write|edit|patch|replace/.test(name)) return 'Dosya düzenliyor';
  if (/read|view|list/.test(name)) return 'Dosya okuyor';
  return 'Araç kullanıyor';
}
function voiceActivities(labels=[]) {
  const list=$('voiceActivity');
  list.hidden=!labels.length;
  list.replaceChildren(...labels.map(label=>el('span',label,'voice-activity-chip')));
}
function taskRequest(text) {
  const request=text.trim().replace(/^(?:lütfen|please)[,\s]+/iu,'');
  if (/(?:görev(?:ler)?e (?:kaydet|ekle)|save (?:it |this )?(?:as a task|to tasks))/iu.test(request)) return true;
  if (/^(?:görev(?: oluştur| ata)?|task|assign task)\s*[:：]/iu.test(request)) return true;
  if (/^(?:nasıl|neden|niçin|nedir|ne|hangi|why|how|what|where|when|who)(?:\s|[?!.,]|$)/iu.test(request)) return false;
  return /(?:^|\s)(?:incele|analiz et|araştır|planla|raporla|hazırla|düzelt|uygula|oluştur|güncelle|test et|kontrol et|geliştir)(?:\s|[.!?,]|$)/iu.test(request)
    || /(?:inceleyebilir|araştırabilir|planlayabilir|hazırlayabilir|düzeltebilir|oluşturabilir|yapabilir|yapar) misin[?.!\s]*$/iu.test(request)
    || /^(?:(?:can|could|would) you\s+)?(?:review|analy[sz]e|investigate|plan|prepare|fix|implement|create|update|test|audit|research|build)\s+\S/i.test(request);
}
const saveTaskCommand=/^(?:(?:bunu|onu)\s+)?(?:görev(?:ler)?e (?:kaydet|ekle)|save (?:it |this )?(?:as a task|to tasks))[.!\s]*$/iu;
function queueVoiceTask(index,text,folder,workspace) {
  const request=text.replace(/^(?:görev(?: oluştur| ata)?|task|assign task)\s*[:：]\s*/iu,'')
    .replace(/[,;.!\s]*(?:bunu\s+)?(?:görev(?:ler)?e (?:kaydet|ekle)|save (?:it |this )?(?:as a task|to tasks))[.!\s]*$/iu,'').trim() || text;
  const task={title:request.length>100?request.slice(0,99)+'…':request,role:request,sourceText:text,agent:index,automatic:true,folder,workspace,state:0};
  tasks.push(task);
  save();
  render();
  return task;
}
function budgetReason(reason) {
  return ({
    daily:'Günlük token bütçesi yetersiz',
    request:'İstek token sınırını aşıyor',
    provider:'Sağlayıcının kullanım kotası dolu'
  })[reason] || '';
}
async function taskWorkspace(signal) {
  const response=await fetch('/api/workspace',{signal});
  const {cwd}=response.ok ? await response.json() : {};
  if (!cwd) throw Error('Çalışma klasörü okunamadı.');
  return cwd;
}
async function agentGate(index,prompt,signal,workspace) {
  const response=await fetch('/api/preflight',{method:'POST',headers:{'Content-Type':'application/json','X-BB':'1'},
    body:JSON.stringify({engine:agentEngine(index),text:agentPrompt(index,prompt),workspace}),signal});
  if (response.status===409) throw Error('Bu görev için kayıtlı çalışma klasörünü aç.');
  if (!response.ok) throw Error('Token kontrolü yapılamadı.');
  return response.json();
}
async function taskAccounts(signal) {
  const response=await fetch('/api/status',{signal});
  if (!response.ok) throw Error('Hesap durumları kontrol edilemedi.');
  return response.json();
}
function namedAgent(text) {
  const normalized=text.toLocaleLowerCase('tr').replace(/[’']/g,'');
  return activeAgents().find(({agent})=>{
    const name=agent.name.toLocaleLowerCase('tr').replace(/[’']/g,'');
    const word=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp('(?<![\\p{L}\\p{N}])'+word+'(?:yla|yle|la|le|ya|ye|a|e|yı|yi|yu|yü|ı|i|u|ü)?(?![\\p{L}\\p{N}])','u').test(normalized);
  })?.index;
}
function newExchange(topic,meeting=false) {
  return {exchange:crypto.randomUUID(),topic:topic.slice(0,300),meeting};
}
async function recruitAgent(text,signal) {
  if (activeAgents().length>=10 || agents.length>=200) throw Error('Ajan sınırına ulaşıldı.');
  const workspace=await taskWorkspace(signal), accounts=await taskAccounts(signal);
  const checks=await Promise.all(templates.map(async template=>{
    const engine=engines[template.model], account=accounts[engine];
    if (!account?.found || !account.loggedIn) return null;
    const response=await fetch('/api/preflight',{method:'POST',headers:{'Content-Type':'application/json','X-BB':'1'},
      body:JSON.stringify({engine,workspace,text:'Typical agent task: '+text}),signal});
    if (!response.ok) return null;
    const gate=await response.json();
    if (!gate.ok) return null;
    return {template,spare:gate.remaining ?? -1,estimate:gate.estimate.total};
  }));
  const choice=checks.filter(Boolean).sort((a,b)=>b.spare-a.spare||a.estimate-b.estimate)[0];
  if (!choice) throw Error('İşe alım için bütçesi uygun bağlı sağlayıcı bulunamadı.');
  signal.throwIfAborted();
  if (activeAgents().length>=10 || agents.length>=200) throw Error('Ajan sınırına ulaşıldı.');
  if (await taskWorkspace(signal)!==workspace) throw Error('Çalışma klasörü değişti. İzin isteğini yeniden aç.');
  const role=text.replace(/^(?:lütfen|please)[,\s]+/iu,'')
    .replace(/(?:yeni bir|yeni|bir)\s+/iu,'').replace(/\s*(?:işe al|işe alır mısın|hire|recruit)\s*/iu,' ').trim()
    .replace(/[.!?]+$/u,'').trim();
  const professionName=role && !/^(?:ajan|agent)$/iu.test(role)?role.slice(0,80):choice.template.profession;
  const name=names.find(candidate=>!activeAgents().some(({agent})=>agent.name===candidate)) || 'Ajan '+(agents.length+1);
  const agent={...choice.template,name,profession:professionName,role:'',voice:['Ada','Mira','Luna','Arya','Nova'].includes(name)?'feminine':'masculine'};
  agents.push(agent); save(); drawDesks(); render();
  return agent;
}
function addExchangeTurn(thread,agent,body) {
  messages.push({...thread,agent,body});
  save(); render();
}
async function discussionTurn(index,prompt,signal,workspace) {
  if (!isActive(index) || !(await agentGate(index,prompt,signal,workspace)).ok) return null;
  return askAgent(index,prompt,signal,undefined,undefined,undefined,workspace);
}
async function teamConversation(owner,peers,topic,signal,{meeting=false,onTurn,onStatus}={}) {
  const run=async()=>{
    const workspace=await taskWorkspace(signal), accounts=await taskAccounts(signal);
    const thread=newExchange(topic,meeting);
    const turns=[];
    const contribute=async(index,prompt)=>{
      if (!accountReady(accounts,index)) return;
      onStatus?.(index);
      if (index!==owner) announceWork(index,true);
      try {
        const body=await discussionTurn(index,prompt,signal,workspace);
        if (body) {
          turns.push({index,body});
          addExchangeTurn(thread,index,body);
          onTurn?.(index,body);
        }
      } finally { if (index!==owner) announceWork(index,false); }
    };
    const context=()=>turns.map(({index,body})=>agents[index].name+': '+body.slice(0,1200)).join('\n');
    if (!meeting) await contribute(owner,'Ekip arkadaşın '+agents[peers[0]].name+' ile görüşmeyi başlat. Kullanıcının isteğine göre ona doğrudan kısa bir soru sor. Dosya değiştirme.\n'+topic);
    for (const index of peers) {
      try {
        await contribute(index,'Ekip görüşmesine katkı ver. Önceki konuşmacıların söylediklerine doğrudan yanıt ver, yeni bir gözlem ekle. Kullanıcının dilinde en fazla üç kısa cümle yaz. Dosya değiştirme.\nKonu: '+topic+'\nÖnceki mesajlar:\n'+context());
      } catch (error) { if (signal.aborted) throw error; }
    }
    const contributions=turns.filter(turn=>meeting || turn.index!==owner);
    if (!contributions.length) throw Error('Katılabilecek ekip arkadaşı bulunamadı.');
    try {
      await contribute(owner,'Kullanıcı için ekip görüşmesini özetle. Görüş birliğini, ayrışan noktaları ve önerilen sonraki adımı kısa yaz. Dosya değiştirme.\nKonu: '+topic+'\nGörüşme:\n'+context());
    } catch (error) { if (signal.aborted) throw error; }
    return turns;
  };
  return navigator.locks ? navigator.locks.request('kopbri-task-workflow',{signal},run) : run();
}
async function mailOverview() {
  const mailboxes=await desktop?.mail?.(null,'overview');
  const english=window.kopbriLanguage?.()==='en';
  if (!mailboxes?.length) return english?'Connect a mailbox in Settings, sir.':'Önce Ayarlar’dan bir posta kutusu bağla, efendim.';
  const names={gmail:'Gmail',outlook:'Outlook',imap:'IMAP'};
  return (english?'Here are the unread messages, sir.':'Okunmamış iletileri kontrol ettim, efendim.')+'\n\n'+mailboxes.map(box=>{
    const label=names[box.provider]+': ';
    if (box.error)return label+(english?'could not check this account.':'hesap kontrol edilemedi.');
    if (!box.messages.length)return label+(english?'no unread messages.':'okunmamış ileti yok.');
    return label+'\n'+box.messages.slice(0,5).map(item=>'• '+(item.subject || (english?'No subject':'Konu yok'))).join('\n');
  }).join('\n\n');
}
async function draftMail(index,request,signal) {
  if (!desktop?.mail) throw Error('E-posta bağlantısı masaüstü uygulamasında kullanılabilir.');
  const text=await askAgent(index,'Kullanıcının isteğine göre yalnızca e-posta taslağı yaz. İsteğin dilinde yanıt ver. Hiçbir işlem yapma, dosya değiştirme ve e-posta gönderme. İlk satıra konuyu, boş satırdan sonra gövdeyi yaz.\n\n'+request,signal);
  const [subject,...rest]=text.split('\n');
  const to=request.match(/[a-z0-9.!#$%&'*+\-/=?^_{}|~]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || '';
  await desktop.mail(null,'draft',{to,subject:subject.replace(/^(?:konu|subject)\s*:\s*/i,'').slice(0,180),body:rest.join('\n').trim() || text});
  return window.kopbriLanguage?.()==='en'?'The email draft is ready to edit and approve, sir.':'E-posta taslağı düzenleme ve onayın için hazır, efendim.';
}
function accountReady(accounts,index) {
  const account=accounts[agentEngine(index)];
  return account?.found && account.loggedIn;
}
async function chooseExecutor(task,prompt,signal,getAccounts) {
  const owner=task.agent;
  const gate=await agentGate(owner,prompt,signal,task.workspace);
  if (gate.ok) return {index:owner};
  if (task.autoRoute!==false && ['daily','request','provider'].includes(gate.reason)) {
    const accounts=await getAccounts();
    const candidates=activeAgents().filter(({index})=>{
      const engine=agentEngine(index);
      return engine && engine!==agentEngine(owner) && accountReady(accounts,index);
    });
    const options=await Promise.all(candidates.map(async ({agent,index})=>{
      const check=await agentGate(index,prompt,signal,task.workspace);
      const spare=check.remaining==null ? -1 : check.remaining-check.estimate.total-check.policy.outputTarget;
      return {index,check,spare,sameProfession:profession(agent).toLocaleLowerCase('tr')===profession(agents[owner]).toLocaleLowerCase('tr')};
    }));
    const next=options.filter(option=>option.check.ok).sort((a,b)=>Number(b.sameProfession)-Number(a.sameProfession)||b.spare-a.spare)[0];
    if (next) return {index:next.index,reason:gate.reason,remaining:next.check.remaining};
  }
  const explanation=budgetReason(gate.reason) || 'Token kontrolü yapılamadı.';
  throw Error(window.kopbriTranslate?.(explanation) || explanation);
}
function runTask(task,options={}) {
  const run=()=>executeTask(task,options);
  const lockOptions=options.signal ? {signal:options.signal} : {ifAvailable:true};
  return navigator.locks ? navigator.locks.request('kopbri-task-workflow',lockOptions,lock=>lock ? run() : undefined) : run();
}
async function executeTask(task,{signal,speak=false,onText,onTool,onStage,onExecutor}={}) {
  if (runningTask || task.state!==0 || !isActive(task.agent)) return;
  runningTask = true; task.state = 1; task.error = ''; render();
  const stage=phase=>{task.phase=phase;save();render();onStage?.(phase);};
  try {
    const workspace=await taskWorkspace(signal);
    if (task.workspace && task.workspace!==workspace) throw Error('Bu görev için kayıtlı çalışma klasörünü aç.');
    task.workspace=workspace;
    let accountsRequest;
    const getAccounts=()=>accountsRequest ??= taskAccounts(signal);
    if (!task.result) {
      task.executor=null;
      task.routeReason=null;
      task.routeRemaining=null;
      signal?.throwIfAborted();
      if ((task.automatic || task.team) && !task.plan) {
        task.analyst=null;
        const planning='Sorumlu ajan '+agents[task.agent].name+' için bu görevi planla. İsteğin dilinde kısa adımlar, doğrulama ölçütleri ve açık soruları yaz. Yalnızca analiz yap. Dosya değiştirme ve görevi uygulama.\n\n'+task.role;
        for (const {agent,index} of activeAgents()) {
          if (index===task.agent || !/analist|analyst/i.test(profession(agent)+' '+(agent.role || ''))) continue;
          if (!(await agentGate(index,planning,signal,workspace)).ok) continue;
          if (!accountReady(await getAccounts(),index)) continue;
          task.analyst=index;
          task.discussion ??= newExchange(task.title);
          stage('Analist planlıyor');
          announceWork(index,true);
          try {
            let opening;
            if (accountReady(await getAccounts(),task.agent)) {
              try {
                opening=await discussionTurn(task.agent,'Ekip arkadaşın '+agent.name+' ile görevi planlamak için görüşme başlat. Ona doğrudan tek kısa soru sor. Dosya değiştirme.\n'+task.role,signal,workspace);
              } catch (error) { if(signal?.aborted) throw error; }
              if(opening)addExchangeTurn(task.discussion,task.agent,opening);
            }
            task.plan=await askAgent(index,planning+(opening?'\n\nEkip arkadaşının mesajı: '+opening.slice(0,1200):''),signal,undefined,undefined,undefined,workspace);
            addExchangeTurn(task.discussion,index,task.plan);
          } finally { announceWork(index,false); }
          break;
        }
      }
      const prompt = 'Görev: '+task.title+'\nTalimat: '+task.role+
        (task.plan?'\n\nAnalistin önerdiği plan (yardımcı bağlam):\n'+task.plan.slice(0,9000):'');
      stage('Token bütçesi kontrol ediliyor');
      const routing=await chooseExecutor(task,task.folder || looksLikeEdit(task.role) ? prompt : permissionPrompt(prompt),signal,getAccounts);
      if (!isActive(routing.index)) throw Error('Ajan silindi');
      task.executor=routing.index;
      task.routeReason=routing.reason || null;
      task.routeRemaining=routing.remaining ?? null;
      onExecutor?.(task.executor);
      stage(task.executor===task.agent?'Sorumlu ajan uyguluyor':'Devralan ajan uyguluyor');
      if (task.executor!==task.agent) announceWork(task.executor,true);
      try { task.result = await runWithPermission(task.executor,prompt,task.role,signal,task.folder,speak,onText,onTool,workspace); }
      finally { if (task.executor!==task.agent) announceWork(task.executor,false); }
      if (task.discussion) addExchangeTurn(task.discussion,task.executor,task.result);
      else messages.push({agent:task.executor,body:task.result});
      save(); render();
    }
    if (task.team) {
      task.reviewed ??= [];
      stage('Ekip geri bildirim veriyor');
      const executor=task.executor ?? task.agent;
      const peers = activeAgents().map(({index})=>index).filter(i=>i!==executor).slice(0,2);
      for (const i of peers.filter(i=>!task.reviewed.includes(i))) {
        const review='Görev: '+task.title+'\n'+agents[executor].name+' adlı ajanın yanıtını değerlendir ve ona kısa geri bildirim ver.\n\n'+task.result.slice(0,12000);
        if (!(await agentGate(i,review,signal,workspace)).ok) continue;
        if (!accountReady(await getAccounts(),i)) continue;
        const feedback = await askAgent(i,review,signal,undefined,undefined,undefined,workspace);
        messages.push({agent:i,body:feedback}); task.reviewed.push(i); save(); render();
      }
    }
    task.state = 2;
    return task.result;
  } catch (error) {
    task.state = 0; task.error = error.message;
    if (speak) throw error;
  } finally { task.phase=''; runningTask = false; save(); render(); }
}
let recorder, micStream, voiceRun, transcription, recordingTimer;
let microphoneGeneration = 0;
let holdReleased = false;
let holdActive = false;
let shortcutRecording = false;
let playback, playbackUrl, playbackFetch;
let streamingVoice;
function voiceProfile(index) {
  const agent = agents[index];
  return agent.voice ?? (['Ada','Mira','Luna','Arya','Nova'].includes(agent.name)?'feminine':'masculine');
}
function paintVoiceThread(index) {
  const history = $('voiceThread');
  const items = voiceThreads[index] ?? [];
  const agent=agents[index];
  if (!agent) {
    history.replaceChildren(el('p','Bu görüşmeye başlamak için bir ajan ekle.','voice-empty'));
    $('voiceAgentName').textContent='Ajan seçilmedi';
    $('voiceAgentModel').textContent='';
    $('voiceProfile').textContent='';
    $('voiceAvatar').textContent='＋';
    return;
  }
  history.replaceChildren(...items.map(item => {
    const row = el('div',null,'voice-turn '+(item.side==='user'?'mine':'theirs'));
    row.append(el('strong',item.side==='user'?(window.kopbriTranslate?.('Sen') || 'Sen'):(agents[item.author]?.name || agent.name)),el('p',item.text));
    return row;
  }));
  if (!items.length) history.append(el('p','İlk mesajını yaz veya konuşmaya başla.','voice-empty'));
  $('voiceProfile').textContent = voiceProfile(index)==='feminine'?'Kadın sesi':'Erkek sesi';
  $('voiceAgentName').textContent = agents[index].name;
  $('voiceAgentModel').textContent = (agents[index].model ?? agents[index].name)+' · '+profession(agents[index]);
  const avatar = $('voiceAvatar');
  avatar.textContent = agents[index].glyph;
  avatar.style.setProperty('--tone',agents[index].color);
  $('voiceTimeline').scrollTop = $('voiceTimeline').scrollHeight;
  requestAnimationFrame(()=>{ $('voiceTimeline').scrollTop = $('voiceTimeline').scrollHeight; });
}
function addVoiceTurn(index,side,text,author=index) {
  const thread = voiceThreads[index] ??= [];
  thread.push({side,text:text.slice(0,4500),...(side==='agent' && author!==index ? {author} : {})});
  if (thread.length>80) thread.splice(0,thread.length-80);
  save();
  if (Number($('voiceForm').elements.agent.value)===index) paintVoiceThread(index);
}
function stopPlayback() {
  streamingVoice?.stop(); streamingVoice = null;
  playbackFetch?.abort(); playbackFetch = null;
  playback?.pause(); playback = null;
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl = null;
  speechSynthesis.cancel();
}
function makeStreamingVoice(index,preferredLanguage) {
  const name = agents[index].name;
  const profile = voiceProfile(index);
  const controller = new AbortController();
  let done = Promise.resolve(), offset = 0, current, language=preferredLanguage;
  function enqueue(text) {
    const plain = text.replace(/```[\s\S]*?```/g,' Kod örneği ekranda. ').replace(/[*#`]/g,'').trim();
    if (!plain) return;
    language ??= /\bsir\b/i.test(plain) ? 'en' : 'tr';
    if (!current) $('voiceStatus').textContent = name+' sesli yanıtı hazırlıyor…';
    const wav = fetch('/api/speak',{method:'POST',headers:{'Content-Type':'application/json','X-BB':'1'},
      body:JSON.stringify({text:plain.slice(0,1000),profile,language}),signal:controller.signal})
      .then(response => response.ok ? response.blob() : null).catch(()=>null);
    done = done.then(async () => {
      const blob = await wav;
      if (controller.signal.aborted) return;
      if (!blob) { $('voiceStatus').textContent = 'Seslendirme kullanılamadı. Yanıt ekranda.'; return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      current = audio;
      $('voiceStatus').textContent = name+' konuşuyor…';
      try {
        await new Promise((resolve,reject) => {
          function end() {
            audio.pause();
            controller.signal.removeEventListener('abort',end);
            resolve();
          }
          audio.onended = end;
          audio.onerror = end;
          controller.signal.addEventListener('abort',end,{once:true});
          audio.play().catch(error=>{controller.signal.removeEventListener('abort',end);reject(error);});
        });
      } catch {
        if (!controller.signal.aborted) $('voiceStatus').textContent = 'Ses oynatılamadı. Yanıt ekranda.';
      } finally { current=null; URL.revokeObjectURL(url); }
    });
  }
  return {
    append(full,final=false) {
      if (controller.signal.aborted) return;
      let rest=full.slice(offset);
      while (rest) {
        const sentence = rest.match(/^[\s\S]*?[.!?…](?:\s+|$)/);
        const length = sentence?.[0].trim().length>=4 ? sentence[0].length :
          rest.length>=180 ? Math.max(rest.lastIndexOf(' ',165),100) : final ? rest.length : 0;
        if (!length) break;
        enqueue(rest.slice(0,length));
        offset += length; rest = rest.slice(length);
      }
      if (final) done.then(()=>{
        if (!controller.signal.aborted && $('voiceDialog').open) $('voiceStatus').textContent=name+' · Konuşmak için kısayolu basılı tut.';
      });
      return done;
    },
    stop() { controller.abort(); current?.pause(); }
  };
}
async function playTeamTurns(turns) {
  stopPlayback();
  let stopped=false, current;
  const queue={stop(){stopped=true;current?.stop();}};
  streamingVoice=queue;
  try {
    for (const {index,body} of turns) {
      if (stopped || !$('voiceDialog').open) break;
      current=makeStreamingVoice(index,window.kopbriLanguage?.());
      await current.append(body,true);
    }
  } finally { if (streamingVoice===queue) streamingVoice=null; }
}
async function playReply(reply,name) {
  stopPlayback();
  const request = new AbortController();
  playbackFetch = request;
  $('voiceStatus').textContent = name+' sesli yanıtı hazırlıyor…';
  const index = agents.findIndex(agent=>!agent.archived && agent.name===name);
  const profile = index>=0 ? voiceProfile(index) : 'masculine';
  const language = /\bsir\b/i.test(reply) ? 'en' : 'tr';
  try {
    const plain = reply.replace(/```[\s\S]*?```/g,' Kod örneği ekranda. ').replace(/[*#`]/g,'').trim();
    const response = await fetch('/api/speak',{method:'POST',headers:{'Content-Type':'application/json','X-BB':'1'},
      body:JSON.stringify({text:plain.slice(0,2200),profile,language}),signal:request.signal});
    if (!response.ok) throw Error('Seslendirme kullanılamadı.');
    const blob = await response.blob();
    if (request.signal.aborted) return;
    playbackUrl = URL.createObjectURL(blob);
    playback = new Audio(playbackUrl);
    $('voiceStatus').textContent = name+' konuşuyor…';
    playback.onended = () => {
      stopPlayback();
      if ($('voiceDialog').open) $('voiceStatus').textContent = name+' · Konuşmak için kısayolu basılı tut.';
    };
    await playback.play();
  } catch {
    if (request.signal.aborted) return;
    const voice = speechSynthesis.getVoices().find(item=>item.lang.toLowerCase().startsWith(language) &&
      (profile!=='feminine' || /emel|female|kadın/i.test(item.name)));
    if (!voice) { $('voiceStatus').textContent = 'Seslendirme kullanılamadı. Yanıt aşağıda yazılı.'; return; }
    const utterance = new SpeechSynthesisUtterance(reply);
    $('voiceStatus').textContent = name+' konuşuyor…';
    utterance.voice = voice;
    utterance.onend = () => { $('voiceStatus').textContent = name; };
    speechSynthesis.speak(utterance);
  } finally { if (playbackFetch===request) playbackFetch = null; }
}
function refreshVoiceAgent(preferred=voiceAgentIndex ?? selected) {
  const form = $('voiceForm');
  const active=activeAgents(), index=isActive(preferred)?preferred:active[0]?.index ?? -1;
  form.elements.agent.replaceChildren(...active.map(({agent,index})=>new Option(agent.name+' · '+profession(agent),index)));
  if(index>=0)form.elements.agent.value=index;
  voiceAgentIndex=index;
  $('voiceMic').disabled=index<0;
  form.querySelector('button[type="submit"]').disabled=index<0;
  $('voiceAddAgent').hidden=index>=0;
  paintVoiceThread(index);
  return index;
}
function setMeetingMode(enabled) {
  meetingMode=enabled;
  const button=$('voiceMeeting');
  button.setAttribute('aria-pressed',String(enabled));
  button.textContent=enabled?'Toplantıyı bitir':'Toplantı başlat';
  $('voiceStatus').textContent=enabled?'Toplantı konusu ne?':'Bir ajan seç veya adıyla seslen.';
  $('voiceForm').elements.prompt.focus();
}
$('voiceMeeting').onclick=()=>{if(!voiceRun)setMeetingMode(!meetingMode);};
function voiceDialog(preferred) {
  if ($('voiceDialog').open) {
    if(isActive(preferred) && !recorder && !transcription && !voiceRun)refreshVoiceAgent(preferred);
    return;
  }
  const index=refreshVoiceAgent(preferred);
  voiceActivities();
  $('voiceStatus').textContent = index<0?'Görüşmeye başlamak için bir ajan ekle.':'Bir ajan seç veya adıyla seslen.';
  $('voiceReply').textContent = '';
  $('voiceReplyCard').hidden = true;
  if (index>=0 && voiceProfile(index)==='feminine') {
    fetch('/api/voice-ready',{method:'POST',headers:{'X-BB':'1'}}).catch(()=>{});
  }
  voiceIndicators('Hazır','Mikrofon kapalı');
  $('voiceDialog').showModal();
  if (agents[index]?.recruiter && !voiceThreads[index]?.length) {
    const greeting=window.kopbriLanguage?.()==='en'
      ? 'Hello, sir. I’m İpek from HR. Tell me what kind of teammate you need.'
      : 'Merhaba efendim, ben insan kaynaklarından İpek. Ekibine hangi rolde bir ajan almak istediğini söyleyebilirsin.';
    addVoiceTurn(index,'agent',greeting);
    playReply(greeting,agents[index].name);
  }
}
function voiceIndicators(key,mic,active=false,level=0) {
  $('voiceKeyState').textContent = key;
  $('voiceMicState').textContent = mic;
  $('voiceMicState').dataset.active = String(active);
  $('voiceMeter').value = level;
}
$('voiceClose').onclick = () => $('voiceDialog').close();
$('voiceAddAgent').onclick = () => openAgentEditor();
$('voiceForm').elements.prompt.addEventListener('keydown',event => {
  if (event.key==='Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); $('voiceForm').requestSubmit();
  }
});
$('voiceForm').elements.agent.onchange = event => {
  voiceAgentIndex = Number(event.target.value);
  $('voiceReplyCard').hidden = true;
  paintVoiceThread(voiceAgentIndex);
};
$('voiceDialog').onclose = () => {
  if(meetingMode)setMeetingMode(false);
  microphoneGeneration++;
  if (holdActive) document.dispatchEvent(new Event('kopbri-release-voice'));
  holdActive = false;
  if (recorder?.state==='recording') recorder.stop();
  micStream?.getTracks().forEach(track=>track.stop());
  transcription?.abort(); voiceRun?.abort(); stopPlayback();
};
function normalizeSpoken(text) {
  return text
    .replace(/\b(şu an(?:da)?\s+)?hangi klasör(?:ü\s+de|de)\s+çalışıyorsun\b/giu,
      (_,start) => (start || '')+'hangi klasörde çalışıyorsun')
    .replace(/\bgit[ -]?(?:hub|hab|hap)\b/giu,'GitHub')
    .replace(/(?<![\p{L}\p{N}])kop[\s-]*(?:bri|biri)(?=$|[^\p{L}\p{N}])/giu,'kopbri');
}
function asksWorkspace(text) {
  return /^(?:şu an(?:da)?\s+)?(?:hangi (?:klasör|dizin)de çalışıyorsun|çalışma klasörün (?:ne|nerede)|nerede çalışıyorsun)[\s?.!]*$/i.test(text);
}
const asksWorkspaceInEnglish = text => /^(?:what|which) (?:folder|directory) (?:are you working in|are you in)[\s?.!]*$|^where are you working[\s?.!]*$/i.test(text);
function useTranscript(transcript) {
    const form = $('voiceForm');
    let text = normalizeSpoken(transcript.trim());
    const addressed = text.replace(/^(?:hey|merhaba|selam)[\s,]+(?=\p{L})/iu,'');
    const lower = addressed.toLocaleLowerCase('tr');
    const index = agents.findIndex(agent => {
      if(agent.archived)return false;
      const name = agent.name.toLocaleLowerCase('tr');
      return lower.startsWith(name) && /[\s,.:!?]/.test(lower[name.length] || ' ');
    });
    if (index >= 0) {
      voiceAgentIndex = index; form.elements.agent.value = index;
      paintVoiceThread(index);
      text = addressed.slice(agents[index].name.length).replace(/^[\s,.:!?]+/,'');
    }
    form.elements.prompt.value = text;
    $('voiceStatus').textContent = text ? 'Mesajı kontrol edip gönder.' : index>=0 ? agents[index].name+' seçildi. Şimdi konuşabilirsin.' : 'Konuşma algılanmadı. Tekrar deneyebilirsin.';
}
function toWave(chunks,rate) {
  const samples = new Float32Array(chunks.reduce((length,chunk)=>length+chunk.length,0));
  let offset = 0;
  for (const chunk of chunks) { samples.set(chunk,offset); offset += chunk.length; }
  const wave = new ArrayBuffer(44+samples.length*2), data = new DataView(wave);
  for (const [offset,word] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']]) {
    for (let i=0;i<4;i++) data.setUint8(offset+i,word.charCodeAt(i));
  }
  data.setUint32(4,wave.byteLength-8,true); data.setUint32(16,16,true);
  data.setUint16(20,1,true); data.setUint16(22,1,true); data.setUint32(24,rate,true);
  data.setUint32(28,rate*2,true); data.setUint16(32,2,true); data.setUint16(34,16,true);
  data.setUint32(40,samples.length*2,true);
  for (let i=0;i<samples.length;i++) data.setInt16(44+i*2,Math.max(-1,Math.min(1,samples[i]))*32767,true);
  return wave;
}
async function transcribe(chunks,rate,signal,partial=false,accurate=false) {
  const query = new URLSearchParams({partial:partial?'1':'0',quality:accurate?'accurate':'fast',language:window.kopbriLanguage?.() || 'tr',names:['kopbri',...activeAgents().map(({agent})=>agent.name)].join(', ')});
  const response = await fetch('/api/transcribe?'+query,{method:'POST',
    headers:{'Content-Type':'audio/wav','X-BB':'1'},body:toWave(chunks,rate),signal});
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data.text;
}
async function liveDiction(action,id,chunk) {
  const query = new URLSearchParams({action,id:id || ''});
  if(action==='start')query.set('names',activeAgents().map(({agent})=>agent.name).join(','));
  const body = chunk && Int16Array.from(chunk,sample=>Math.round(Math.max(-1,Math.min(1,sample))*32767));
  const response = await fetch('/api/live-dictation?'+query,{method:'POST',headers:{'X-BB':'1'},body});
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
$('voiceMic').onclick = () => beginRecording(false);
async function beginRecording(autoSend) {
  if (!activeAgents().length)return;
  if (recorder?.state==='recording') { recorder.stop(); return; }
  if (transcription || micStream) return;
  const generation = ++microphoneGeneration;
  shortcutRecording = autoSend;
  stopPlayback();
  if (autoSend && !awaitingApproval?.speak) voiceRun?.abort();
  const button = $('voiceMic');
  button.disabled = true;
  let audio;
  voiceIndicators(autoSend?'Kısayol basılı':'Elle kayıt','Mikrofon açılıyor…');
  $('voiceStatus').textContent = 'Mikrofon bağlanıyor…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    if (generation!==microphoneGeneration || (autoSend && holdReleased)) {
      stream.getTracks().forEach(track=>track.stop());
      if (generation===microphoneGeneration) {
        voiceIndicators('Kısayol bırakıldı','Mikrofon kapalı');
        $('voiceStatus').textContent = 'Mikrofon açılana kadar kısayolu basılı tut.';
      }
      return;
    }
    micStream = stream;
    audio = new AudioContext({sampleRate:16000});
    await audio.audioWorklet.addModule('/voice-capture.js');
    await audio.resume();
    if (generation!==microphoneGeneration || (autoSend && holdReleased)) {
      stream.getTracks().forEach(track=>track.stop()); micStream = null; await audio.close();
      if (generation===microphoneGeneration) {
        voiceIndicators('Kısayol bırakıldı','Mikrofon kapalı');
        $('voiceStatus').textContent = 'Mikrofon açılana kadar kısayolu basılı tut.';
      }
      return;
    }
    const source = audio.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(audio,'kopbri-voice');
    const mute = audio.createGain(); mute.gain.value = 0;
    source.connect(capture).connect(mute).connect(audio.destination);
    const chunks = [];
    let partial, interval, flushTimer, lastSampleCount = 0, stopping = false, finished = false, samples = 0, audible = false;
    const englishDictation=window.kopbriLanguage?.()==='en';
    let caption = '', corrected = '', correctedAt = 0, voicedAt = 0, liveHealthy = !englishDictation, pendingDraft, draftSamples = 0;
    let liveEngine = '';
    const liveSession = englishDictation ? Promise.resolve(null) : liveDiction('start').then(value=>{liveEngine=value.engine;return value.id;}).catch(()=>{liveHealthy=false;return null;});
    let pipe = Promise.resolve();
    function showDraft(text) {
      if (!text || stopping || generation!==microphoneGeneration) return;
      const draft = normalizeSpoken(text);
      if (awaitingApproval?.speak) $('folderHint').textContent = draft;
      else {
        const field=$('voiceForm').elements.prompt;
        field.value=draft; field.scrollTop=field.scrollHeight;
      }
    }
    const append = chunk => {
      if (!chunk.length) return;
      chunks.push(chunk); samples += chunk.length;
      let energy = 0;
      for (const sample of chunk) energy += sample*sample;
      const rms = Math.sqrt(energy/chunk.length);
      audible ||= rms>.003;
      if (rms>.003) voicedAt = samples;
      const captured = samples;
      if (liveHealthy) pipe = pipe.then(async () => {
        const id = await liveSession;
        if (!id || generation!==microphoneGeneration) return;
        const {text} = await liveDiction('audio',id,chunk);
        if (text) caption = text;
        if (captured>correctedAt+audio.sampleRate*.45) showDraft(text);
      }).catch(()=>{liveHealthy=false;});
      if (!stopping) voiceIndicators(autoSend?'Kısayol basılı':'Elle kayıt',rms>.003?'Ses algılanıyor':'Mikrofon açık',true,Math.min(100,Math.round(rms*900)));
    };
    capture.port.onmessage = event => {
      if (event.data.tail) { append(event.data.tail); finish(); }
      else append(event.data);
    };
    function updateLiveText() {
      if (liveEngine==='ufakzeka' && liveHealthy) return;
      const minimum = audio.sampleRate*(lastSampleCount ? .8 : 1.1);
      if (partial || stopping || !audible || samples-lastSampleCount<minimum || generation!==microphoneGeneration) return;
      lastSampleCount = samples;
      const controller = new AbortController();
      partial = controller;
      const captured = samples;
      draftSamples = captured;
      pendingDraft = transcribe(chunks,audio.sampleRate,controller.signal,true,captured>=audio.sampleRate*1.7).then(text=>{
        if (text) {
          corrected = text;
          correctedAt = captured;
          if (samples-captured<audio.sampleRate*1.6 || !liveHealthy) showDraft(text);
        }
      }).catch(()=>{}).finally(()=>{partial=null;});
    }
    async function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(flushTimer);
      clearTimeout(recordingTimer); stream.getTracks().forEach(track=>track.stop());
      await audio.close().catch(()=>{});
      micStream = null; recorder = null; button.textContent = '◉ Mikrofon';
      if (generation!==microphoneGeneration) {
        partial?.abort();
        liveSession.then(id=>id&&liveDiction('cancel',id)).catch(()=>{});
        return;
      }
      voiceIndicators(autoSend?'Kısayol bırakıldı':'Kayıt bitti','Mikrofon kapalı');
      if (!audible || samples<audio.sampleRate*.32) {
        partial?.abort();
        liveSession.then(id=>id&&liveDiction('cancel',id)).catch(()=>{});
        $('voiceStatus').textContent = 'Ses yakalanmadı. Mikrofon açıkken konuş ve bitirince bırak.';
        return;
      }
      const controller = new AbortController();
      transcription = controller; button.disabled = true;
      $('voiceStatus').textContent = 'Kayıt tamamlandı.';
      try {
        if (!chunks.length) { useTranscript(''); return; }
        const id = await liveSession;
        await pipe;
        let finalLive = '';
        if (id) finalLive = await liveDiction('finish',id).then(value=>value.text).catch(()=>'');
        if (partial && draftSamples>=voicedAt-audio.sampleRate*.3) {
          await Promise.race([pendingDraft,new Promise(resolve=>setTimeout(resolve,750))]);
        }
        partial?.abort();
        const text = corrected && correctedAt>=voicedAt-audio.sampleRate*.23 ? corrected : englishDictation
          ? await transcribe(chunks,audio.sampleRate,controller.signal,false,true) : finalLive || caption || corrected;
        if (generation===microphoneGeneration) {
          if (awaitingApproval?.speak) { handleSpokenApproval(text); return; }
          useTranscript(text);
          if (autoSend && $('voiceForm').elements.prompt.value.trim()) $('voiceForm').requestSubmit();
        }
      } catch (error) {
        if (generation===microphoneGeneration) $('voiceStatus').textContent = (error.message || 'Ses yazıya çevrilemedi.')+' Windows sesle yazmayı açmak için mesaj alanında Win+H tuşlarına basabilirsin.';
      } finally { transcription = null; button.disabled = false; }
    }
    recorder = {state:'recording',stop() {
      if (stopping) return;
      stopping = true; this.state = 'inactive';
      clearInterval(interval);
      capture.port.postMessage('flush');
      flushTimer = setTimeout(finish,175);
    }};
    $('voiceForm').elements.prompt.value = '';
    interval = setInterval(updateLiveText,650);
    button.textContent = '■ Bitir';
    voiceIndicators(autoSend?'Kısayol basılı':'Elle kayıt','Mikrofon açık',true);
    $('voiceStatus').textContent = autoSend ? 'Dinliyorum. Sözlerin aşağıya yazılıyor.' : 'Dinliyorum. Konuşman bittiğinde Bitir’e bas.';
    recordingTimer = setTimeout(() => {
      if (holdActive) { holdActive = false; document.dispatchEvent(new Event('kopbri-release-voice')); }
      if (recorder?.state==='recording') recorder.stop();
    },25000);
  } catch (error) {
    micStream?.getTracks().forEach(track=>track.stop()); micStream = null; recorder = null;
    if (audio && audio.state!=='closed') await audio.close().catch(()=>{});
    voiceIndicators('Hazır','Mikrofon kapalı');
    $('voiceStatus').textContent = 'Mikrofon açılamadı ('+error.name+'). Windows mikrofon izinlerini kontrol et veya mesaj alanında Win+H kullan.';
  } finally { button.disabled = false; }
}
$('voiceForm').onsubmit = async event => {
  event.preventDefault();
  if (voiceRun) return;
  const form = event.target, text = normalizeSpoken(form.elements.prompt.value.trim()), index = Number(form.elements.agent.value);
  if (!text || !isActive(index)) return;
  const target=namedAgent(text);
  if (target!=null && /(?:konuş(?:acağım|acam|acağpım|mak istiyorum|abilir miyim)|görüş(?:eceğim|mek istiyorum)|(?:talk|speak) (?:to|with)|(?:çağır|getir)\b)/iu.test(text)) {
    form.elements.prompt.value='';
    if (meetingMode)setMeetingMode(false);
    stopPlayback();
    refreshVoiceAgent(target);
    $('voiceStatus').textContent=agents[target].name+' görüşmeye hazır.';
    return;
  }
  const meetingCommand=/^(?:toplantı(?:yı)? (?:başlat|aç)|(?:start|open) (?:a |the )?meeting)[.!\s]*$/iu;
  const endMeeting=/^(?:toplantı(?:yı)? (?:bitir|kapat)|(?:end|close) (?:the )?meeting)[.!\s]*$/iu;
  if (meetingCommand.test(text) || endMeeting.test(text)) {
    form.elements.prompt.value='';
    stopPlayback();
    setMeetingMode(!endMeeting.test(text));
    return;
  }
  voiceAgentIndex = index;
  voiceRun = new AbortController();
  const signal = voiceRun.signal;
  const replyCard = $('voiceReplyCard');
  const replyText = $('voiceReply');
  let speaker, responder=index;
  const actions=new Set();
  const onTool=event=>{
    actions.add(toolActivity(event));
    voiceActivities([replyCard.hidden?'Düşünüyor':'Yanıt hazırlıyor',...[...actions].slice(-3)]);
  };
  $('voiceReplyName').textContent = agents[index].name;
  replyText.textContent = '';
  replyCard.hidden = true;
  const showReply = (value,finished=false,spoken=value) => {
    if (!$('voiceDialog').open || signal.aborted || Number(form.elements.agent.value)!==index) return;
    const follow = replyText.scrollHeight-replyText.clientHeight-replyText.scrollTop < 24;
    if (replyCard.hidden) $('voiceStatus').textContent = agents[responder].name+' yanıtlıyor…';
    if (replyCard.hidden) voiceActivities(['Yanıt hazırlıyor',...[...actions].slice(-3)]);
    replyCard.hidden = false;
    replyText.textContent = value;
    $('voiceTimeline').scrollTop = $('voiceTimeline').scrollHeight;
    if (follow) replyText.scrollTop = replyText.scrollHeight;
    if (!speaker) streamingVoice = speaker = makeStreamingVoice(responder);
    speaker.append(spoken,finished);
  };
  $('voiceStatus').textContent = agents[index].name+' düşünüyor…';
  voiceActivities(['Düşünüyor']);
  announceWork(index,true);
  try {
    const context = (voiceThreads[index] ?? []).slice(-8).map(item => (item.side==='user'?'Kullanıcı: ':'Ajan: ')+item.text.slice(0,900));
    addVoiceTurn(index,'user',text);
    form.elements.prompt.value = '';
    const prompt = ['Kullanıcıyla sesli görüşüyorsun. İlk cümlen kısa ve doğrudan olsun. Kullanıcının son mesajındaki dilde doğal konuş ve gerekli ayrıntıyla devam et.',
      ...context, 'Kullanıcı: '+text].join('\n\n');
    let reply, spoken, trackedTask, exchangeTurns;
    const englishWorkspace=asksWorkspaceInEnglish(text);
    if (/(?:mail|e-?posta).*(?:geldi mi|var mı|kontrol et)|(?:check|any) (?:my |new )?(?:mail|email|inbox)/iu.test(text)) {
      reply=await mailOverview();
    } else if (/(?:mail|e-?posta).*(?:yaz|taslağını hazırla)|^(?:please\s+)?(?:draft|write) (?:an? )?email/iu.test(text)) {
      reply=await draftMail(index,text,signal);
    } else if (/(?:işe al(?:ır mısın)?)[.!?\s]*$/iu.test(text) || /^(?:please\s+)?(?:hire|recruit)\s+/i.test(text)) {
      const recruiter=activeAgents().find(({agent})=>agent.recruiter || /insan kaynakları|human resources/i.test(profession(agent)));
      if (!recruiter) throw Error('Önce bir insan kaynakları ajanı ekle.');
      const hired=await recruitAgent(text,signal);
      responder=recruiter.index;
      $('voiceReplyName').textContent=agents[responder].name;
      reply=window.kopbriLanguage?.()==='en'
        ? 'I added '+hired.name+' as '+hired.profession+' using '+hired.model+', sir.'
        : hired.name+' ekibe '+hired.profession+' olarak katıldı, efendim. Sağlayıcı: '+hired.model+'.';
    } else if (meetingMode || /^(?:toplantı(?:yı)? (?:başlat|aç)|(?:start|open) (?:a |the )?meeting)\s*[:：]/iu.test(text) ||
      (target!=null && target!==index && /(?:danış|görüş|konuş|sor|consult|discuss|ask)/iu.test(text))) {
      const meeting=meetingMode || /^(?:toplantı|(?:start|open) (?:a |the )?meeting)/iu.test(text);
      const topic=text.replace(/^(?:toplantı(?:yı)? (?:başlat|aç)|(?:start|open) (?:a |the )?meeting)\s*[:：]\s*/iu,'');
      const peers=meeting ? activeAgents().map(({index})=>index) : [target];
      exchangeTurns=await teamConversation(index,peers,topic,signal,{meeting,
        onTurn:(agent,body)=>addVoiceTurn(index,'agent',body,agent),
        onStatus:agent=>{$('voiceStatus').textContent=agents[agent].name+' düşünüyor…';}});
      const last=exchangeTurns.at(-1);
      responder=last.index;
      $('voiceReplyName').textContent=agents[responder].name;
      reply=last.body;
    } else if (englishWorkspace || asksWorkspace(text)) {
      const data=await fetch('/api/workspace',{signal}).then(response=>response.json());
      if (!data.cwd) throw Error('Çalışma klasörü okunamadı.');
      const directory=data.cwd.split(/[\\/]/).filter(Boolean).at(-1) || data.cwd;
      reply=(englishWorkspace?'I’m working in this folder, sir:\n':'Şu anda bu klasörde çalışıyorum, efendim:\n')+data.cwd;
      spoken=englishWorkspace?'I’m working in the '+directory+' folder, sir.':'Şu anda '+directory+' klasöründe çalışıyorum, efendim.';
    } else if (taskRequest(text)) {
      const scope=await taskWorkspace(signal);
      const saveOnly=saveTaskCommand.test(text);
      const prior=saveOnly && voiceThreads[index]?.findLast(item=>item.side==='user'&&!saveTaskCommand.test(item.text))?.text;
      if (saveOnly && !prior) throw Error('Kaydedilecek görevi söyle.');
      trackedTask=prior && tasks.findLast(task=>task.agent===index && task.workspace===scope && (task.sourceText===prior || task.role===prior));
      if (!trackedTask) trackedTask=queueVoiceTask(index,prior || text,form.elements.folder.checked,scope);
      if (saveOnly) {
        reply=window.kopbriLanguage?.()==='en'?'I saved the task in Tasks, sir.':'Görevi Görevler bölümüne kaydettim, efendim.';
      } else {
      reply=await runTask(trackedTask,{signal,speak:true,onText:showReply,onTool,onStage:phase=>voiceActivities([phase]),
        onExecutor:agent=>{
          responder=agent;
          $('voiceReplyName').textContent=agents[agent].name;
          if(agent!==index) $('voiceStatus').textContent='Devralan ajan · '+agents[agent].name;
        }});
      if (!reply) reply=window.kopbriLanguage?.()==='en'
        ? 'I added the task to the queue, sir. You can run it from Tasks.'
        : 'Görevi sıraya ekledim, efendim. Görevler bölümünden çalıştırabilirsin.';
      }
    } else reply = await runWithPermission(index,prompt,text,signal,form.elements.folder.checked,true,showReply,onTool);
    if (exchangeTurns) playTeamTurns(exchangeTurns);
    else {
      showReply(reply,true,spoken ?? reply);
      addVoiceTurn(index,'agent',reply,responder);
    }
    replyCard.hidden = true;
    $('voiceStatus').textContent = agents[responder].name;
    if (!exchangeTurns && !trackedTask?.result) messages.push({agent:responder,body:reply});
    save(); render();
  } catch (error) { if (error.name!=='AbortError') $('voiceStatus').textContent = error.message; }
  finally { voiceRun = null; voiceActivities(); announceWork(index,false); }
};

const ns = 'http://www.w3.org/2000/svg';
function svg(tag,attrs,parent=$('room')) {
  const node = document.createElementNS(ns,tag);
  Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,value));
  parent.append(node);
  return node;
}
const project = ([x,y,z=0]) => [390+(x-y)*.87,125+(x+y)*.45-z];
function face(points,fill,parent,stroke='none') {
  return svg('polygon',{points:points.map(project).join(' '),fill,stroke,'stroke-width':.65},parent);
}
function box(x,y,z,w,d,h,colors,parent) {
  const [top,left,right] = colors;
  face([[x,y+d,z],[x+w,y+d,z],[x+w,y+d,z+h],[x,y+d,z+h]],left,parent);
  face([[x+w,y,z],[x+w,y+d,z],[x+w,y+d,z+h],[x+w,y,z+h]],right,parent);
  face([[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]],top,parent);
}
box(0,0,-18,400,350,18,['#d0e2e8','#7798a3','#567a86']);
for(let y=0;y<350;y+=25) for(let x=0;x<400;x+=25) {
  face([[x,y],[x+25,y],[x+25,y+25],[x,y+25]],(x+y)%50===0?'#d9e9ef':'#e2eff3',undefined,'#c3d9e2');
}
const wall = ['#f2fbfd','#c2dce5','#a2c6d4'];
box(0,0,0,400,7,63,wall);
box(0,7,0,7,343,63,wall);
for(let x=28;x<370;x+=66) box(x,7,32,49,2,20,['#f0fbff','#a0c9d8','#729fae']);
face([[102,96],[326,96],[326,292],[102,292]],'#99bccc',undefined,'#7ba8b9');
face([[111,105],[317,105],[317,283],[111,283]],'#accddb',undefined,'#8bb8c8');
function plant(x,y) {
  box(x,y,0,20,20,17,['#8b789a','#56465f','#43364d']);
  box(x+8,y+8,17,4,4,17,['#81c6a6','#46796b','#3c6a5b']);
  box(x+1,y+4,27,19,9,8,['#6ba98e','#46796b','#3c6a5b']);
  box(x+7,y+6,35,10,10,8,['#8cd4a9','#568d76','#407060']);
}
plant(23,24); plant(366,21); plant(22,309);
box(161,16,0,73,25,28,['#706180','#493f59','#3a3249']);
for(let i=0;i<6;i++) box(166+i*10,22,28,7,13,11+i%3*3,[['#d48d8b','#a699e3','#79b7a2'][i%3],'#615672','#4c425d']);
const wood = ['#e5c8aa','#ba997d','#9d8068'];
const metal = ['#555570','#35364e','#28283e'];
const deskLayer = svg('g',{});
const recLayer=svg('g',{'aria-label':'Masa tenisi ve dart köşesi'});
const walkerLayer=svg('g',{'aria-hidden':'true'});
const figures=new Map();
let stroll;

function drawGames(){
  for(const dx of [4,76])for(const dy of [3,32])box(221+dx,264+dy,0,3,3,22,metal,recLayer);
  box(221,264,22,83,38,3,['#258ba8','#1b6981','#145468'],recLayer);
  face([[224,282,25.2],[301,282,25.2],[301,283,25.2],[224,283,25.2]],'#d9f7ff',recLayer);
  face([[262,264,25.1],[262,302,25.1],[262,302,34],[262,264,34]],'#e3f8ff',recLayer,'#66a3b6');
  box(352,280,0,6,17,53,['#778a99','#466171','#314952'],recLayer);
  const [cx,cy]=project([358,288,45]);
  svg('ellipse',{cx,cy,rx:12,ry:15,fill:'#213543',stroke:'#b4def0','stroke-width':2},recLayer);
  svg('ellipse',{cx,cy,rx:7,ry:9,fill:'#e5f6fb',stroke:'#2789a4','stroke-width':2},recLayer);
  svg('circle',{cx,cy,r:3,fill:'#e88572'},recLayer);
}
drawGames();
function canStroll(index){
  return isActive(index) && (speakingAgents.get(index)||0)<Date.now() &&
    !tasks.some(task=>(task.agent===index || task.analyst===index || task.executor===index) && task.state===1);
}
function drawAgentHead(index,x,y,z,parent){
  const feminine=voiceProfile(index)==='feminine';
  const hair=feminine?['#805340','#5d392f','#422821']:['#443952','#362d45','#30263b'];
  const head=svg('g',{'data-appearance':feminine?'feminine':'masculine'},parent);
  if(feminine)box(x-7,y-6,z-9,15,7,20,hair,head);
  box(x-6,y-6,z,12,12,12,['#edc6b9','#be948e','#a27d81'],head);
  box(x-7,y-7,z+10,14,14,4,hair,head);
  if(feminine){
    box(x+4,y-1,z-8,4,8,19,hair,head);
    box(x-7,y+4,z+3,3,3,9,hair,head);
    box(x+3,y+5,z+1,2,2,2,['#f7d291','#d5a85d','#a97839'],head);
  }
}
function stopStroll(repaint=true){
  if(!stroll)return;
  const previous=stroll;
  stroll=null;
  for(const motion of previous.animations)motion.cancel();
  previous.sprite.remove();previous.prop?.remove();
  previous.home.removeAttribute('visibility');
  if(repaint)renderAgents();
}
function move(points,duration,element,bob=false){
  const origin=project([0,0]);
  const frames=points.flatMap((point,i)=>{
    const [x,y]=project(point);
    const frame={transform:'translate('+(x-origin[0])+'px,'+(y-origin[1])+'px)'};
    if(!bob || i===points.length-1)return [frame];
    const [nx,ny]=project(points[i+1]);
    return [frame,{transform:'translate('+((x+nx)/2-origin[0])+'px,'+((y+ny)/2-origin[1]-2)+'px)'}];
  });
  const animation=element.animate(frames,{duration,fill:'forwards',easing:'linear'});
  stroll.animations.push(animation);
  return animation.finished;
}
async function takeBreak(){
  if(stroll || document.hidden || $('office').hidden || window.frameElement?.hidden ||
     new URLSearchParams(window.parent.location.search).has('spotlight') ||
     matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const candidates=activeAgents().filter(({index})=>canStroll(index)&&figures.has(index));
  if(!candidates.length)return;
  const {agent,index}=candidates[Math.floor(Math.random()*candidates.length)];
  const {home,x,y}=figures.get(index);
  const ping=Math.random()<.55, target=ping?[250,318]:[332,292];
  const sprite=svg('g',{class:'office-walker'},walkerLayer);
  box(-6,-4,0,5,9,8,['#455065','#30384a','#262d3c'],sprite);
  box(1,-4,0,5,9,8,['#455065','#30384a','#262d3c'],sprite);
  box(-7,-5,8,14,11,15,[agent.color,'#726387','#534760'],sprite);
  drawAgentHead(index,0,0,23,sprite);
  home.setAttribute('visibility','hidden');
  const trip={index,home,sprite,label:'Molada',animations:[]};
  stroll=trip;
  renderAgents();
  const route=[[x,y],[x,Math.min(337,y+22)],[Math.max(x,319),Math.min(337,y+22)],[321,329],target];
  try{
    await move(route,3300,sprite,true);
    if(stroll!==trip)return;
    trip.label=ping?'Masa tenisi oynuyor':'Dart oynuyor';
    renderAgents();
    const [px,py]=project(ping?[231,282,31]:[331,293,28]);
    trip.prop=svg('circle',{cx:px,cy:py,r:ping?2.8:2,fill:ping?'#f7fcff':'#ff9e83',stroke:'#395360','stroke-width':.7},walkerLayer);
    const [endX,endY]=project(ping?[295,282,32]:[358,288,45]);
    const game=trip.prop.animate([
      {transform:'translate(0px,0px)'},
      {transform:'translate('+((endX-px)*.5)+'px,'+((endY-py)*.5-8)+'px)'},
      {transform:'translate('+(endX-px)+'px,'+(endY-py)+'px)'}
    ],{duration:ping?700:510,iterations:ping?5:3,direction:ping?'alternate':'normal',easing:'ease-in-out'});
    trip.animations.push(game);
    await game.finished;
    if(stroll!==trip)return;
    trip.prop.remove();
    trip.label='Masasına dönüyor';
    renderAgents();
    await move(route.toReversed(),3000,sprite,true);
  } catch { /* interrupted by work or office changes */ }
  finally{if(stroll===trip)stopStroll();}
}
function drawDesks() {
stopStroll(false);
figures.clear();
deskLayer.replaceChildren();
const active=activeAgents();
$('newAgent').disabled = active.length >= 10 || agents.length>=200;
const positions = active.length <= 3 ? [[49,54],[249,82],[101,221]] :
  Array.from({length:active.length},(_,i)=>[9+(i%4)*97,39+Math.floor(i/4)*102]);
active.forEach(({agent,index:i},position) => {
  const [x,y]=positions[position];
  const g = svg('g',{class:'desk','data-agent':i,tabindex:0,role:'button','aria-label':agent.name+' ile görüş'},deskLayer);
  const open=()=>{select(i);if(desktop?.openAgentVoice)desktop.openAgentVoice(i);else voiceDialog(i);};
  g.onclick = open;
  g.onkeydown = event => { if (event.key==='Enter'||event.key===' ') {event.preventDefault();open();} };
  face([[x-7,y-6],[x+104,y-6],[x+104,y+95],[x-7,y+95]],'#8298b24d',g);
  for(const dx of [5,85]) for(const dy of [4,39]) box(x+dx,y+dy,0,5,5,28,metal,g);
  box(x,y,28,97,48,6,wood,g);
  box(x+24,y+8,34,30,14,2,metal,g);
  box(x+37,y+10,36,5,6,8,metal,g);
  box(x+18,y+9,43,46,5,27,['#606079','#222437','#161826'],g);
  face([[x+21,y+14.2,46],[x+61,y+14.2,46],[x+61,y+14.2,67],[x+21,y+14.2,67]],'#343856',g);
  for(let line=0;line<3;line++) face([[x+25,y+14.4,62-line*5],[x+55-line*4,y+14.4,62-line*5],[x+55-line*4,y+14.4,63-line*5],[x+25,y+14.4,63-line*5]],agent.color,g);
  box(x+22,y+28,34,37,9,2,metal,g);
  box(x+77,y+13,34,7,7,9,[agent.color,'#5d5271','#4b435e'],g);
  box(x+34,y+62,0,27,23,10,metal,g);
  box(x+33,y+60,10,29,27,5,['#575471','#393850','#333248'],g);
  const home=svg('g',{},g);
  box(x+39,y+65,15,18,16,18,[agent.color,'#726387','#534760'],home);
  drawAgentHead(i,x+48,y+72,33,home);
  figures.set(i,{home,x:x+48,y:y+74});
  box(x+33,y+84,11,29,5,22,['#5a5873','#44425f','#37374f'],g);
  const [cx,cy] = project([x+49,y+95,1]);
  svg('rect',{x:cx-48,y:cy-10,width:96,height:23,rx:11,fill:'#1c1b2b',stroke:agent.color,class:'marker'},g);
  svg('circle',{cx:cx-34,cy:cy+2,r:3.5,class:'status'},g);
  svg('text',{x:cx+3,y:cy+6,fill:'#f6f0ff','text-anchor':'middle','font-size':12,'font-weight':700},g).textContent = agent.name.length > 12 ? agent.name.slice(0,11)+'…' : agent.name;
});
}
plant(371,312);
drawDesks();
render();
setTimeout(takeBreak,3500);
setInterval(takeBreak,12000);
window.kopbriOffice = {
  welcomeRecruiter() {
    const recruiter=activeAgents().find(({agent,index})=>agent.recruiter && !voiceThreads[index]?.length);
    if (!recruiter) return;
    if (desktop?.openAgentVoice) desktop.openAgentVoice(recruiter.index);
    else voiceDialog(recruiter.index);
  },
  open(view,index) {
    tab(view);
    if (view==='office' && Number.isInteger(index)) select(index);
    if (view==='tasks' && Number.isInteger(index)) $('taskList').children[index]?.scrollIntoView({block:'center'});
    if (view==='chat' && Number.isInteger(index)) $('messages').children[index+1]?.scrollIntoView({block:'center'});
  },
  newAgent: () => $('newAgent').click(),
  newTask: taskDialog,
  voice: voiceDialog,
  holdVoice() {
    voiceDialog();
    if(!activeAgents().length)return;
    if (recorder || transcription || $('voiceMic').disabled) return;
    holdReleased = false;
    holdActive = true;
    beginRecording(true);
  },
  releaseVoice() {
    if (!holdActive) return false;
    holdActive = false;
    holdReleased = true;
    if (shortcutRecording && recorder?.state==='recording') recorder.stop();
    return true;
  },
  search: () => [
    ...activeAgents().map(({agent:a,index})=>({label:'Ajan · '+a.name+' · '+(a.model ?? a.name)+' · '+profession(a),tab:'office',index})),
    ...tasks.map((t,index)=>({label:'Görev · '+t.title+' · '+agents[t.agent].name+' · '+t.role,tab:'tasks',index})),
    ...messages.map((m,index)=>({label:'Konuşma · '+agents[m.agent].name+' · '+m.body,tab:'chat',index}))
  ]
};
fetch('/api/office').then(response => response.ok ? response.json() : null).then(data => {
  if (!data || !Array.isArray(data.agents) || data.agents.length>200 || !Array.isArray(data.tasks) || !Array.isArray(data.messages)) return;
  agents.splice(0,agents.length,...data.agents);
  tasks.splice(0,tasks.length,...data.tasks);
  const recover=()=>{for (const task of tasks) if (task.state===1) {task.state=0;task.phase='';}};
  if (navigator.locks) navigator.locks.request('kopbri-task-workflow',{ifAvailable:true},lock=>{if(lock){recover();render();}}).catch(console.error);
  else recover();
  messages.splice(0,messages.length,...data.messages);
  Object.assign(voiceThreads,data.voiceThreads || {});
  drawDesks();render();
  if($('voiceDialog').open)refreshVoiceAgent();
}).catch(console.error);
officeUpdates.onmessage = ({data}) => {
  const update = JSON.parse(data);
  agents.splice(0,agents.length,...update.agents);
  for (let i=0;i<update.tasks.length;i++) {
    if (tasks[i]) Object.assign(tasks[i],update.tasks[i]);
    else tasks.push(update.tasks[i]);
  }
  messages.splice(0,messages.length,...update.messages);
  Object.assign(voiceThreads,update.voiceThreads || {});
  if ($('voiceDialog').open && !recorder && !transcription && !voiceRun) refreshVoiceAgent();
  drawDesks(); render();
};
