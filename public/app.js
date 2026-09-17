import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc, writeBatch,
  query, orderBy, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

 const firebaseConfig = {
    apiKey: "AIzaSyANxdmF-1hwjtVRwtUx0c2iyyXAURaxf0k",
    authDomain: "cloud-exam-paper-vault-b2424.firebaseapp.com",
    projectId: "cloud-exam-paper-vault-b2424",
    storageBucket: "cloud-exam-paper-vault-b2424.firebasestorage.app",
    messagingSenderId: "530298209190",
    appId: "1:530298209190:web:c302994c9e1f06ac8e8567"
  };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

let currentUser = null, currentRole = null, papers = [];
const ADMIN_LEAD_MS = 2 * 60 * 1000; 
const MAX_FILE_BYTES = 700 * 1024;   

function show(msg) { const x = $("message"); x.textContent = msg; x.style.display = "block"; setTimeout(() => x.style.display = "none", 3500); }
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])); }
function fmt(v) { if (!v) return "-"; const d = v.toDate ? v.toDate() : new Date(v); return d.toLocaleString(); }

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function toBase64(buf) {
  let bin = ""; const bytes = new Uint8Array(buf); const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function logAction(action, details, paperId) {
  if (!currentUser) return;
  await addDoc(collection(db, "auditLogs"), {
    action, details, paperId: paperId || null,
    userId: currentUser.uid, email: currentUser.email, role: currentRole,
    createdAt: serverTimestamp()
  });
}

$("loginBtn").onclick = async () => {
  try { await signInWithEmailAndPassword(auth, $("loginEmail").value, $("loginPassword").value); show("Login successful"); }
  catch (e) { show(e.message); }
};
$("registerBtn").onclick = async () => {
  try {
    const email = $("regEmail").value, password = $("regPassword").value, role = $("regRole").value;
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), { email, role, createdAt: serverTimestamp() });
    show("Account created");
  } catch (e) { show(e.message); }
};
$("logoutBtn").onclick = () => signOut(auth);

$("submitBtn").onclick = async () => {
  try {
    if (!["setter", "admin"].includes(currentRole)) return show("Only a Question Setter/Admin can submit a paper.");
    const title = $("paperTitle").value.trim();
    const examTimeVal = $("examTime").value;
    const publicTimeVal = $("publicTime").value;
    const file = $("paperFile").files[0];
    if (!title || !examTimeVal || !publicTimeVal || !file) return show("Fill in title, exam start time, public release time and choose a file.");
    if (!/\.(pdf|txt)$/i.test(file.name)) return show("Only PDF or TXT files are allowed.");
    if (file.size > MAX_FILE_BYTES) return show("Keep the demo file small (≤ 700 KB) — this prototype stores it directly in Firestore, no Storage/Blaze plan needed.");

    const examStartTime = new Date(examTimeVal);
    const publicReleaseTime = new Date(publicTimeVal);
    const adminAccessTime = new Date(examStartTime.getTime() - ADMIN_LEAD_MS);
    const now = new Date();
    if (examStartTime <= now) return show("Exam start time must be in the future.");
    if (publicReleaseTime <= examStartTime) return show("Public release time must be after the exam start time.");

    const buf = await file.arrayBuffer();
    const hash = await sha256Hex(buf);
    const base64 = toBase64(buf);

    const paperRef = doc(collection(db, "papers"));           // shared id
    const contentRef = doc(db, "paperContent", paperRef.id);   // same id, separate collection

    const batch = writeBatch(db);
    batch.set(paperRef, {
      title,
      originalName: file.name,
      contentType: file.type || "application/octet-stream",
      creatorId: currentUser.uid,
      creatorEmail: currentUser.email,
      sha256: hash,
      adminAccessTime: Timestamp.fromDate(adminAccessTime),
      examStartTime: Timestamp.fromDate(examStartTime),
      publicReleaseTime: Timestamp.fromDate(publicReleaseTime),
      createdAt: serverTimestamp()
    });
    batch.set(contentRef, { base64 });
    await batch.commit();

    await logAction("PAPER_SUBMITTED_LOCKED", `"${title}" submitted and immediately locked`, paperRef.id);
    $("paperTitle").value = ""; $("examTime").value = ""; $("publicTime").value = ""; $("paperFile").value = "";
    show(" Paper submitted and locked. You will not be able to open it again.");
  } catch (e) { show(e.message); }
};

function phaseOf(p, now) {
  if (now < p.adminAccessTime.toDate()) return "LOCKED";
  if (now < p.publicReleaseTime.toDate()) return "ADMIN_ACCESS";
  return "PUBLIC";
}
function canOpenContent(p, now) {
  const phase = phaseOf(p, now);
  if (phase === "PUBLIC") return true;
  if (phase === "ADMIN_ACCESS") return currentRole === "admin";
  return false;
}

async function openPaper(p) {
  const now = new Date();
  if (!canOpenContent(p, now)) return show(" This paper is not accessible yet.");
  try {
    const snap = await getDoc(doc(db, "paperContent", p.id));
    if (!snap.exists()) return show("Content not found.");
    const bytes = fromBase64(snap.data().base64);
    const blob = new Blob([bytes], { type: p.contentType });
    window.open(URL.createObjectURL(blob), "_blank");
    await logAction("PAPER_ACCESSED", `"${p.title}" opened`, p.id);
  } catch (e) { show(e.message); }
}
async function verifyPaper(p) {
  const now = new Date();
  if (!canOpenContent(p, now)) return show("Verification is available once the paper is accessible.");
  try {
    const snap = await getDoc(doc(db, "paperContent", p.id));
    const bytes = fromBase64(snap.data().base64);
    const hash = await sha256Hex(bytes.buffer);
    const ok = hash === p.sha256;
    show(ok ? "✅ SHA-256 verified: file matches the original submission." : "❌ SHA-256 mismatch: file may have been altered!");
    await logAction("HASH_VERIFIED", `"${p.title}" hash ${ok ? "matched" : "MISMATCHED"}`, p.id);
  } catch (e) { show(e.message); }
}

function renderPapers() {
  const now = new Date();
  const visible = papers.filter(p => currentRole === "admin" || p.creatorId === currentUser.uid || phaseOf(p, now) === "PUBLIC");

  $("totalCount").textContent = visible.length;
  $("lockedCount").textContent = visible.filter(p => phaseOf(p, now) === "LOCKED").length;
  $("adminCount").textContent = visible.filter(p => phaseOf(p, now) === "ADMIN_ACCESS").length;
  $("publicCount").textContent = visible.filter(p => phaseOf(p, now) === "PUBLIC").length;

  const label = { LOCKED: " LOCKED", ADMIN_ACCESS: "🟠 ADMIN / TEACHER ACCESS", PUBLIC: "🌐 PUBLIC ACCESS" };

  $("papers").innerHTML = visible.length ? visible.map(p => {
    const phase = phaseOf(p, now);
    const openable = canOpenContent(p, now);
    return `<div class="paper">
      <div class="paper-top">
        <div><h3>${esc(p.title)}</h3><div class="muted">${esc(p.originalName)} • Setter: ${esc(p.creatorEmail)}</div></div>
        <span class="status ${phase}">${label[phase]}</span>
      </div>
      <p><b>Admin/Teacher access from:</b> ${fmt(p.adminAccessTime)}</p>
      <p><b>Exam starts:</b> ${fmt(p.examStartTime)}</p>
      <p><b>Public release:</b> ${fmt(p.publicReleaseTime)}</p>
      <p><b>SHA-256:</b> <code>${esc(p.sha256)}</code></p>
      <div class="paper-actions">
        ${openable ? `<button data-open="${p.id}">Open Paper</button><button class="secondary" data-verify="${p.id}">Verify Hash</button>` : ""}
      </div>
    </div>`;
  }).join("") : "<p class='muted'>No papers available for this role yet.</p>";

  document.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openPaper(papers.find(x => x.id === b.dataset.open)));
  document.querySelectorAll("[data-verify]").forEach(b => b.onclick = () => verifyPaper(papers.find(x => x.id === b.dataset.verify)));
}

function subscribe() {
  onSnapshot(query(collection(db, "papers"), orderBy("createdAt", "desc")), s => {
    papers = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPapers();
  });
  onSnapshot(query(collection(db, "auditLogs"), orderBy("createdAt", "desc")), s => {
    $("logs").innerHTML = s.docs.slice(0, 30).map(d => {
      const x = d.data();
      return `<div class="log"><strong>${esc(x.action)}</strong><span>${esc(x.details)} — ${esc(x.email)} — ${fmt(x.createdAt)}</span></div>`;
    }).join("") || "<p class='muted'>No audit entries yet.</p>";
  });
}

setInterval(() => { if (currentUser) renderPapers(); }, 5000);

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    currentRole = null;
    $("authSection").classList.remove("hidden");
    $("appSection").classList.add("hidden");
    $("userBox").classList.add("hidden");
    return;
  }
  const s = await getDoc(doc(db, "users", user.uid));
  currentRole = s.exists() ? s.data().role : "examiner";
  $("userEmail").textContent = user.email;
  $("userRole").textContent = currentRole.toUpperCase();
  $("userBox").classList.remove("hidden");
  $("authSection").classList.add("hidden");
  $("appSection").classList.remove("hidden");
  $("setterPanel").classList.toggle("hidden", !["setter", "admin"].includes(currentRole));
  subscribe();
});
