/* ================================================
   LOVE ALARM - Main Application JavaScript
   ================================================ */
'use strict';

// ============================================================
//  STATE
// ============================================================
const State = {
  alarms: [],           // { id, hour, minute, label, isEnabled, repeatDays:[], vibrate, snoozeEnabled, partnerSoundUri }
  editingAlarmId: null, // null = new alarm
  currentScreen: 'alarm-list',
  previousScreen: null,
  user: null,           // Firebase user
  myProfile: null,      // Firestore profile
  partnerProfile: null,
  partnerAlarms: [],    // alarms shared by partner
  unsubscribeFns: [],   // Firestore listener cleanup
  alarmTimers: {},      // { alarmId: timeoutId }
  ringingAlarm: null,   // currently ringing alarm object
  mediaPlayer: null,    // Audio object
  audioCtx: null,       // AudioContext for beep fallback
  recordingState: {
    isRecording: false,
    mediaRecorder: null,
    chunks: [],
    timerInterval: null,
    seconds: 0,
    targetAlarmId: null
  }
};

// ============================================================
//  UTILS
// ============================================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function pad(n) { return String(n).padStart(2, '0'); }

function showToast(msg, duration = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  requestAnimationFrame(() => {
    t.classList.add('show');
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.classList.add('hidden'), 300);
    }, duration);
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getRepeatLabel(days) {
  if (!days || days.length === 0) return '';
  if (days.length === 7) return '매일';
  const weekdays = [1, 2, 3, 4, 5];
  const weekend = [0, 6];
  if (weekdays.every(d => days.includes(d)) && days.length === 5) return '주중';
  if (weekend.every(d => days.includes(d)) && days.length === 2) return '주말';
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  return days.map(d => names[d]).join(', ');
}

function formatTime(hour, minute) {
  const ampm = hour < 12 ? '오전' : '오후';
  let h = hour % 12; if (h === 0) h = 12;
  return { ampm, time: `${h}:${pad(minute)}` };
}

// ============================================================
//  LOCAL STORAGE
// ============================================================
function saveAlarms() {
  localStorage.setItem('love_alarms', JSON.stringify(State.alarms));
}

function loadAlarms() {
  try {
    const raw = localStorage.getItem('love_alarms');
    State.alarms = raw ? JSON.parse(raw) : [];
  } catch { State.alarms = []; }
}

function saveProfile(profile) {
  localStorage.setItem('love_profile', JSON.stringify(profile));
}

function loadProfile() {
  try {
    const raw = localStorage.getItem('love_profile');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ============================================================
//  SCREEN NAVIGATION
// ============================================================
function navigateTo(screenId, fromId = null) {
  const screens = $$('.screen');
  const target = $(`#screen-${screenId}`);
  const current = $(`#screen-${State.currentScreen}`);

  if (!target) return;

  State.previousScreen = fromId || State.currentScreen;
  State.currentScreen = screenId;

  screens.forEach(s => {
    s.classList.remove('active', 'slide-left');
  });

  if (current) current.classList.add('slide-left');
  target.classList.add('active');
}

function goBack() {
  const prev = State.previousScreen || 'alarm-list';
  const target = $(`#screen-${prev}`);
  const current = $(`#screen-${State.currentScreen}`);

  if (!target) return;

  target.classList.remove('slide-left');
  target.classList.add('active');

  if (current) {
    current.classList.remove('active');
    setTimeout(() => current.classList.remove('slide-left'), 350);
  }

  State.previousScreen = null;
  State.currentScreen = prev;
}

// ============================================================
//  ALARM LIST RENDER
// ============================================================
function renderAlarmList() {
  const container = $('#alarm-list-sections');
  const empty = $('#alarm-list-empty');

  if (State.alarms.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const enabled = State.alarms.filter(a => a.isEnabled);
  const disabled = State.alarms.filter(a => !a.isEnabled);

  let html = '';

  if (enabled.length > 0) {
    html += `<div class="list-section-title">활성</div>`;
    enabled.forEach(a => { html += buildAlarmCardHTML(a); });
  }
  if (disabled.length > 0) {
    html += `<div class="list-section-title">비활성</div>`;
    disabled.forEach(a => { html += buildAlarmCardHTML(a); });
  }

  container.innerHTML = html;
  attachAlarmCardEvents();
}

function buildAlarmCardHTML(alarm) {
  const { ampm, time } = formatTime(alarm.hour, alarm.minute);
  const repeatLabel = getRepeatLabel(alarm.repeatDays);
  const disabledClass = alarm.isEnabled ? '' : 'disabled-card';
  const partnerBadge = alarm.partnerSoundUri
    ? `<div class="alarm-partner-badge"><i class="fas fa-heart"></i> 파트너 알람음</div>`
    : '';

  return `
    <div class="alarm-card-wrap" data-id="${alarm.id}">
      <div class="alarm-card-delete-bg"><i class="fas fa-trash"></i></div>
      <div class="alarm-card-inner">
        <div class="alarm-card ${disabledClass}" data-id="${alarm.id}">
          <div class="alarm-card-left">
            <div class="alarm-time-row">
              <span class="alarm-ampm">${ampm}</span>
              <span class="alarm-time">${time}</span>
            </div>
            ${alarm.label ? `<div class="alarm-label">${alarm.label}</div>` : ''}
            ${repeatLabel ? `<div class="alarm-repeat">${repeatLabel}</div>` : ''}
            ${partnerBadge}
          </div>
          <label class="ios-toggle" onclick="event.stopPropagation()">
            <input type="checkbox" class="alarm-toggle" data-id="${alarm.id}" ${alarm.isEnabled ? 'checked' : ''} />
            <span class="ios-slider"></span>
          </label>
        </div>
      </div>
    </div>`;
}

function attachAlarmCardEvents() {
  // Click to edit
  $$('.alarm-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.ios-toggle')) return;
      const id = card.dataset.id;
      openEditAlarm(id);
    });
  });

  // Toggle enable/disable
  $$('.alarm-toggle').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const id = toggle.dataset.id;
      const alarm = State.alarms.find(a => a.id === id);
      if (!alarm) return;
      alarm.isEnabled = toggle.checked;
      saveAlarms();
      scheduleAlarms();
      renderAlarmList();
    });
  });

  // Swipe to delete
  $$('.alarm-card-wrap').forEach(wrap => attachSwipeDelete(wrap));
}

// ============================================================
//  SWIPE TO DELETE
// ============================================================
function attachSwipeDelete(wrap) {
  const inner = wrap.querySelector('.alarm-card-inner');
  const bg = wrap.querySelector('.alarm-card-delete-bg');
  let startX = 0, isDragging = false, currentX = 0;
  const THRESHOLD = 100;

  function onStart(x) {
    startX = x;
    isDragging = true;
  }
  function onMove(x) {
    if (!isDragging) return;
    const dx = Math.min(0, x - startX);
    currentX = dx;
    if (dx < -10) {
      inner.style.transform = `translateX(${dx}px)`;
      bg.classList.toggle('show', dx < -THRESHOLD / 2);
    }
  }
  function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    if (currentX < -THRESHOLD) {
      inner.style.transform = `translateX(-110%)`;
      bg.classList.add('show');
      setTimeout(() => {
        const id = wrap.dataset.id;
        deleteAlarm(id);
      }, 250);
    } else {
      inner.style.transform = '';
      bg.classList.remove('show');
    }
    currentX = 0;
  }

  wrap.addEventListener('touchstart', e => onStart(e.touches[0].clientX), { passive: true });
  wrap.addEventListener('touchmove', e => onMove(e.touches[0].clientX), { passive: true });
  wrap.addEventListener('touchend', onEnd);

  // Desktop mouse fallback
  wrap.addEventListener('mousedown', e => { if (e.button === 0) onStart(e.clientX); });
  document.addEventListener('mousemove', e => { if (isDragging) onMove(e.clientX); });
  document.addEventListener('mouseup', () => { if (isDragging) onEnd(); });
}

// ============================================================
//  ADD / EDIT ALARM SCREEN
// ============================================================
let tpHour = 7, tpMinute = 0, tpAmPm = 'AM';

function openAddAlarm() {
  State.editingAlarmId = null;
  $('#add-alarm-title').textContent = '알람 추가';
  $('#delete-alarm-wrap').classList.add('hidden');
  $('#alarm-label').value = '';
  $('#alarm-snooze').checked = true;
  $('#alarm-vibrate').checked = true;
  $$('.day-btn').forEach(b => b.classList.remove('selected'));

  tpHour = 7; tpMinute = 0; tpAmPm = 'AM';
  updateTimePicker();
  navigateTo('add-alarm', 'alarm-list');
}

function openEditAlarm(id) {
  const alarm = State.alarms.find(a => a.id === id);
  if (!alarm) return;

  State.editingAlarmId = id;
  $('#add-alarm-title').textContent = '알람 편집';
  $('#delete-alarm-wrap').classList.remove('hidden');
  $('#alarm-label').value = alarm.label;
  $('#alarm-snooze').checked = alarm.snoozeEnabled;
  $('#alarm-vibrate').checked = alarm.vibrate;

  // Days
  $$('.day-btn').forEach(b => {
    const day = parseInt(b.dataset.day);
    b.classList.toggle('selected', alarm.repeatDays.includes(day));
  });

  // Time
  tpAmPm = alarm.hour < 12 ? 'AM' : 'PM';
  tpHour = alarm.hour % 12 || 12;
  tpMinute = alarm.minute;
  updateTimePicker();
  navigateTo('add-alarm', 'alarm-list');
}

function updateTimePicker() {
  $('#tp-hour').textContent = pad(tpHour === 0 ? 12 : tpHour);
  $('#tp-minute').textContent = pad(tpMinute);
  $('#tp-ampm').textContent = tpAmPm === 'AM' ? '오전' : '오후';
}

function saveAlarm() {
  let hour24 = tpHour % 12;
  if (tpAmPm === 'PM') hour24 += 12;
  if (tpAmPm === 'AM' && tpHour === 12) hour24 = 0;

  const label = $('#alarm-label').value.trim();
  const snoozeEnabled = $('#alarm-snooze').checked;
  const vibrate = $('#alarm-vibrate').checked;
  const repeatDays = $$('.day-btn.selected').map(b => parseInt(b.dataset.day));

  if (State.editingAlarmId) {
    const alarm = State.alarms.find(a => a.id === State.editingAlarmId);
    if (alarm) {
      alarm.hour = hour24;
      alarm.minute = tpMinute;
      alarm.label = label;
      alarm.snoozeEnabled = snoozeEnabled;
      alarm.vibrate = vibrate;
      alarm.repeatDays = repeatDays;
    }
    showToast('알람이 수정되었습니다');
  } else {
    const newAlarm = {
      id: generateId(),
      hour: hour24,
      minute: tpMinute,
      label,
      isEnabled: true,
      repeatDays,
      vibrate,
      snoozeEnabled,
      partnerSoundUri: null,
      soundUri: 'default',
      createdAt: Date.now()
    };
    State.alarms.push(newAlarm);
    showToast('알람이 추가되었습니다');
  }

  saveAlarms();
  scheduleAlarms();
  syncMyAlarmsToFirebase();
  goBack();
  renderAlarmList();
}

function deleteAlarm(id) {
  const idx = State.alarms.findIndex(a => a.id === id);
  if (idx === -1) return;
  State.alarms.splice(idx, 1);
  saveAlarms();
  scheduleAlarms();
  syncMyAlarmsToFirebase();
  renderAlarmList();
  showToast('알람이 삭제되었습니다');
}

// ============================================================
//  ALARM SCHEDULING (Web-based)
// ============================================================
function scheduleAlarms() {
  // Clear existing web timers
  Object.values(State.alarmTimers).forEach(t => clearTimeout(t));
  State.alarmTimers = {};

  State.alarms.filter(a => a.isEnabled).forEach(alarm => {
    scheduleNextTrigger(alarm);
  });
}

function scheduleNextTrigger(alarm) {
  const ms = getNextAlarmMs(alarm);
  if (ms <= 0) return;

  // Capacitor 네이티브 환경: 로컬 알림 사용 (화면 꺼져도 울림!)
  if (typeof isCapacitor === 'function' && isCapacitor()) {
    scheduleNativeAlarm(alarm);
    return;
  }

  // 웹 환경: setTimeout 사용 (앱이 열려있을 때만 울림)
  const timer = setTimeout(() => {
    triggerAlarm(alarm);
    if (alarm.repeatDays && alarm.repeatDays.length > 0) {
      setTimeout(() => scheduleNextTrigger(alarm), 1000);
    }
  }, ms);

  State.alarmTimers[alarm.id] = timer;

  // Service Worker 백그라운드 알림
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'SCHEDULE_ALARM',
      alarmId: alarm.id,
      triggerMs: Date.now() + ms,
      label: alarm.label
    });
  }
}

function getNextAlarmMs(alarm) {
  const now = new Date();
  const target = new Date();
  target.setHours(alarm.hour, alarm.minute, 0, 0);

  if (alarm.repeatDays && alarm.repeatDays.length > 0) {
    const todayDay = now.getDay();
    for (let i = 0; i <= 7; i++) {
      const checkDay = (todayDay + i) % 7;
      if (alarm.repeatDays.includes(checkDay)) {
        const candidate = new Date(now);
        candidate.setDate(now.getDate() + i);
        candidate.setHours(alarm.hour, alarm.minute, 0, 0);
        if (candidate > now) {
          return candidate.getTime() - now.getTime();
        }
      }
    }
  } else {
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }
  return -1;
}

// ============================================================
//  ALARM RINGING
// ============================================================
function triggerAlarm(alarm) {
  State.ringingAlarm = alarm;

  // Show ringing screen
  const ringing = $('#screen-ringing');
  ringing.classList.remove('hidden-ringing');
  ringing.classList.add('show-ringing');

  // Update time display
  const now = new Date();
  const { ampm, time } = formatTime(now.getHours(), now.getMinutes());
  $('#ringing-ampm').textContent = ampm;
  $('#ringing-time').textContent = time;
  $('#ringing-label').textContent = alarm.label || '';

  // Show/hide snooze button
  $('#btn-ringing-snooze').style.display = alarm.snoozeEnabled ? 'block' : 'none';

  // Play sound
  playAlarmSound(alarm);

  // Vibrate
  if (alarm.vibrate && 'vibrate' in navigator) {
    navigator.vibrate([800, 400, 800, 400, 800, 400, 800]);
  }

  // Service Worker notification (background)
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'ALARM_TRIGGER',
      label: alarm.label || '알람이 울리고 있습니다'
    });
  }
}

function stopRinging() {
  stopAlarmSound();
  if ('vibrate' in navigator) navigator.vibrate(0);
  const ringing = $('#screen-ringing');
  ringing.classList.remove('show-ringing');
  ringing.classList.add('hidden-ringing');
  State.ringingAlarm = null;
}

function snoozeAlarm() {
  const alarm = State.ringingAlarm;
  stopRinging();
  if (!alarm) return;

  setTimeout(() => {
    triggerAlarm(alarm);
  }, 5 * 60 * 1000); // 5 minutes

  showToast('5분 후 다시 알립니다');
}

// Swipe gesture on ringing screen
let ringingTouchStartY = 0;
$('#screen-ringing').addEventListener('touchstart', e => {
  ringingTouchStartY = e.touches[0].clientY;
}, { passive: true });
$('#screen-ringing').addEventListener('touchend', e => {
  const dy = e.changedTouches[0].clientY - ringingTouchStartY;
  if (dy < -100) stopRinging();
  else if (dy > 100 && State.ringingAlarm?.snoozeEnabled) snoozeAlarm();
});

// ============================================================
//  AUDIO
// ============================================================
function playAlarmSound(alarm) {
  stopAlarmSound();

  const soundUrl = alarm.partnerSoundUri || alarm.soundUri || 'default';

  if (soundUrl !== 'default' && soundUrl.startsWith('http')) {
    // Remote URL streaming
    const audio = new Audio(soundUrl);
    audio.loop = true;
    audio.volume = 0.8;
    audio.play().catch(() => playBeepFallback());
    State.mediaPlayer = audio;
  } else {
    // Web Audio API beep alarm
    playBeepFallback();
  }
}

function playBeepFallback() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    State.audioCtx = ctx;

    function beep() {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    }

    beep();
    State._beepInterval = setInterval(beep, 1200);
  } catch(e) {
    console.warn('Audio not available', e);
  }
}

function stopAlarmSound() {
  if (State.mediaPlayer) {
    State.mediaPlayer.pause();
    State.mediaPlayer.src = '';
    State.mediaPlayer = null;
  }
  if (State.audioCtx) {
    State.audioCtx.close();
    State.audioCtx = null;
  }
  if (State._beepInterval) {
    clearInterval(State._beepInterval);
    State._beepInterval = null;
  }
}

// ============================================================
//  FIREBASE AUTH & PROFILE
// ============================================================
function getFirebase() { return window._fb || null; }

async function fbSignUp(email, password, nickname) {
  const fb = getFirebase();
  if (!fb) { showFirebaseConfigError(); return; }

  const { auth, db, createUserWithEmailAndPassword, setDoc, doc } = fb;
  const result = await createUserWithEmailAndPassword(auth, email, password);
  const user = result.user;
  const code = generateCode();
  const profile = {
    uid: user.uid, email, nickname,
    connectionCode: code,
    connectedPartnerUid: null,
    createdAt: Date.now()
  };
  await setDoc(doc(db, 'users', user.uid), profile);
  return profile;
}

async function fbSignIn(email, password) {
  const fb = getFirebase();
  if (!fb) { showFirebaseConfigError(); return; }
  const { auth, signInWithEmailAndPassword } = fb;
  await signInWithEmailAndPassword(auth, email, password);
}

async function fbSignOut() {
  const fb = getFirebase();
  if (fb) await fb.signOut(fb.auth);
  State.user = null;
  State.myProfile = null;
  State.partnerProfile = null;
  State.partnerAlarms = [];
  cleanupFirestoreListeners();
  // localStorage 프로필 초기화
  localStorage.removeItem('love_profile');
  // 로그인/회원가입 폼 초기화
  $('#auth-email').value = '';
  $('#auth-password').value = '';
  $('#auth-nickname').value = '';
  setAuthMode(false); // 로그인 모드로 리셋
  updateConnectionUI();
}

async function loadMyProfile() {
  const fb = getFirebase();
  if (!fb || !State.user) return null;
  const { db, doc, getDoc } = fb;
  const snap = await getDoc(doc(db, 'users', State.user.uid));
  if (snap.exists()) {
    State.myProfile = snap.data();
    saveProfile(State.myProfile);
    return State.myProfile;
  }
  return null;
}

async function loadPartnerProfile() {
  const fb = getFirebase();
  if (!fb || !State.myProfile?.connectedPartnerUid) return null;
  const { db, doc, getDoc } = fb;
  const snap = await getDoc(doc(db, 'users', State.myProfile.connectedPartnerUid));
  if (snap.exists()) {
    State.partnerProfile = snap.data();
    return State.partnerProfile;
  }
  return null;
}

function initAuthListener() {
  const fb = getFirebase();
  if (!fb) {
    // Offline mode - use local profile
    State.myProfile = loadProfile();
    updateConnectionUI();
    return;
  }

  fb.onAuthStateChanged(fb.auth, async (user) => {
    State.user = user;
    if (user) {
      await loadMyProfile();
      await loadPartnerProfile();
      subscribeToAlarmSounds();
      subscribeToPartnerAlarms();
    } else {
      State.myProfile = null;
      State.partnerProfile = null;
      State.partnerAlarms = [];
      cleanupFirestoreListeners();
    }
    updateConnectionUI();
  });
}

// ============================================================
//  FIRESTORE REALTIME LISTENERS
// ============================================================
function cleanupFirestoreListeners() {
  State.unsubscribeFns.forEach(fn => { try { fn(); } catch(e) {} });
  State.unsubscribeFns = [];
}

function subscribeToAlarmSounds() {
  const fb = getFirebase();
  if (!fb || !State.user) return;
  const { db, collection, onSnapshot } = fb;

  const col = collection(db, 'users', State.user.uid, 'alarm_sounds');
  const unsub = onSnapshot(col, snap => {
    snap.docChanges().forEach(change => {
      const data = change.doc.data();
      const alarmId = change.doc.id;
      const alarm = State.alarms.find(a => a.id === alarmId);
      if (alarm && change.type !== 'removed') {
        alarm.partnerSoundUri = data.soundUrl || null;
        saveAlarms();
        scheduleAlarms();
        renderAlarmList();
        showToast('♥ 파트너가 알람음을 변경했어요!');
      } else if (alarm && change.type === 'removed') {
        alarm.partnerSoundUri = null;
        saveAlarms();
        renderAlarmList();
      }
    });
  }, err => console.warn('AlarmSounds listener error', err));

  State.unsubscribeFns.push(unsub);
}

function subscribeToPartnerAlarms() {
  const fb = getFirebase();
  if (!fb || !State.myProfile?.connectedPartnerUid) return;
  const { db, collection, onSnapshot } = fb;

  const partnerUid = State.myProfile.connectedPartnerUid;
  const col = collection(db, 'users', partnerUid, 'shared_alarms');
  const unsub = onSnapshot(col, snap => {
    State.partnerAlarms = snap.docs.map(d => d.data());
    renderPartnerAlarmList();
  }, err => console.warn('PartnerAlarms listener error', err));

  State.unsubscribeFns.push(unsub);
}

async function syncMyAlarmsToFirebase() {
  const fb = getFirebase();
  if (!fb || !State.user) return;
  const { db, collection, getDocs, setDoc, deleteDoc, doc } = fb;

  try {
    const col = collection(db, 'users', State.user.uid, 'shared_alarms');

    // Delete existing
    const existing = await getDocs(col);
    await Promise.all(existing.docs.map(d => deleteDoc(d.ref)));

    // Re-upload enabled alarms
    const enabledAlarms = State.alarms.filter(a => a.isEnabled);
    await Promise.all(enabledAlarms.map(alarm =>
      setDoc(doc(db, 'users', State.user.uid, 'shared_alarms', alarm.id), {
        alarmId: alarm.id,
        hour: alarm.hour,
        minute: alarm.minute,
        label: alarm.label,
        isEnabled: alarm.isEnabled
      })
    ));
  } catch(e) {
    console.warn('Sync to Firebase failed', e);
  }
}

// ============================================================
//  CONNECTION LOGIC
// ============================================================
async function connectWithCode(code) {
  const fb = getFirebase();
  if (!fb) {
    showToast('Firebase 설정이 필요합니다');
    return;
  }

  const { db, collection, query, where, getDocs, updateDoc, doc } = fb;
  if (!State.user) return;

  try {
    const q = query(collection(db, 'users'), where('connectionCode', '==', code.toUpperCase()));
    const snap = await getDocs(q);

    if (snap.empty) throw new Error('유효하지 않은 코드입니다');

    const partnerDoc = snap.docs[0];
    const partnerUid = partnerDoc.data().uid;

    if (partnerUid === State.user.uid) throw new Error('자기 자신과는 연결할 수 없습니다');

    await updateDoc(doc(db, 'users', State.user.uid), { connectedPartnerUid: partnerUid });
    await updateDoc(doc(db, 'users', partnerUid), { connectedPartnerUid: State.user.uid });

    State.partnerProfile = partnerDoc.data();
    if (State.myProfile) State.myProfile.connectedPartnerUid = partnerUid;

    subscribeToPartnerAlarms();
    updateConnectionUI();
    showToast(`♥ ${State.partnerProfile.nickname}님과 연결되었습니다!`);
    return State.partnerProfile;
  } catch(e) {
    throw e;
  }
}

async function disconnectPartner() {
  const fb = getFirebase();
  if (!fb || !State.user || !State.myProfile?.connectedPartnerUid) return;
  const { db, updateDoc, doc } = fb;
  const partnerUid = State.myProfile.connectedPartnerUid;

  await updateDoc(doc(db, 'users', State.user.uid), { connectedPartnerUid: null });
  await updateDoc(doc(db, 'users', partnerUid), { connectedPartnerUid: null });

  State.partnerProfile = null;
  if (State.myProfile) State.myProfile.connectedPartnerUid = null;
  State.partnerAlarms = [];
  cleanupFirestoreListeners();
  updateConnectionUI();
  showToast('연결이 해제되었습니다');
}

// ============================================================
//  SIGNUP SUCCESS - 코드 공유 화면
// ============================================================
function showSignupSuccess(code) {
  $('#auth-section').classList.add('hidden');
  $('#signup-success-section').classList.remove('hidden');
  $('#signup-code-display').textContent = code || '------';
}

function hideSignupSuccess() {
  $('#signup-success-section').classList.add('hidden');
  $('#auth-section').classList.add('hidden');
  updateConnectionUI();
}

function shareCode(code) {
  const msg = `Love Alarm 연결 코드: ${code}\n앱에서 이 코드를 입력해서 나와 연결해요! 💕`;
  if (navigator.share) {
    navigator.share({ title: 'Love Alarm 연결 코드', text: msg }).catch(() => {});
  } else {
    navigator.clipboard.writeText(code).then(() => showToast('코드가 복사되었습니다! 상대에게 공유하세요 💕'));
  }
}

function shareViaKakao(code) {
  // 카카오 SDK 미설치 시 Web Share API 또는 클립보드로 폴백
  const msg = `Love Alarm 연결 코드: ${code}\n앱에서 이 코드를 입력해서 나와 연결해요! 💕`;
  if (navigator.share) {
    navigator.share({ title: 'Love Alarm 연결 코드', text: msg }).catch(() => {
      navigator.clipboard.writeText(code).then(() => showToast('코드가 복사되었습니다!'));
    });
  } else {
    const kakaoUrl = `https://sharer.kakao.com/talk/friends/picker/link?text=${encodeURIComponent(msg)}`;
    window.open(kakaoUrl, '_blank');
  }
}

function shareViaSms(code) {
  const msg = `Love Alarm 연결 코드: ${code} - 앱에서 이 코드를 입력해서 나와 연결해요! 💕`;
  window.location.href = `sms:?body=${encodeURIComponent(msg)}`;
}

// ============================================================
//  CONNECTION UI UPDATE
// ============================================================
function updateConnectionUI() {
  const authSection = $('#auth-section');
  const signupSuccessSection = $('#signup-success-section');
  const profileSection = $('#profile-section');
  const connectedSection = $('#connected-section');
  const notConnectedSection = $('#not-connected-section');

  const isLoggedIn = !!State.user || !!State.myProfile;

  // 항상 signup-success-section 숨기기 (hideSignupSuccess 이후 호출됨)
  if (signupSuccessSection) signupSuccessSection.classList.add('hidden');

  if (isLoggedIn && State.myProfile) {
    authSection.classList.add('hidden');
    profileSection.classList.remove('hidden');

    $('#profile-nickname').textContent = State.myProfile.nickname || '사용자';
    $('#profile-email').textContent = State.myProfile.email || '';
    $('#my-connection-code').textContent = State.myProfile.connectionCode || '------';

    const isConnected = !!State.partnerProfile;
    connectedSection.classList.toggle('hidden', !isConnected);
    notConnectedSection.classList.toggle('hidden', isConnected);

    if (isConnected) {
      $('#partner-nickname-display').textContent = State.partnerProfile.nickname;
      $('#partner-screen-title').textContent = `${State.partnerProfile.nickname}의 알람`;
    }
  } else {
    authSection.classList.remove('hidden');
    profileSection.classList.add('hidden');
  }
}

// ============================================================
//  PARTNER ALARM LIST RENDER
// ============================================================
function renderPartnerAlarmList() {
  const container = $('#partner-alarm-list');
  const empty = $('#partner-alarm-list-empty');

  if (State.partnerAlarms.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  let html = '';
  State.partnerAlarms.forEach(alarm => {
    const { ampm, time } = formatTime(alarm.hour, alarm.minute);
    const isMyAdded = alarm.isPartnerAdded && alarm.createdBy === State.user?.uid;
    const repeatLabel = getRepeatLabel(alarm.repeatDays || []);
    html += `
      <div class="partner-alarm-card" data-alarm-id="${alarm.alarmId}">
        <div class="partner-alarm-info">
          <div class="alarm-time-row">
            <span class="alarm-ampm">${ampm}</span>
            <span class="alarm-time" style="font-size:38px;">${time}</span>
          </div>
          ${alarm.label ? `<div class="alarm-label">${alarm.label}</div>` : ''}
          ${repeatLabel ? `<div class="alarm-repeat" style="color:var(--text-secondary);font-size:12px;">${repeatLabel}</div>` : ''}
          ${isMyAdded ? `<div class="pa-added-badge">💕 내가 추가한 알람</div>` : ''}
          <div id="upload-status-${alarm.alarmId}" class="alarm-repeat"></div>
        </div>
        <div class="partner-alarm-actions">
          ${isMyAdded ? `<button class="icon-btn delete-pa-btn" data-alarm-id="${alarm.alarmId}" title="알람 삭제" style="color: var(--accent-red);"><i class="fas fa-trash"></i></button>` : ''}
          <button class="icon-btn record-btn" data-alarm-id="${alarm.alarmId}" title="직접 녹음">
            <i class="fas fa-microphone"></i>
          </button>
          <button class="icon-btn upload-btn" data-alarm-id="${alarm.alarmId}" title="파일 업로드">
            <i class="fas fa-upload"></i>
          </button>
        </div>
      </div>`;
  });

  container.innerHTML = html;

  $$('.record-btn').forEach(btn => {
    btn.addEventListener('click', () => startRecording(btn.dataset.alarmId));
  });
  $$('.upload-btn').forEach(btn => {
    btn.addEventListener('click', () => pickAudioFile(btn.dataset.alarmId));
  });
  $$('.delete-pa-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 알람을 파트너 폰에서 삭제할까요?')) return;
      await deletePartnerAlarm(btn.dataset.alarmId);
    });
  });
}

// ============================================================
//  RECORDING
// ============================================================
let _recordingAlarmId = null;

function startRecording(alarmId) {
  if (!navigator.mediaDevices) {
    showToast('마이크 접근이 지원되지 않습니다');
    return;
  }
  _recordingAlarmId = alarmId;
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const mr = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
    State.recordingState.chunks = [];
    State.recordingState.mediaRecorder = mr;
    State.recordingState.isRecording = true;
    State.recordingState.seconds = 0;

    mr.ondataavailable = e => { if (e.data.size > 0) State.recordingState.chunks.push(e.data); };
    mr.start(100);

    // Show modal
    $('#recording-modal').classList.remove('hidden');
    $('#recording-timer').textContent = '00:00';

    State.recordingState.timerInterval = setInterval(() => {
      State.recordingState.seconds++;
      const m = Math.floor(State.recordingState.seconds / 60);
      const s = State.recordingState.seconds % 60;
      $('#recording-timer').textContent = `${pad(m)}:${pad(s)}`;
    }, 1000);

  }).catch(e => {
    showToast('마이크 권한이 필요합니다');
    console.warn(e);
  });
}

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'];
  for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
  return '';
}

function stopRecordingAndUpload() {
  const { mediaRecorder, chunks, timerInterval } = State.recordingState;
  if (!mediaRecorder) return;

  clearInterval(timerInterval);
  State.recordingState.timerInterval = null;
  State.recordingState.isRecording = false;

  mediaRecorder.onstop = async () => {
    const mimeType = getSupportedMimeType() || 'audio/webm';
    const blob = new Blob(chunks, { type: mimeType });
    const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    // Blob을 File 객체로 변환해서 직접 업로드
    const file = new File([blob], `recording_${Date.now()}.${ext}`, { type: mimeType });
    $('#recording-modal').classList.add('hidden');
    await uploadSoundFile(file, _recordingAlarmId);
    // Stop mic
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  };

  mediaRecorder.stop();
}

function cancelRecording() {
  const { mediaRecorder, timerInterval } = State.recordingState;
  if (timerInterval) clearInterval(timerInterval);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
    mediaRecorder.stop();
  }
  State.recordingState.isRecording = false;
  State.recordingState.mediaRecorder = null;
  State.recordingState.chunks = [];
  $('#recording-modal').classList.add('hidden');
}

// ============================================================
//  FILE UPLOAD
// ============================================================
function pickAudioFile(alarmId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    // File 객체를 직접 업로드 (Uint8Array 변환 불필요)
    await uploadSoundFile(file, alarmId);
  };
  input.click();
}

async function uploadSoundFile(file, alarmId) {
  const fb = getFirebase();
  if (!fb || !State.user) {
    showToast('로그인이 필요합니다');
    return;
  }

  const statusEl = $(`#upload-status-${alarmId}`);
  if (statusEl) statusEl.textContent = '업로드 준비 중...';

  const { storage, db, ref, uploadBytesResumable, getDownloadURL, doc, setDoc } = fb;
  const ext = file.name.split('.').pop() || 'mp3';
  const fileName = `alarm_sounds/${State.user.uid}/${Date.now()}.${ext}`;
  const storageRef = ref(storage, fileName);

  const metadata = { contentType: file.type || 'audio/mpeg' };
  const task = uploadBytesResumable(storageRef, file, metadata);

  task.on('state_changed',
    snap => {
      const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
      if (statusEl) statusEl.textContent = `업로드 중... ${pct}%`;
    },
    err => {
      console.error('Upload error:', err.code, err.message);
      if (statusEl) statusEl.textContent = `업로드 실패: ${err.code}`;
      showToast(`업로드 실패: ${err.code}`);
    },
    async () => {
      try {
        const url = await getDownloadURL(task.snapshot.ref);
        const partnerUid = State.myProfile?.connectedPartnerUid;
        if (!partnerUid) { showToast('파트너가 연결되어 있지 않습니다'); return; }

        await setDoc(doc(db, 'users', partnerUid, 'alarm_sounds', alarmId), {
          soundUrl: url,
          uploadedAt: Date.now(),
          uploadedBy: State.user.uid
        });

        if (statusEl) statusEl.textContent = '✅ 업로드 완료!';
        showToast('♥ 알람음이 설정되었습니다!');
      } catch(e) {
        console.error('Firestore write error:', e);
        if (statusEl) statusEl.textContent = '저장 실패';
        showToast('Firestore 저장 실패: ' + e.message);
      }
    }
  );
}

async function uploadSoundBytes(bytes, alarmId, ext = 'webm') {
  const fb = getFirebase();
  if (!fb || !State.user) {
    showToast('로그인이 필요합니다');
    return;
  }

  const statusEl = $(`#upload-status-${alarmId}`);
  if (statusEl) statusEl.textContent = '업로드 중...';

  const { storage, db, ref, uploadBytesResumable, getDownloadURL, doc, setDoc } = fb;
  const fileName = `alarm_sounds/${State.user.uid}/${Date.now()}.${ext}`;
  const storageRef = ref(storage, fileName);

  const task = uploadBytesResumable(storageRef, bytes);

  task.on('state_changed',
    snap => {
      const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
      if (statusEl) statusEl.textContent = `업로드 중... ${pct}%`;
    },
    err => {
      console.error(err);
      if (statusEl) statusEl.textContent = '업로드 실패';
      showToast('업로드에 실패했습니다');
    },
    async () => {
      const url = await getDownloadURL(task.snapshot.ref);
      const partnerUid = State.myProfile?.connectedPartnerUid;
      if (!partnerUid) { showToast('파트너가 연결되어 있지 않습니다'); return; }

      await setDoc(doc(db, 'users', partnerUid, 'alarm_sounds', alarmId), {
        soundUrl: url,
        uploadedAt: Date.now(),
        uploadedBy: State.user.uid
      });

      if (statusEl) statusEl.textContent = '✅ 업로드 완료!';
      showToast('♥ 알람음이 설정되었습니다!');
    }
  );
}

async function deletePartnerAlarm(alarmId) {
  const fb = getFirebase();
  if (!fb || !State.user || !State.myProfile?.connectedPartnerUid) return;
  const { db, doc, deleteDoc } = fb;
  const partnerUid = State.myProfile.connectedPartnerUid;
  try {
    await deleteDoc(doc(db, 'users', partnerUid, 'shared_alarms', alarmId));
    showToast('알람이 삭제되었습니다');
  } catch(e) {
    showToast('삭제 실패: ' + e.message);
  }
}

// ============================================================
//  PARTNER ALARM ADD (내가 파트너 폰에 알람 추가)
// ============================================================
let paHour = 7, paMinute = 0, paAmPm = 'AM';

function openAddPartnerAlarmModal() {
  if (!State.myProfile?.connectedPartnerUid) {
    showToast('파트너와 연결된 후 사용하세요 💕');
    return;
  }
  // 기본값 초기화
  paHour = 7; paMinute = 0; paAmPm = 'AM';
  updatePaTimePicker();
  $('#pa-alarm-label').value = '';
  $$('.pa-day-btn').forEach(b => b.classList.remove('selected'));
  $('#add-partner-alarm-modal').classList.remove('hidden');
}

function closePaModal() {
  $('#add-partner-alarm-modal').classList.add('hidden');
}

function updatePaTimePicker() {
  $('#pa-tp-hour').textContent = pad(paHour === 0 ? 12 : paHour);
  $('#pa-tp-minute').textContent = pad(paMinute);
  $('#pa-tp-ampm').textContent = paAmPm === 'AM' ? '오전' : '오후';
}

async function savePartnerAlarm() {
  const fb = getFirebase();
  if (!fb || !State.user || !State.myProfile?.connectedPartnerUid) {
    showToast('파트너 연결이 필요합니다');
    return;
  }

  // 시간 계산
  let hour24 = paHour % 12;
  if (paAmPm === 'PM') hour24 += 12;
  if (paAmPm === 'AM' && paHour === 12) hour24 = 0;

  const label = $('#pa-alarm-label').value.trim() || '♥ 파트너의 알람';
  const repeatDays = $$('.pa-day-btn.selected').map(b => parseInt(b.dataset.paDay));

  const partnerUid = State.myProfile.connectedPartnerUid;
  const alarmId = generateId();

  const btn = $('#btn-pa-save');
  const saveText = $('#pa-save-text');
  const spinner = $('#pa-save-spinner');
  btn.disabled = true;
  saveText.classList.add('hidden');
  spinner.classList.remove('hidden');

  try {
    const { db, doc, setDoc, collection } = fb;

    // 파트너의 shared_alarms 컬렉션에 직접 알람 추가
    await setDoc(doc(db, 'users', partnerUid, 'shared_alarms', alarmId), {
      alarmId,
      hour: hour24,
      minute: paMinute,
      label,
      isEnabled: true,
      repeatDays,
      createdBy: State.user.uid,         // 누가 만들었는지 기록
      createdByNickname: State.myProfile?.nickname || '파트너',
      isPartnerAdded: true,              // 파트너가 추가한 알람임을 표시
      createdAt: Date.now()
    });

    closePaModal();
    showToast(`💕 ${State.partnerProfile?.nickname || '파트너'}에게 알람을 추가했어요!`);
  } catch(e) {
    console.error('파트너 알람 추가 실패:', e);
    showToast('알람 추가에 실패했습니다: ' + e.message);
  } finally {
    btn.disabled = false;
    saveText.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
}

function bindPaModalEvents() {
  // 열기 버튼
  $('#btn-add-partner-alarm').addEventListener('click', openAddPartnerAlarmModal);

  // 취소 버튼
  $('#btn-pa-cancel').addEventListener('click', closePaModal);

  // 모달 배경 클릭 닫기
  $('#add-partner-alarm-modal').addEventListener('click', e => {
    if (e.target === $('#add-partner-alarm-modal')) closePaModal();
  });

  // 저장 버튼
  $('#btn-pa-save').addEventListener('click', savePartnerAlarm);

  // AM/PM 토글
  $('#pa-tp-ampm').addEventListener('click', () => {
    paAmPm = paAmPm === 'AM' ? 'PM' : 'AM';
    updatePaTimePicker();
  });

  // 시간 조절 버튼들
  $$('[data-pa-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.paAction;
      if (action === 'hour-up')   { paHour = paHour >= 12 ? 1 : paHour + 1; }
      if (action === 'hour-down') { paHour = paHour <= 1 ? 12 : paHour - 1; }
      if (action === 'min-up')    { paMinute = paMinute >= 59 ? 0 : paMinute + 1; }
      if (action === 'min-down')  { paMinute = paMinute <= 0 ? 59 : paMinute - 1; }
      updatePaTimePicker();
    });

    // 롱프레스 빠른 변경
    let iv;
    btn.addEventListener('pointerdown', () => { iv = setInterval(() => btn.click(), 120); });
    btn.addEventListener('pointerup',   () => clearInterval(iv));
    btn.addEventListener('pointerleave',() => clearInterval(iv));
  });

  // 요일 버튼
  $$('.pa-day-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('selected'));
  });
}


function showFirebaseConfigError() {
  showToast('⚠️ Firebase 설정을 완료해주세요', 4000);
}

function isFirebaseConfigured() {
  const fb = getFirebase();
  if (!fb) return false;
  try {
    const cfg = fb.auth.app.options;
    return cfg.apiKey && cfg.apiKey !== 'YOUR_API_KEY';
  } catch { return false; }
}

// ============================================================
//  AUTH UI LOGIC
// ============================================================
let isSignUpMode = false;

function setAuthMode(mode) {
  isSignUpMode = mode;
  $('#signup-extra').classList.toggle('hidden', !mode);
  $('#auth-btn-text').textContent = mode ? '회원가입' : '로그인';
  $('#btn-toggle-auth-mode').textContent = mode
    ? '이미 계정이 있으신가요? 로그인'
    : '계정이 없으신가요? 회원가입';
}

function showAuthError(msg) {
  const el = $('#auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function showConnectionError(msg) {
  const el = $('#connection-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function showConnectionSuccess(msg) {
  const el = $('#connection-success');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ============================================================
//  EVENT LISTENERS
// ============================================================
function bindEvents() {

  // --- Alarm List ---
  $('#btn-add-alarm-top').addEventListener('click', openAddAlarm);
  $('#btn-add-alarm-fab').addEventListener('click', openAddAlarm);
  $('#btn-go-connection').addEventListener('click', () => navigateTo('connection', 'alarm-list'));

  // --- Add/Edit Alarm ---
  $('#btn-cancel-alarm').addEventListener('click', goBack);
  $('#btn-save-alarm').addEventListener('click', saveAlarm);
  $('#btn-delete-alarm').addEventListener('click', () => {
    if (State.editingAlarmId) deleteAlarm(State.editingAlarmId);
    goBack();
    renderAlarmList();
  });

  // Time Picker arrows
  $$('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'hour-up') { tpHour = tpHour >= 12 ? 1 : tpHour + 1; }
      if (action === 'hour-down') { tpHour = tpHour <= 1 ? 12 : tpHour - 1; }
      if (action === 'min-up') { tpMinute = tpMinute >= 59 ? 0 : tpMinute + 1; }
      if (action === 'min-down') { tpMinute = tpMinute <= 0 ? 59 : tpMinute - 1; }
      updateTimePicker();
    });

    // Long press for fast scroll
    let interval;
    btn.addEventListener('pointerdown', () => {
      interval = setInterval(() => btn.click(), 120);
    });
    btn.addEventListener('pointerup', () => clearInterval(interval));
    btn.addEventListener('pointerleave', () => clearInterval(interval));
  });

  // AM/PM toggle
  $('#tp-ampm').addEventListener('click', () => {
    tpAmPm = tpAmPm === 'AM' ? 'PM' : 'AM';
    updateTimePicker();
  });

  // Day selector
  $$('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('selected'));
  });

  // --- Connection ---
  $('#btn-back-from-connection').addEventListener('click', goBack);
  $('#btn-toggle-auth-mode').addEventListener('click', () => setAuthMode(!isSignUpMode));

  // Auth form submit (handles both button click and form submit/Enter key)
  const handleAuthSubmit = async () => {
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value.trim();
    const nickname = $('#auth-nickname').value.trim();

    if (!email || !password) { showAuthError('이메일과 비밀번호를 입력하세요'); return; }
    if (isSignUpMode && !nickname) { showAuthError('닉네임을 입력하세요'); return; }

    if (!isFirebaseConfigured()) {
      // Demo mode
      State.myProfile = {
        uid: 'demo_' + Date.now(),
        email, nickname: nickname || email.split('@')[0],
        connectionCode: generateCode(),
        connectedPartnerUid: null
      };
      State.user = { uid: State.myProfile.uid };
      saveProfile(State.myProfile);
      if (isSignUpMode) {
        showSignupSuccess(State.myProfile.connectionCode);
      } else {
        updateConnectionUI();
        showToast('데모 모드로 로그인됩니다 (Firebase 미설정)');
      }
      return;
    }

    const btn = $('#btn-auth-submit');
    btn.disabled = true;
    $('#auth-spinner').classList.remove('hidden');
    $('#auth-btn-text').classList.add('hidden');

    try {
      if (isSignUpMode) {
        const profile = await fbSignUp(email, password, nickname);
        // fbSignUp이 반환한 profile을 State에 즉시 저장
        if (profile) {
          State.myProfile = profile;
          State.user = { uid: profile.uid };
          saveProfile(profile);
        }
        // 코드 공유 화면 표시
        showSignupSuccess(profile?.connectionCode || State.myProfile?.connectionCode || '');
      } else {
        await fbSignIn(email, password);
        showToast('로그인되었습니다');
      }
    } catch(e) {
      showAuthError(getFirebaseErrorMsg(e.code));
    } finally {
      btn.disabled = false;
      $('#auth-spinner').classList.add('hidden');
      $('#auth-btn-text').classList.remove('hidden');
    }
  };
  $('#btn-auth-submit').addEventListener('click', handleAuthSubmit);
  const authForm = $('#auth-form');
  if (authForm) authForm.addEventListener('submit', e => { e.preventDefault(); handleAuthSubmit(); });

  // 회원가입 성공 화면 버튼들
  $('#btn-signup-done').addEventListener('click', hideSignupSuccess);
  $('#btn-share-copy').addEventListener('click', () => {
    const code = $('#signup-code-display').textContent;
    shareCode(code);
  });
  $('#btn-share-kakao').addEventListener('click', () => {
    const code = $('#signup-code-display').textContent;
    shareViaKakao(code);
  });

  // 프로필 화면 공유 버튼들
  $('#btn-copy-code').addEventListener('click', () => {
    const code = State.myProfile?.connectionCode;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => showToast('코드가 복사되었습니다! 상대에게 공유하세요 💕'));
  });
  $('#btn-share-kakao2').addEventListener('click', () => {
    const code = State.myProfile?.connectionCode;
    if (code) shareViaKakao(code);
  });
  $('#btn-share-sms').addEventListener('click', () => {
    const code = State.myProfile?.connectionCode;
    if (code) shareViaSms(code);
  });

  $('#btn-connect').addEventListener('click', async () => {
    const code = $('#connect-code-input').value.trim();
    if (code.length !== 6) { showConnectionError('6자리 코드를 입력하세요'); return; }

    if (!isFirebaseConfigured()) {
      showToast('Firebase 설정이 필요합니다');
      return;
    }

    const btn = $('#btn-connect');
    btn.disabled = true;
    $('#connect-spinner').classList.remove('hidden');
    $('#connect-btn-text').classList.add('hidden');

    try {
      await connectWithCode(code);
    } catch(e) {
      showConnectionError(e.message);
    } finally {
      btn.disabled = false;
      $('#connect-spinner').classList.add('hidden');
      $('#connect-btn-text').classList.remove('hidden');
    }
  });

  $('#connect-code-input').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  $('#btn-disconnect').addEventListener('click', async () => {
    if (!confirm('파트너 연결을 해제하시겠습니까?')) return;
    await disconnectPartner();
  });

  $('#btn-go-partner-alarms').addEventListener('click', () => navigateTo('partner-alarms', 'connection'));

  $('#btn-logout').addEventListener('click', async () => {
    await fbSignOut();
    showToast('로그아웃되었습니다');
  });

  // --- Partner Alarms ---
  $('#btn-back-from-partner').addEventListener('click', goBack);
  bindPaModalEvents();

  // --- Alarm Ringing ---
  $('#btn-ringing-stop').addEventListener('click', stopRinging);
  $('#btn-ringing-snooze').addEventListener('click', snoozeAlarm);

  // --- Recording Modal ---
  $('#btn-recording-cancel').addEventListener('click', cancelRecording);
  $('#btn-recording-done').addEventListener('click', stopRecordingAndUpload);

  // Service Worker messages
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'ALARM_ACTION') {
        if (e.data.action === 'dismiss') stopRinging();
        if (e.data.action === 'snooze') snoozeAlarm();
      }
    });
  }
}

// ============================================================
//  FIREBASE ERROR MESSAGES
// ============================================================
function getFirebaseErrorMsg(code) {
  const msgs = {
    'auth/email-already-in-use': '이미 사용 중인 이메일입니다',
    'auth/invalid-email': '유효하지 않은 이메일 형식입니다',
    'auth/weak-password': '비밀번호는 6자 이상이어야 합니다',
    'auth/user-not-found': '등록되지 않은 이메일입니다',
    'auth/wrong-password': '비밀번호가 올바르지 않습니다',
    'auth/too-many-requests': '너무 많은 시도. 잠시 후 다시 시도하세요',
    'auth/network-request-failed': '네트워크 오류. 인터넷 연결을 확인하세요',
  };
  return msgs[code] || '오류가 발생했습니다. 다시 시도하세요';
}

// ============================================================
//  APP INITIALIZATION
// ============================================================
async function init() {
  // Capacitor 네이티브 플러그인 초기화 (APK 환경)
  if (typeof initCapacitorPlugins === 'function') {
    await initCapacitorPlugins();
    await initAlarmNotificationListener();
  }

  // Register Service Worker (웹 환경)
  if (!isCapacitor() && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW reg failed', e));
  }

  // Load local alarms
  loadAlarms();

  // Initialize screen (show alarm list)
  $('#screen-alarm-list').classList.add('active');
  State.currentScreen = 'alarm-list';

  // Bind all events
  bindEvents();

  // Render alarm list
  renderAlarmList();

  // Initialize time picker default
  updateTimePicker();

  // Firebase auth listener
  initAuthListener();

  // Schedule alarms
  scheduleAlarms();

  // Splash fade out
  setTimeout(() => {
    $('#splash-screen').classList.add('fade-out');
    setTimeout(() => {
      $('#splash-screen').classList.add('hidden');
      $('#app').classList.remove('hidden');
    }, 500);
  }, 1800);

  // Firebase config guide banner
  if (!isFirebaseConfigured()) {
    const guide = $('#firebase-guide');
    if (guide) guide.classList.remove('hidden');
  }
  $('#btn-close-guide')?.addEventListener('click', () => {
    $('#firebase-guide')?.classList.add('hidden');
  });

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => {
      Notification.requestPermission();
    }, 3000);
  }

  // System theme detection
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    document.body.classList.toggle('dark-mode', mq.matches);
    document.body.classList.toggle('light-mode', !mq.matches);
  };
  applyTheme();
  mq.addEventListener('change', applyTheme);
}

// Start
document.addEventListener('DOMContentLoaded', init);
