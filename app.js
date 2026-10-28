'use strict';
let db = null;
let isAdmin = false;
let editingId = null;
let editingVersion = null;
let pendingId = null;
let busy = false;
let loading = false;
const fields = ['title','date','endDate','category','internalDate','responsible','system','source','description'];
const byId = id => document.getElementById(id);
function ensureMonth(year, month) {
  if (!availableMonths.some(m => m.year === year && m.month === month)) availableMonths.push({year,month});
  availableMonths.sort((a,b) => a.year-b.year || a.month-b.month);
}
function repaint() {
  masterEvents.forEach(e => {const [y,m] = e.date.split('-').map(Number);ensureMonth(y,m-1);});
  ensureMonth(currentYear,currentMonth);
  populateMonthSelect();updateCounts();renderCalendar();renderTable();renderAdminList();
}
async function loadEvents() {
  if (!db || loading) return;
  loading = true;byId('reloadData').disabled = true;
  try {
    const rows = [];
    for (let from=0;;from+=500) {
      const {data,error} = await db.from('calendar_events').select('*').order('date').order('id').range(from,from+499);
      if (error) throw error;
      rows.push(...data);if(data.length<500)break;
    }
    masterEvents.splice(0,masterEvents.length,...rows);repaint();
    byId('connectionStatus').textContent = `ข้อมูลจากฐานข้อมูลกลาง · ${rows.length} กิจกรรม · อัปเดต ${new Date().toLocaleTimeString('th-TH')}`;
  } catch (_) {
    byId('connectionStatus').textContent = 'โหลดข้อมูลไม่สำเร็จ ข้อมูลที่แสดงอาจไม่ล่าสุด กรุณาตรวจสอบอินเทอร์เน็ตแล้วกดโหลดข้อมูลใหม่';
  } finally {loading=false;byId('reloadData').disabled=false;}
}
async function checkAdmin() {
  isAdmin=false;
  if (!db) return false;
  const {data:{user},error} = await db.auth.getUser();
  if(error || !user) return false;
  const result = await db.from('calendar_admins').select('user_id').eq('user_id',user.id).maybeSingle();
  isAdmin = !result.error && !!result.data;
  return isAdmin;
}
function closeAdmin() {
  byId('editorDialog').close();
  byId('adminDialog').close();
  byId('eventEditor').reset();
  editingId = null;
  editingVersion = null;
}
function renderAdminList() {
  const list=byId('adminList');list.replaceChildren();
  if(!isAdmin)return;
  const q=byId('adminSearch').value.toLowerCase();
  masterEvents.filter(e=>(e.title+' '+e.responsible).toLowerCase().includes(q)).sort((a,b)=>a.date.localeCompare(b.date)).forEach(e=>{
    const row=document.createElement('div');row.className='admin-row';
    const label=document.createElement('span');label.textContent=e.date+' · '+e.title;
    const button=document.createElement('button');button.textContent='แก้ไข';button.setAttribute('aria-label','แก้ไข '+e.title);
    button.addEventListener('click', () => openEditor(e));

    const del = document.createElement('button');
    del.textContent = 'ลบ';
    del.type = 'button';
    del.style.color = '#991b1b';
    del.style.borderColor = '#fecaca';
    
    del.addEventListener('click', () => deleteEvent(e));
    
    const actions = document.createElement('div');
    actions.className = 'admin-actions';
    actions.style.margin = '0';
    
    actions.append(button, del);
    row.append(label, actions);
    list.append(row);
  });
  if(!list.childElementCount)list.textContent='ไม่พบกิจกรรม';
  }
  async function deleteEvent(event) {
    if (!isAdmin || !db || busy) return;
  
    const confirmed = confirm(
      `ยืนยันลบกิจกรรมนี้อย่างถาวร?\n\n` +
      `${event.title}\nวันที่ ${event.date}\n\n` +
      `เมื่อลบแล้วจะไม่สามารถกู้คืนจากหน้าเว็บได้`
    );
  
    if (!confirmed) return;
  
    busy = true;
    byId('adminStatus').textContent = 'กำลังลบกิจกรรม…';
  
    try {
      if (!await checkAdmin()) {
        throw new Error('ไม่มีสิทธิ์แอดมิน');
      }
  
      const { data, error } = await db
        .from('calendar_events')
        .delete()
        .eq('id', event.id)
        .eq('updated_at', event.updated_at)
        .select('id');
  
      if (error) throw error;
  
      if (!data || data.length !== 1) {
        throw new Error(
          'ไม่พบข้อมูลเดิม หรือกิจกรรมถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่'
        );
      }
  
      const index = masterEvents.findIndex(
        x => x.id === event.id
      );
  
      if (index !== -1) {
        masterEvents.splice(index, 1);
      }
  
      repaint();
  
      byId('adminStatus').textContent =
        'ลบกิจกรรมเรียบร้อยแล้ว';
  
    } catch (err) {
      byId('adminStatus').textContent =
        'ลบไม่สำเร็จ: ' + err.message;
    } finally {
      busy = false;
    }
  }
function openEditor(event=null) {
  if(!isAdmin || busy)return;
  const form=byId('eventEditor');form.reset();editingId=event?.id||null;editingVersion=event?.updated_at||null;
  pendingId=event?.id||crypto.randomUUID();
  byId('editorHeading').textContent=event?'แก้ไขกิจกรรม':'เพิ่มกิจกรรม';byId('editorStatus').textContent='';
  fields.forEach(k=>form.elements[k].value=event?event[k]||'':k==='category'?'risk':'');
  form.elements.isDeadline.checked=!!event?.isDeadline;
  form.elements.endDate.setCustomValidity('');byId('editorDialog').showModal();
}
async function saveEvent(e) {
  e.preventDefault();if(busy || !db)return;
  const form=byId('eventEditor');const item={id:pendingId};
  fields.forEach(k=>item[k]=form.elements[k].value.trim());item.endDate ||= item.date;
  if(!item.title){byId('editorStatus').textContent='กรุณากรอกชื่อกิจกรรม';return;}
  if(item.endDate<item.date){form.elements.endDate.setCustomValidity('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม');form.elements.endDate.reportValidity();return;}
  item.isDeadline=form.elements.isDeadline.checked;
  busy=true;form.querySelector('[type=submit]').disabled=true;byId('editorStatus').textContent='กำลังบันทึก…';
  try {
    if(!await checkAdmin())throw new Error('ไม่มีสิทธิ์แอดมินหรือเซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    let query;
    if(editingId){const {id,...changes}=item;query=db.from('calendar_events').update(changes).eq('id',editingId).eq('updated_at',editingVersion);}
    else query=db.from('calendar_events').insert(item);
    const {data,error}=await query.select().single();
    if(error){
      if(error.code==='PGRST116')throw new Error('ข้อมูลถูกแก้ไขจากที่อื่นแล้ว กรุณาปิดฟอร์ม โหลดข้อมูลใหม่ แล้วแก้ไขอีกครั้ง');
      if(error.code==='23505')throw new Error('รายการนี้ถูกบันทึกแล้ว กรุณาปิดฟอร์มและโหลดข้อมูลใหม่');
      throw new Error('บันทึกไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อและสิทธิ์แอดมิน แล้วลองใหม่');
    }
    const i=masterEvents.findIndex(x=>x.id===data.id);if(i<0)masterEvents.push(data);else masterEvents[i]=data;
    [currentYear,currentMonth]=data.date.split('-').map(Number);currentMonth--;
    repaint();byId('editorDialog').close();byId('adminStatus').textContent='บันทึกลงฐานข้อมูลกลางและเผยแพร่แล้ว';
    byId('connectionStatus').textContent='บันทึกข้อมูลล่าสุดลงฐานข้อมูลกลางแล้ว';
  } catch(error){byId('editorStatus').textContent=error.message;}
  finally {busy=false;form.querySelector('[type=submit]').disabled=false;}
}
window.addEventListener('DOMContentLoaded',async()=>{
  byId('adminClose').onclick=()=>byId('adminDialog').close();
  byId('loginClose').onclick=()=>byId('loginDialog').close();
  byId('loginDialog').addEventListener('close',()=>byId('loginForm').elements.password.value='');
  byId('cancelEdit').onclick=()=>{if(!busy)byId('editorDialog').close();};
  byId('editorDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  byId('adminSearch').oninput=renderAdminList;
  byId('addEvent').onclick=()=>openEditor();
  byId('eventEditor').addEventListener('submit',saveEvent);
  byId('eventEditor').oninput=()=>byId('eventEditor').elements.endDate.setCustomValidity('');
  byId('reloadData').onclick=loadEvents;
  byId('adminBtn').onclick=async()=>{
    if(!db){byId('connectionStatus').textContent='ยังไม่ได้เชื่อมต่อ Supabase กรุณาตั้งค่า config.js ตามคู่มือ';return;}
    try {
      if(await checkAdmin()){renderAdminList();byId('adminDialog').showModal();}
      else {closeAdmin();byId('loginStatus').textContent='';byId('loginDialog').showModal();}
    }catch(_){byId('connectionStatus').textContent='ตรวจสอบสิทธิ์ไม่สำเร็จ กรุณาลองอีกครั้ง';}
  };
  byId('loginForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!db)return;
    const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;byId('loginStatus').textContent='กำลังเข้าสู่ระบบ…';
    try {
      const {error}=await db.auth.signInWithPassword({email:form.elements.email.value.trim(),password:form.elements.password.value});
      if(error)throw new Error('เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบอีเมล รหัสผ่าน และการเชื่อมต่อ');
      if(!await checkAdmin()){await db.auth.signOut({scope:'local'});throw new Error('บัญชีนี้ยังไม่ได้รับสิทธิ์แอดมิน กรุณาติดต่อผู้ดูแลระบบ');}
      byId('loginDialog').close();
      renderAdminList();
      renderCalendar();
      byId('adminDialog').showModal();
    }catch(error){byId('loginStatus').textContent=error.message;}
    finally{form.elements.password.value='';button.disabled=false;}
  });
  byId('logoutBtn').onclick=async()=>{
    if(busy)return;
    const {error}=await db.auth.signOut({scope:'local'});
    if(error){byId('adminStatus').textContent='ออกจากระบบไม่สำเร็จ กรุณาลองใหม่';return;}
    isAdmin = false;
    closeAdmin();byId('loginForm').reset();
  };
  const config=window.APP_CONFIG||{};
  if(!/^https:\/\/[^/]+$/.test(config.supabaseUrl||'') || !config.supabasePublishableKey || !window.supabase){
    byId('connectionStatus').textContent='ยังไม่ได้เชื่อมต่อฐานข้อมูล — ตั้งค่า Supabase ใน config.js ก่อนใช้งาน';return;
  }
  try{
    db=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,storage:window.sessionStorage,autoRefreshToken:true,detectSessionInUrl:false}});
     db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      isAdmin = false;
      closeAdmin();
      renderCalendar();
      renderTable();
      renderAdminList();
    }
  });
    await loadEvents();
    await checkAdmin();
    // Refresh when readers return to the tab. No polling and no local event database.
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy&&!byId('editorDialog').open)loadEvents();});
  }catch(_){byId('connectionStatus').textContent='เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบ config.js และการเชื่อมต่อ';}
});
