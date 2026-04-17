# Love Alarm 💕 - 하이브리드 웹앱

> 연인과 알람을 공유하는 PWA (Progressive Web App)

## 🚀 프로젝트 개요

Love Alarm은 연인 간 알람음을 공유할 수 있는 하이브리드 웹 애플리케이션입니다.  
안드로이드 앱 소스코드를 웹 기술(HTML/CSS/JS)로 재구현하였으며, PWA로 동작하여 홈 화면에 설치 및 앱처럼 사용할 수 있습니다.

---

## ✅ 구현된 기능

### 🔔 알람 기본 기능
- [x] 알람 추가 (시간 선택, 라벨, 반복 요일, 스누즈, 진동)
- [x] 알람 목록 조회 (활성/비활성 섹션 분리)
- [x] 알람 편집 (카드 탭)
- [x] 알람 삭제 (스와이프 or 편집 화면 삭제 버튼)
- [x] 알람 활성/비활성 토글
- [x] 반복 요일 설정 (매일/주중/주말 자동 라벨)
- [x] 스누즈 기능 (5분 후 재울림)
- [x] 알람 울림 전체화면 (펄스 애니메이션)
- [x] Web Audio API 알람음 재생 (로컬 beep)
- [x] 원격 URL 음원 스트리밍 재생
- [x] 스와이프 제스처 (위로: 끄기, 아래로: 스누즈)

### 🔗 소셜 기능 (Firebase 필요)
- [x] 이메일/비밀번호 회원가입/로그인
- [x] 고유 6자리 연결 코드 발급
- [x] 연결 코드로 파트너 연결/해제
- [x] 연결 상태 실시간 표시

### 💌 파트너 알람음 기능 (Firebase 필요)
- [x] 파트너 알람 목록 실시간 조회
- [x] 마이크로 직접 녹음하여 업로드
- [x] 오디오 파일 선택하여 업로드
- [x] Firebase Storage 업로드 (진행률 표시)
- [x] 파트너 알람음 실시간 감지 및 자동 적용
- [x] "♥ 파트너 알람음" 배지 표시

### 📱 PWA 기능
- [x] 홈 화면 설치 가능 (manifest.json)
- [x] Service Worker (오프라인 캐싱)
- [x] 백그라운드 알림 (Web Notification API)
- [x] 다크/라이트 모드 자동 전환

---

## 🛠️ 기술 스택

| 구분 | 기술 |
|------|------|
| UI | HTML5 + CSS3 (iOS 스타일) |
| JS | Vanilla JavaScript (ES2022) |
| 백엔드 | Firebase v10 (Auth, Firestore, Storage) |
| 알람 | setTimeout + Web Audio API |
| 저장소 | LocalStorage (알람 데이터) |
| PWA | Service Worker + Web App Manifest |
| 아이콘 | Font Awesome 6 |
| 폰트 | Google Fonts (Inter) |

---

## ⚙️ Firebase 설정 방법

### 1단계: Firebase 프로젝트 생성
1. [Firebase Console](https://console.firebase.google.com) 접속
2. 새 프로젝트 생성
3. 아래 서비스 활성화:
   - **Authentication** → 이메일/비밀번호 활성화
   - **Firestore Database** → 생성 (테스트 모드로 시작)
   - **Storage** → 생성

### 2단계: 웹 앱 등록
1. 프로젝트 설정 → 앱 추가 → 웹 (`</>`)
2. Firebase 설정 값 복사

### 3단계: index.html 설정 수정
`index.html` 하단의 Firebase 설정 부분을 수정:

```javascript
const firebaseConfig = {
  apiKey: "실제_API_KEY",
  authDomain: "프로젝트ID.firebaseapp.com",
  projectId: "실제_프로젝트_ID",
  storageBucket: "프로젝트ID.appspot.com",
  messagingSenderId: "실제_SENDER_ID",
  appId: "실제_APP_ID"
};
```

### 4단계: Firestore 보안 규칙 적용
Firebase Console → Firestore → 규칙 탭에 아래 규칙 붙여넣기:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId;
      
      match /shared_alarms/{alarmId} {
        allow read: if request.auth != null;
        allow write: if request.auth.uid == userId;
      }
      
      match /alarm_sounds/{alarmId} {
        allow read: if request.auth.uid == userId;
        allow write: if request.auth != null
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.connectedPartnerUid == userId;
      }
    }
  }
}
```

---

## 📱 안드로이드에서 앱으로 사용하기

### 방법 1: PWA 홈 화면 추가 (권장)
1. Chrome 브라우저로 앱 접속
2. 주소창 오른쪽 메뉴 → "홈 화면에 추가"
3. 전체화면 앱으로 실행 가능

### 방법 2: WebView로 APK 패키징
[Capacitor.js](https://capacitorjs.com) 또는 [Cordova](https://cordova.apache.org)를 사용하여 APK 생성 가능:

```bash
# Capacitor 사용 예시
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Love Alarm" "com.example.lovealarm"
npx cap add android
npx cap copy
npx cap open android  # Android Studio에서 빌드
```

---

## 📂 프로젝트 구조

```
/
├── index.html          # 메인 앱 (모든 화면 포함)
├── manifest.json       # PWA 매니페스트
├── sw.js              # Service Worker
├── css/
│   └── style.css      # 전체 스타일 (iOS 스타일)
├── js/
│   └── app.js         # 앱 로직 (알람, Firebase, UI)
└── icons/
    └── icon.svg       # 앱 아이콘
```

---

## 🗄️ 데이터 구조

### 로컬 저장소 (LocalStorage)
```json
{
  "love_alarms": [
    {
      "id": "알람ID",
      "hour": 7,
      "minute": 0,
      "label": "일어나!",
      "isEnabled": true,
      "repeatDays": [1, 2, 3, 4, 5],
      "vibrate": true,
      "snoozeEnabled": true,
      "partnerSoundUri": "https://firebase.../sound.webm",
      "soundUri": "default"
    }
  ]
}
```

### Firestore 구조
```
users/{uid}
  ├── uid, email, nickname, connectionCode, connectedPartnerUid
  ├── shared_alarms/{alarmId}
  │     └── alarmId, hour, minute, label, isEnabled
  └── alarm_sounds/{alarmId}
        └── soundUrl, uploadedAt, uploadedBy
```

---

## ⚠️ Firebase 미설정 시 (데모 모드)
- 알람 기본 기능은 Firebase 없이도 완전히 동작합니다
- 회원가입/로그인 시 "데모 모드"로 작동 (로컬 저장만)
- 파트너 연결 및 알람음 공유 기능은 Firebase 설정 후 사용 가능

---

## 🔮 향후 개선 계획 (v2.0)
- [ ] FCM 푸시 알림 (백그라운드 알람음 변경 알림)
- [ ] 알람음 미리듣기 기능
- [ ] AI 음성 알람음 생성 (TTS)
- [ ] 홈 위젯 (다음 알람 표시)
- [ ] 수면 통계 분석

---

**Made with ♥ Love Alarm**
