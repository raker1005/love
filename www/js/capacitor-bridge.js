/* ================================================
   Capacitor Native Bridge
   네이티브 앱 환경에서 로컬 알림 사용
   ================================================ */

// Capacitor가 로드됐는지 확인
function isCapacitor() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform());
}

// Capacitor LocalNotifications 플러그인
let LocalNotifications = null;
let Haptics = null;

async function initCapacitorPlugins() {
  if (!isCapacitor()) return;

  try {
    const cap = window.Capacitor;
    LocalNotifications = cap.Plugins.LocalNotifications;
    Haptics = cap.Plugins.Haptics;

    // 알림 권한 요청
    if (LocalNotifications) {
      const perm = await LocalNotifications.requestPermissions();
      console.log('알림 권한:', perm.display);
    }
  } catch (e) {
    console.warn('Capacitor plugins init failed:', e);
  }
}

// 네이티브 알람 스케줄링 (Capacitor)
async function scheduleNativeAlarm(alarm) {
  if (!isCapacitor() || !LocalNotifications) return false;

  try {
    const ms = getNextAlarmMs(alarm);
    if (ms <= 0) return false;

    const triggerAt = new Date(Date.now() + ms);

    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.abs(hashCode(alarm.id)),
          title: '💕 Love Alarm',
          body: alarm.label || '알람이 울리고 있습니다',
          schedule: {
            at: triggerAt,
            allowWhileIdle: true,
            repeats: false
          },
          sound: alarm.partnerSoundUri || 'default',
          actionTypeId: 'ALARM_ACTION',
          extra: {
            alarmId: alarm.id,
            snoozeEnabled: alarm.snoozeEnabled
          },
          ongoing: true,
          autoCancel: false,
          largeIcon: 'ic_launcher',
          smallIcon: 'ic_stat_alarm',
          iconColor: '#FF2D55',
          channelId: 'alarm_channel'
        }
      ]
    });

    console.log(`네이티브 알람 등록: ${alarm.id} at ${triggerAt}`);
    return true;
  } catch (e) {
    console.warn('네이티브 알람 등록 실패:', e);
    return false;
  }
}

// 네이티브 알람 취소
async function cancelNativeAlarm(alarm) {
  if (!isCapacitor() || !LocalNotifications) return;
  try {
    await LocalNotifications.cancel({
      notifications: [{ id: Math.abs(hashCode(alarm.id)) }]
    });
  } catch (e) {
    console.warn('네이티브 알람 취소 실패:', e);
  }
}

// 네이티브 진동
async function nativeVibrate() {
  if (!isCapacitor() || !Haptics) {
    if ('vibrate' in navigator) {
      navigator.vibrate([800, 400, 800, 400, 800]);
    }
    return;
  }
  try {
    await Haptics.vibrate({ duration: 800 });
  } catch (e) {
    if ('vibrate' in navigator) navigator.vibrate([800, 400, 800]);
  }
}

// 알람 알림 클릭 리스너
async function initAlarmNotificationListener() {
  if (!isCapacitor() || !LocalNotifications) return;

  LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const extra = action.notification?.extra;
    if (!extra) return;

    const alarmId = extra.alarmId;
    const alarm = State.alarms.find(a => a.id === alarmId);

    if (action.actionId === 'SNOOZE') {
      if (alarm) triggerAlarm(alarm);
      setTimeout(() => {
        const a = State.alarms.find(x => x.id === alarmId);
        if (a) triggerAlarm(a);
      }, 5 * 60 * 1000);
    } else {
      // 기본 클릭 → 알람 울림 화면 표시
      if (alarm) triggerAlarm(alarm);
    }
  });

  // 포그라운드 알림도 처리
  LocalNotifications.addListener('localNotificationReceived', (notification) => {
    const extra = notification.extra;
    if (!extra) return;
    const alarm = State.alarms.find(a => a.id === extra.alarmId);
    if (alarm) triggerAlarm(alarm);
  });
}

// 문자열 → 숫자 해시 (알림 ID용)
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash) % 2147483647;
}
