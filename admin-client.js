(function(){
 'use strict';
 const config=window.VSP_FIREBASE_CONFIG,key='VSP_ADMIN_SESSION_'+config.projectId;
 let session=null,refreshing=null;const photos=new Map();
 try{session=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
 function save(value){session=value;sessionStorage.setItem(key,JSON.stringify(value));}
 function signOut(){session=null;sessionStorage.removeItem(key);for(const url of photos.values())URL.revokeObjectURL(url);photos.clear();}
 function requestError(message,kind,status,code){const error=new Error(message);error.kind=kind;error.status=status||0;error.code=code||'';return error;}
 async function post(url,data,headers={}){
  let response;
  try{response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(110000)});}
  catch(error){throw requestError(error?.name==='TimeoutError'||error?.name==='AbortError'?'Kết nối quá thời gian. Vui lòng thử lại.':'Không kết nối được máy chủ. Vui lòng kiểm tra mạng rồi thử lại.','network');}
  let body;try{body=await response.json();}catch{throw requestError('Máy chủ chưa phản hồi đúng. Vui lòng thử lại sau.','server',response.status);}
  if(response.ok)return body;
  const auth=url.startsWith('https://identitytoolkit.googleapis.com/');
  if(auth){
   const code=String(body.error?.message||'').split(' : ')[0];
   if(['INVALID_LOGIN_CREDENTIALS','INVALID_PASSWORD','EMAIL_NOT_FOUND'].includes(code))throw requestError('Sai tài khoản hoặc mật khẩu quản trị.','credentials',response.status,code);
   if(code==='USER_DISABLED')throw requestError('Tài khoản quản trị đã bị ngừng hoạt động.','permission',response.status,code);
   if(response.status===429||code==='TOO_MANY_ATTEMPTS_TRY_LATER')throw requestError('Đăng nhập tạm bị giới hạn. Vui lòng chờ ít phút rồi thử lại.','rate-limit',response.status,code);
   throw requestError('Dịch vụ đăng nhập đang gặp lỗi cấu hình hoặc tạm gián đoạn. Vui lòng thử lại sau.','auth-service',response.status,code);
  }
  if(response.status===401)throw requestError('Phiên quản trị hết hạn. Vui lòng đăng nhập lại.','session',401);
  if(response.status===403)throw requestError('Tài khoản đã đăng nhập nhưng chưa truy cập được trang quản trị. Vui lòng liên hệ quản lý hệ thống.','permission',403);
  if(response.status>=500)throw requestError('Máy chủ quản trị tạm chưa xử lý được yêu cầu. Vui lòng thử lại sau.','server',response.status);
  throw requestError(body.msg||'Không xử lý được yêu cầu. Vui lòng kiểm tra thông tin rồi thử lại.','request',response.status);
 }
 async function token(){
  if(!session)throw new Error('Vui lòng đăng nhập quản trị.');if(session.expiresAt>Date.now()+60000)return session.idToken;
  if(!refreshing){const current=session;refreshing=(async()=>{const r=await fetch('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:current.refreshToken}),signal:AbortSignal.timeout(30000)});const b=await r.json();if(!r.ok||session!==current)throw new Error('Phiên quản trị hết hạn. Vui lòng đăng nhập lại.');save({...current,idToken:b.id_token,refreshToken:b.refresh_token,expiresAt:Date.now()+Number(b.expires_in)*1000});return session.idToken;})().finally(()=>{refreshing=null;});}return refreshing;
 }
 async function call(action,args,requestId){return post(config.adminApiUrl||config.apiUrl.replace(/attendanceApi$/,'attendanceAdminApi'),{action,args,requestId:requestId||crypto.randomUUID()},{Authorization:'Bearer '+await token()});}
 async function login(username,password){
  const hex=Array.from(new TextEncoder().encode(String(username).trim().toUpperCase()),b=>b.toString(16).padStart(2,'0')).join('');
  try{const b=await post('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(config.apiKey),{email:`admin.${hex}@attendance.${config.projectId}.invalid`,password:String(password).trim(),returnSecureToken:true});save({idToken:b.idToken,refreshToken:b.refreshToken,expiresAt:Date.now()+Number(b.expiresIn)*1000});await call('checkAdmin',[]);return true;}catch(error){signOut();if(error.kind==='credentials')return false;throw error;}
 }
 function escape(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 function safe(value){if(typeof value==='string')return escape(value);if(Array.isArray(value))return value.map(safe);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[escape(k),safe(v)]));return value;}
 async function photo(ref){
  if(photos.has(ref))return photos.get(ref);const prefix='gs://'+config.storageBucket+'/';if(!String(ref).startsWith(prefix+'attendance/'))return '';
  const before=session;const r=await fetch('https://firebasestorage.googleapis.com/v0/b/'+config.storageBucket+'/o/'+encodeURIComponent(ref.slice(prefix.length))+'?alt=media',{headers:{Authorization:'Firebase '+await token()},cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Không tải được ảnh.');const blob=await r.blob();if(session!==before)return '';const url=URL.createObjectURL(blob);photos.set(ref,url);return url;
 }
 async function hydratePhotos(){for(const img of document.querySelectorAll('img[data-firebase-photo]')){const ref=img.dataset.firebasePhoto;if(img.dataset.loading)continue;img.dataset.loading='true';try{img.src=await photo(ref);img.onclick=()=>{const link=document.createElement('a');link.href=img.src;link.target='_blank';link.rel='noopener';link.click();};}catch{img.alt='Không tải được ảnh';}}}
 async function invoke(action,args){
  if(action==='checkAdmin')return login(...args);
  const result=await call(action,args);
  if(action==='exportReport'&&result.base64){const bytes=Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));setTimeout(()=>URL.revokeObjectURL(url),300000);return {...result,downloadUrl:url};}
  if(['getAdminStats','getAllStaffWithStats','getAllSchedules','getTodayMonitorData','getAdminStaffDetails','getWeeklyMatrix','getLocationsList'].includes(action))return safe(result);
  return result;
 }
 function rpc(success,failure){return new Proxy({}, {get(target,action){if(action==='withSuccessHandler')return handler=>rpc(handler,failure);if(action==='withFailureHandler')return handler=>rpc(success,handler);return (...args)=>{invoke(action,args).then(result=>{if(success)success(result);hydratePhotos();}).catch(error=>{if(failure)failure(error);else window.showToast?.(error.message,'error');document.querySelectorAll('button.loading').forEach(b=>{b.classList.remove('loading');b.innerHTML=b.dataset.tx||b.textContent;});});};}});}
 window.VSPAdmin={rpc:rpc(),signOut,call,photo,hydratePhotos};
})();
