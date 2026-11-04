'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {randomBytes,createHash}=require('node:crypto');
const {safeStorage,shell}=require('electron');

const providers={
  gmail:{auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scope:'https://www.googleapis.com/auth/gmail.readonly'},
  outlook:{auth:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',token:'https://login.microsoftonline.com/common/oauth2/v2.0/token',scope:'offline_access https://graph.microsoft.com/Mail.Read'},
  imap:{}
};
async function json(url,options) {
  const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('E-posta isteği tamamlanamadı ('+response.status+').');
  return response.status===202 || response.status===204 ? null : response.json();
}
function tokenRequest(provider,client,params) {
  const body=new URLSearchParams({client_id:client.id,...params});
  if(client.secret)body.set('client_secret',client.secret);
  return json(provider.token,{method:'POST',body});
}
async function authorize(name,client) {
  const provider=providers[name], state=randomBytes(32).toString('base64url'), verifier=randomBytes(48).toString('base64url');
  let resolveCode,rejectCode;
  const code=new Promise((resolve,reject)=>{resolveCode=resolve;rejectCode=reject;});
  const server=http.createServer((req,res)=>{
    const request=new URL(req.url,'http://localhost');
    const value=request.searchParams.get('code');
    if(req.method!=='GET' || request.pathname!=='/' || request.searchParams.get('state')!==state){res.writeHead(400);res.end();return;}
    res.writeHead(value?200:400,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
    res.end(value?'Return to kopbri to finish connecting.':'Authorization was canceled. Return to kopbri.');
    if(value)resolveCode(value);else rejectCode(Error('E-posta yetkilendirmesi tamamlanmadı.'));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const redirect='http://'+(name==='gmail'?'127.0.0.1':'localhost')+':'+server.address().port;
  const auth=new URL(provider.auth);
  const scope=provider.scope+(client.canSend?(name==='gmail'?' https://www.googleapis.com/auth/gmail.send':' https://graph.microsoft.com/Mail.Send'):'');
  auth.search=new URLSearchParams({client_id:client.id,redirect_uri:redirect,response_type:'code',scope,state,
    code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',
    ...(name==='gmail'?{access_type:'offline',prompt:'consent'}:{response_mode:'query',prompt:'select_account'})});
  const timer=setTimeout(()=>rejectCode(Error('E-posta bağlantısı zaman aşımına uğradı.')),180000);
  try {
    const [value]=await Promise.all([code,shell.openExternal(auth.href)]);
    return await tokenRequest(provider,client,{grant_type:'authorization_code',code:value,code_verifier:verifier,redirect_uri:redirect});
  } finally {clearTimeout(timer);server.closeAllConnections();server.close();}
}
async function listMail(name,token,unread) {
  const options={headers:{Authorization:'Bearer '+token}};
  if(name==='outlook') {
    const url=new URL('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages');
    url.search=new URLSearchParams({'$top':'12','$select':'subject,from,receivedDateTime,isRead,bodyPreview','$orderby':'receivedDateTime desc',
      ...(unread?{'$filter':'receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false'}:{})});
    const data=await json(url,options);
    return data.value.map(item=>({subject:item.subject,from:item.from?.emailAddress?.address,date:item.receivedDateTime,unread:!item.isRead,preview:item.bodyPreview}));
  }
  const base='https://gmail.googleapis.com/gmail/v1/users/me/messages';
  const query=new URLSearchParams({maxResults:'12',labelIds:'INBOX'});
  if(unread)query.append('labelIds','UNREAD');
  const data=await json(base+'?'+query,options);
  return Promise.all((data.messages || []).map(async ({id})=>{
    const item=await json(base+'/'+encodeURIComponent(id)+'?format=full&fields=snippet,internalDate,labelIds,payload(headers)',options);
    const header=name=>item.payload?.headers?.find(entry=>entry.name.toLowerCase()===name)?.value;
    return {subject:header('subject'),from:header('from'),date:Number(item.internalDate),unread:item.labelIds?.includes('UNREAD'),preview:item.snippet};
  }));
}
function imapCredentials(payload) {
  const host=String(payload.host || '').trim(), user=String(payload.user || '').trim(), pass=String(payload.pass || '');
  const smtpHost=String(payload.smtpHost || '').trim(), port=Number(payload.port || 993), smtpPort=Number(payload.smtpPort || 465);
  const hostname=/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;
  const validPort=number=>Number.isInteger(number)&&number>=1&&number<=65535;
  if(!hostname.test(host)||!validPort(port)||!user||user.length>254||!pass||pass.length>512||
    (smtpHost&&(!hostname.test(smtpHost)||!validPort(smtpPort))))throw Error('IMAP ve SMTP bilgilerini kontrol et.');
  return {host,port,user,pass,smtpHost,smtpPort,smtpSecurity:smtpPort===587?'STARTTLS':'TLS'};
}
async function listImap(settings,unread) {
  const {ImapFlow}=require('imapflow');
  const client=new ImapFlow({host:settings.host,port:settings.port,secure:true,auth:{user:settings.user,pass:settings.pass},
    logger:false,disableAutoIdle:true,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:12000});
  client.on('error',()=>{});
  try {
    await client.connect();
    const lock=await client.getMailboxLock('INBOX',{readOnly:true});
    try {
      if (!client.mailbox.exists) return [];
      const ids=unread ? (await client.search({seen:false},{uid:true}) || []).slice(-12) : null;
      if (ids && !ids.length) return [];
      const range=ids || Math.max(1,client.mailbox.exists-11)+':*';
      const rows=await client.fetchAll(range,{envelope:true,flags:true,internalDate:true},{uid:Boolean(ids)});
      return rows.reverse().map(item=>({subject:item.envelope?.subject,from:item.envelope?.from?.[0]?.address,
        date:item.internalDate,unread:!item.flags?.has('\\Seen'),preview:''}));
    } finally {lock.release();}
  } catch {throw Error('IMAP bağlantısı kurulamadı. Sunucu, TLS ve giriş bilgilerini kontrol et.');}
  finally {client.close();}
}
module.exports=function mailConnection(root){
  const busy=new Set(), directory=path.join(root,'.kopbri','desktop');
  async function execute(name,action,payload={}){
    if(!Object.hasOwn(providers,name))throw Error('Bilinmeyen e-posta sağlayıcısı.');
    const file=path.join(directory,'mail-'+name+'.secure');
    const load=async()=>{try{return JSON.parse(safeStorage.decryptString(await fs.readFile(file)));}catch{return null;}};
    if(action==='status'){
      const saved=await load();
      return {connected:Boolean(saved),canSend:Boolean(name==='imap'?saved?.smtpHost:saved?.client.canSend)};
    }
    if(busy.has(name))throw Error('E-posta işlemi zaten sürüyor.');
    busy.add(name);
    const save=async value=>{
      await fs.mkdir(directory,{recursive:true});
      await fs.writeFile(file+'.tmp',safeStorage.encryptString(JSON.stringify(value)));
      await fs.rename(file+'.tmp',file);
    };
    try {
      if(action==='disconnect'){await fs.rm(file,{force:true});return {connected:false};}
      if(action==='connect'){
        if(!safeStorage.isEncryptionAvailable())throw Error('Bu cihazda güvenli kimlik bilgisi saklama kullanılamıyor.');
        if(name==='imap'){
          const settings=imapCredentials(payload);
          await listImap(settings,false);await save(settings);
          return {connected:true};
        }
        const client={id:String(payload.id || '').trim(),secret:name==='gmail'?String(payload.secret || '').trim():'',canSend:payload.canSend===true};
        if(!/^[\w.-]{8,200}$/.test(client.id) || (name==='gmail'&&!/^[\w-]{8,200}$/.test(client.secret)))throw Error('OAuth istemci bilgilerini kontrol et.');
        const result=await authorize(name,client);
        if(!result.refresh_token)throw Error('E-posta sağlayıcısı yenileme belirteci vermedi.');
        await save({client,refresh:result.refresh_token});
        return {connected:true};
      }
      if(action==='list' || action==='send'){
        const saved=await load();
        if(!saved)throw Error('Önce e-posta hesabını bağla.');
        if(name==='imap' && action==='list')return listImap(saved,payload.unread===true);
        if(action==='send' && name==='imap'){
          if(!saved.smtpHost)throw Error('Önce SMTP ayarlarını kaydet.');
          const transport=require('nodemailer').createTransport({host:saved.smtpHost,port:saved.smtpPort,secure:saved.smtpSecurity==='TLS',
            requireTLS:saved.smtpSecurity==='STARTTLS',auth:{user:saved.user,pass:saved.pass},connectionTimeout:15000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});
          try {await transport.sendMail({from:saved.user,to:payload.to,subject:payload.subject,text:payload.body});}
          finally {transport.close();}
          return {sent:true};
        }
        if(action==='send'&&!saved.client.canSend)throw Error('Hesabı gönderme izniyle yeniden bağla.');
        const result=await tokenRequest(providers[name],saved.client,{grant_type:'refresh_token',refresh_token:saved.refresh});
        if(result.refresh_token && result.refresh_token!==saved.refresh)await save({...saved,refresh:result.refresh_token});
        if(action==='send'){
          const options={method:'POST',headers:{Authorization:'Bearer '+result.access_token,'Content-Type':'application/json'}};
          if(name==='gmail'){
            const subject='=?UTF-8?B?'+Buffer.from(payload.subject).toString('base64')+'?=';
            const raw=Buffer.from(['To: '+payload.to,'Subject: '+subject,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',''+Buffer.from(payload.body).toString('base64')].join('\r\n')).toString('base64url');
            await json('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{...options,body:JSON.stringify({raw})});
          } else {
            await json('https://graph.microsoft.com/v1.0/me/sendMail',{...options,body:JSON.stringify({message:{subject:payload.subject,body:{contentType:'Text',content:payload.body},toRecipients:[{emailAddress:{address:payload.to}}]}})});
          }
          return {sent:true};
        }
        return listMail(name,result.access_token,payload.unread===true);
      }
      throw Error('Bilinmeyen e-posta işlemi.');
    } finally {busy.delete(name);}
  }
  return async (name,action,payload)=>{
    if(action!=='overview')return execute(name,action,payload);
    const names=Object.keys(providers);
    const linked=(await Promise.all(names.map(provider=>execute(provider,'status')))).map((status,i)=>status.connected?names[i]:null).filter(Boolean);
    return Promise.all(linked.map(async provider=>{
      try {return {provider,messages:await execute(provider,'list',{unread:true})};}
      catch {return {provider,error:true};}
    }));
  };
};
