# Christian Matrimony Platform – Full System Specification

## 🎯 Vision
A **premium Christian matrimony platform** with:
- Modern swipe-based UX (like dating apps)
- Deep matrimony data
- Strong privacy + trust system
- Faith-based intelligent matching

---

# 🏗️ TECH STACK

## Backend
- Node.js + Express
- JWT Authentication
- PostgreSQL (No ORM, raw SQL queries)
- Structure:
  - controllers/
  - routes/
  - services/
  - db/
  - scripts/
  - middleware/

## Web
- React.js
- Clean modular architecture

## Mobile
- Flutter
- BLoC (with Equatable)
- Multiple states (NOT single state)
- no copyWith usage

## Notifications
- Firebase Cloud Messaging (FCM)

---

# 🔐 AUTH FLOW
- Phone number login (OTP)
- JWT token system

---

# 🧩 ONBOARDING FLOW

## UX Rules
- One question per screen
- Smooth transitions
- Haptic feedback on every action
- Progress indicator
- Minimal typing (chips, selectors)

---

## Steps

### Basic
- Gender
- Looking for
- Name
- DOB
- Location

### Matrimony Core
- Marriage intent
- Denomination(protestant,catholic,orthodox,CSI,Pentecostal,born again,other)
- Church name(name of the church attending )
- Faith level
- Church involvement
- Caste
- 

### Personal
- Education
- Profession
- Income

### Lifestyle
- Smoking(yes,no, occasionally)
- Drinking(yes,no, occasionally)
- Diet(veg,non-veg, occasionally)
- Gym(yes,no, occasionally)

### Family (Single Screen)
- Father occupation
- Mother occupation
- Siblings (brothers/sisters)
- Married status
- Family income
- Family class

### Partner Preferences
- Age range
- Location
- Denomination (with “Doesn’t matter”)
- Caste (with “Doesn’t matter”)
- Education
- Profession
- Salary range


### Hobbies
- Multi-select chips

### Photos
- At least ONE mandatory

### Verification
- Government ID (optional)

### Profile Managed By
- Self / Parents / Others

---

# ❤️ MATCHMAKING SYSTEM

## Layers

### 1. Hard Filters
- Gender
- Age
- Location
- Denomination (if strict)
- Caste (if strict)
- Education
- Profession
- Salary range

### 2. Compatibility Score
- Faith
- Lifestyle
- Family
- Intent
- Career

### 3. Behavioral Signals
- Likes
- Skips
- Time spent

---

# 📊 PROFILE DISCOVERY

- Swipe UI
- Limited profiles per day (20)
- Premium can see more

---

# 💬 INTEREST SYSTEM

States:
- Sent
- Received
- Accepted
- Rejected
- Connected

Flow:
- Send interest
- Accept/Reject
- Chat unlock

---

# 🔐 PRIVACY & SECURITY

## Contact Sharing
- Premium required to request
- Owner approves

## Controls
- Who can see profile
- Who can chat
- Image locking
- Screenshot protection

---

# 🔗 PROFILE SHARING

- Dynamic links
- Web + App view
- Public limited data

---

# ⚙️ SETTINGS

- Profile visibility
- Chat permissions
- Contact sharing
- Filters
- Security options

---

# 🎨 UI/UX GUIDELINES

## Design Style
- Clean, modern
- Soft colors (white, gold, blue)
- Rounded cards
- Smooth animations

## Interactions
- Swipe gestures
- Micro animations
- Haptic feedback

## Screens
- Card-based discovery
- Structured onboarding
- Clean chat UI

---

# 🚀 EXTRA FEATURES

- Profile completion score
- Trust badge
- Daily curated matches
- AI (LLM) for:
  - Match explanation
  - Profile summary

---

# 📌 FINAL FLOW

Login → Onboarding → Profile Active → Discover → Interest → Accept → Chat → Contact Request → Settings 
Control

# 📌 BOTTOM NAVIGATION FLOW

BottomNavigationBar:
1. Discover → Swipe cards /  Daily matches / Compatibility / Filters button (top left)
2. Interests → tabs Received / Sent / Connected
3. Chat → Conversations list / Last message preview / Online status
4. Activity → Who viewed your profile / Who shortlisted you / Daily match suggestions/Notifications
5. Profile → View profile / Edit profile / Photos / Verification / Settings
