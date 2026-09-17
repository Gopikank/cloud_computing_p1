# Cloud-Based Examination Question Paper Vault

A college microproject demonstrating cloud computing for protecting sensitive
examination question papers, with a strict submit → lock → admin-access →
exam → public-release timeline.

## Timeline

The Question Setter enters two times: **Exam Start** and **Public Release**.
Everything else is derived automatically:

```
Submit  → PAPER IMMEDIATELY LOCKED (setter can never open it again)
Exam Start − 2 minutes → ADMIN / TEACHER ACCESS begins
Exam Start              → exam begins (still admin/teacher access only)
Public Release time     → PAPER BECOMES PUBLICLY ACCESSIBLE
```

Example — Exam Start 10:00 AM, Public Release 1:00 PM:

```
09:57 AM → LOCKED
09:58 AM → ADMIN / TEACHER ACCESS
10:00 AM → EXAM STARTS
01:00 PM → PUBLIC ACCESS
```

Nothing here depends on a person clicking a "release" button, an admin
approving anything, or a Cloud Function ticking over — the access windows
are **enforced inside Firestore Security Rules** by comparing the server's
`request.time` against the three timestamps saved at submission. No
client, including a compromised or buggy one, can grant early access.

## Why the Setter can never re-open the paper

Most "locking" demos just hide a button in the UI, which the setter's own
account could bypass. Here it's structural:

- Paper **metadata** (title, times, SHA-256 fingerprint) lives in
  `papers/{id}` and IS visible to the setter and to admins at any time —
  so the setter can see their paper is locked and awaiting its schedule.
- The **file bytes** live in a separate document, `paperContent/{id}`.
  The security rule for that collection has no "creator" exception at
  all — the setter has exactly the same read access as a stranger. Before
  the public release time, only an authenticated **admin** (and only once
  the admin-access time has passed) can read it. After the public release
  time, anyone can read it — the setter included, but at that point the
  paper is genuinely public information.

## Technologies (Spark / free-plan only)

- Firebase Authentication (Email/Password)
- Cloud Firestore (rules-enforced time-gated access — no Cloud Functions)
- Firebase Hosting
- Browser Web Crypto API (SHA-256)

**No Firebase Cloud Storage and no Cloud Functions are used**, so the
project runs entirely on the free **Spark plan** — no billing account
required. The dummy paper's bytes are base64-encoded and stored directly
as a Firestore field, which is why this prototype is only meant for a
**small demo/dummy file** (see limits below).

## Important security note

This is an educational prototype, not a production examination system.
Do **not** upload a real confidential examination paper — use a small
dummy/demo text or PDF file only.

## Project structure
```text
Cloud_Exam_Paper_Vault/
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── firestore.rules
├── firestore.indexes.json
├── firebase.json
├── .firebaserc.example
├── .gitignore
└── README.md
```

## Setup

### 1. Create a Firebase project
In the [Firebase Console](https://console.firebase.google.com/):
- Create a project (stay on the **Spark/free plan** — nothing here needs Blaze).
- Enable **Authentication → Sign-in method → Email/Password**.
- Enable **Firestore Database** (start in production mode; the rules file
  in this repo replaces the defaults).
- Enable **Hosting**.
- Add a **Web App** and copy its config object.

### 2. Configure the frontend
Open `public/app.js` and replace the placeholder values in `firebaseConfig`
with your Web App configuration from step 1.

Never commit a service-account JSON file to this project or to GitHub.

### 3. Install the Firebase CLI
```cmd
npm install -g firebase-tools
firebase login
```

### 4. Connect this folder to your project
```cmd
cp .firebaserc.example .firebaserc
```
Edit `.firebaserc` and put your Firebase project ID in place of
`YOUR_FIREBASE_PROJECT_ID` (or run `firebase use --add` and pick it
interactively).

### 5. Deploy Firestore rules
```cmd
firebase deploy --only firestore:rules
```

### 6. Deploy Hosting
```cmd
firebase deploy --only hosting
```
Firebase prints a `https://<project-id>.web.app` URL — open it.

## Demo workflow

### 1. Register three test accounts
Use the Register form and pick a role for each:
- one **Question Setter**
- one **Admin / Teacher**
- one **Examiner / Student**

### 2. Submit a paper (as Question Setter)
1. Log in as the setter.
2. Enter a title.
3. Set **Exam start time** ~5 minutes in the future.
4. Set **Public release time** ~2 minutes after that.
5. Choose a small `.txt` or `.pdf` dummy file (≤ 700 KB) and click
   **Submit & Lock Paper**.
6. The paper instantly shows **🔒 LOCKED** — including to the setter, who
   has no "Open Paper" button at all from this point on.

### 3. Watch the schedule play out
- **2 minutes before exam start**: log in as the Admin/Teacher account —
  the card flips to **🟠 ADMIN / TEACHER ACCESS** and "Open Paper" /
  "Verify Hash" appear for the admin only.
- **At exam start**: nothing changes for access (still admin-only) — this
  models the admin/teacher printing or distributing the paper to the exam
  hall while the online vault itself stays restricted.
- **At the public release time**: log in as the Examiner/Student (or
  refresh the setter's own session) — the card flips to
  **🌐 PUBLIC ACCESS** and everyone can open the paper and verify its hash.

The list re-renders every few seconds, so you can literally watch the
status change live without touching a button — refresh only if you want
to fetch content that just became newly available.

### 4. Integrity check
Click **Verify Hash** once a paper is open to you. The app re-downloads
the stored bytes, recomputes SHA-256 in the browser, and compares it to
the fingerprint captured at submission time. A mismatch would mean the
stored bytes were altered.

### 5. Audit log
Every submission, access, and hash verification is written to
`auditLogs` and shown at the bottom of the page (admins see all entries;
everyone else sees only their own).

## Cloud computing concepts demonstrated
- Cloud authentication (Firebase Auth)
- Cloud database (Firestore) as the sole store for both metadata and file
  bytes — no separate storage service needed
- Declarative, server-evaluated **time-based access control** via
  Security Rules (no server code, no Cloud Functions, no Blaze plan)
- Document-level data hiding (splitting metadata from content into two
  collections so a role can see *that* a paper exists without being able
  to read *it*)
- Integrity verification via SHA-256 fingerprinting
- Audit logging
- Managed cloud hosting

## Limitations
- The registration page lets you pick your own role for classroom
  testing convenience. In a real system, roles should be assigned by a
  trusted admin process (e.g. custom claims set by a backend), not
  self-selected at sign-up.
- Because there's no Cloud Storage, file size is capped well below
  Firestore's 1 MiB document limit — fine for a dummy paper, not for a
  real exam paper with images/scans.
- "Publicly accessible" here means any signed-in app user (any role) can
  open it once the release time passes; the Firestore rules also permit
  fully unauthenticated reads via a direct Firestore/REST call at that
  point, but the demo UI itself still sits behind a login screen for
  simplicity.
