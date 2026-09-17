const {onSchedule}=require("firebase-functions/v2/scheduler");
const {initializeApp}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
initializeApp();

exports.releaseDuePapers=onSchedule("every 5 minutes",async()=>{
  const db=getFirestore(),now=new Date();
  const snap=await db.collection("papers").where("status","==","SCHEDULED").get();
  const batch=db.batch();let count=0;
  for(const d of snap.docs){
    const p=d.data();
    if(p.examTime&&new Date(p.examTime)<=now){
      batch.update(d.ref,{status:"RELEASED",releasedAt:new Date()});
      batch.set(db.collection("auditLogs").doc(),{
        action:"PAPER_RELEASED",
        details:`${p.title} automatically released by scheduled cloud function`,
        userId:"SYSTEM",email:"cloud-function",role:"system",createdAt:new Date()
      });
      count++;
    }
  }
  if(count)await batch.commit();
  console.log(`Released ${count} paper(s).`);
});
