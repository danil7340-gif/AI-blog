import { useState, useEffect, useRef } from "react";

const fl = document.createElement("link");
fl.rel = "stylesheet";
fl.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Space+Mono:wght@400;700&display=swap";
document.head.appendChild(fl);

const SLOTS      = [0, 6, 12, 18];
const SLOT_NAMES = { 0:"Ночной выпуск", 6:"Утренний выпуск", 12:"Дневной выпуск", 18:"Вечерний выпуск" };
const SLOT_ICONS = { 0:"🌙", 6:"🌅", 12:"☀️", 18:"🌆" };

const CATEGORIES = {
  science:    { label:"Наука",      color:"#4fc3f7" },
  philosophy: { label:"Философия",  color:"#ce93d8" },
  art:        { label:"Искусство",  color:"#ffcc80" },
  nature:     { label:"Природа",    color:"#a5d6a7" },
  history:    { label:"История",    color:"#ef9a9a" },
  technology: { label:"Технологии", color:"#80cbc4" },
  cosmos:     { label:"Космос",     color:"#9fa8da" },
  psychology: { label:"Психология", color:"#f48fb1" },
};

const uid       = () => Math.random().toString(36).slice(2, 10);
const AVATARS   = ["◉","◎","◈","◇","◆","◐","◑","◒","◓","○","●","◍"];
const getAvatar = name => AVATARS[name.charCodeAt(0) % AVATARS.length];

function parseJSON(text) {
  return JSON.parse(text.replace(/```json\s*/g,"").replace(/```\s*/g,"").trim());
}
function fmtDate(d) {
  return new Date(d + "T00:00:00").toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"});
}
function fmtDT(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU",{day:"numeric",month:"short"})+" · "+d.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
}
function pluralC(n) {
  if (n%10===1&&n%100!==11) return "комментарий";
  if ([2,3,4].includes(n%10)&&![12,13,14].includes(n%100)) return "комментария";
  return "комментариев";
}
function getDueSlots() { const h=new Date().getHours(); return SLOTS.filter(s=>h>=s); }
function postId(date,slot) { return `${date}-${slot}`; }

async function callGemini(apiKey, prompt, maxTokens=2000) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      contents:[{parts:[{text:prompt}]}],
      generationConfig:{maxOutputTokens:maxTokens,temperature:0.9},
    }),
  });
  if(!res.ok){const e=await res.json();throw new Error(e.error?.message||`HTTP ${res.status}`);}
  const data=await res.json();
  return data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
}

async function stGet(key) {
  try{const r=await window.storage.get(key);return r?JSON.parse(r.value):null;}catch(_){return null;}
}
async function stSet(key,val) {
  try{await window.storage.set(key,JSON.stringify(val));}catch(_){}
}

export default function AIBlog() {
  const [apiKey,setApiKey]=useState("");
  const [apiKeyInput,setApiKeyInput]=useState("");
  const [keyError,setKeyError]=useState("");
  const [posts,setPosts]=useState([]);
  const [comments,setComments]=useState({});
  const [loading,setLoading]=useState(true);
  const [queue,setQueue]=useState([]);
  const [genStatus,setGenStatus]=useState({});
  const [selectedPost,setSelectedPost]=useState(null);
  const [filter,setFilter]=useState("all");
  const initialized=useRef(false);
  const postsRef=useRef([]);

  useEffect(()=>{(async()=>{const k=await stGet("aiblog_gemini_key");if(k)setApiKey(k);})();},[]);

  useEffect(()=>{
    if(apiKey&&!initialized.current){initialized.current=true;loadAndInit(apiKey);}
  },[apiKey]);

  async function loadAndInit(key) {
    setLoading(true);
    const savedPosts=await stGet("aiblog_posts_v3")||[];
    const savedComments=await stGet("aiblog_comments_v1")||{};
    postsRef.current=savedPosts;
    setPosts(savedPosts);
    setComments(savedComments);
    setLoading(false);
    const today=new Date().toISOString().split("T")[0];
    const due=getDueSlots();
    const existIds=new Set(savedPosts.map(p=>p.id));
    const missing=due.filter(s=>!existIds.has(postId(today,s)));
    for(const slot of missing) await generatePost(key,today,slot);
    const timer=setInterval(async()=>{
      const t=new Date().toISOString().split("T")[0];
      const d=getDueSlots();
      const ids=new Set(postsRef.current.map(p=>p.id));
      const miss=d.filter(s=>!ids.has(postId(t,s)));
      for(const slot of miss) await generatePost(key,t,slot);
    },60000);
    return()=>clearInterval(timer);
  }

  async function generatePost(key,today,slot) {
    const id=postId(today,slot);
    setQueue(q=>[...new Set([...q,slot])]);
    const upd=(msg)=>setGenStatus(g=>({...g,[id]:msg}));
    try {
      upd("🔍 Выбираю тему...");
      const topicRaw=await callGemini(key,
        `Ты — интеллектуальный эссеист журнала «СИНТЕЗ». Выходят 4 выпуска в день.
Сейчас: ${SLOT_NAMES[slot]} ${SLOT_ICONS[slot]}, дата ${today}.

Верни ТОЛЬКО валидный JSON без markdown:
{"topic":"...","subtitle":"...","category":"science|philosophy|art|nature|history|technology|cosmos|psychology","imagePrompt":"...","tags":["...","...","..."]}

- topic: поэтичное название темы на русском (3–7 слов), соответствующее времени суток
- subtitle: интригующий подзаголовок на русском (до 12 слов)
- imagePrompt: описание изображения на АНГЛИЙСКОМ, cinematic, dramatic, ultra-detailed
- tags: 3 тега на русском, уникальные
- Каждый выпуск дня должен быть в разной категории, с разной атмосферой`,400);
      let topic;
      try{topic=parseJSON(topicRaw);}
      catch(_){
        const fb=[
          {topic:"Молчание между звёздами",subtitle:"О природе космической пустоты",category:"cosmos",imagePrompt:"vast dark cosmos nebulae ethereal blue light cinematic",tags:["космос","пространство","тишина"]},
          {topic:"Язык, который придумал мир",subtitle:"Как слова создают реальность",category:"philosophy",imagePrompt:"ancient glowing manuscripts dark library dramatic",tags:["язык","реальность","мышление"]},
          {topic:"Математика красоты",subtitle:"Формулы, скрытые в природе",category:"science",imagePrompt:"golden ratio fibonacci spirals nature macro ethereal",tags:["природа","математика","красота"]},
          {topic:"Сны машин",subtitle:"Что видит ИИ, когда думает",category:"technology",imagePrompt:"AI neural network glowing nodes dark background cinematic",tags:["ИИ","сознание","будущее"]},
        ];
        topic=fb[SLOTS.indexOf(slot)%fb.length];
      }

      upd(`✍️ Пишу: «${topic.topic}»...`);
      const contentRaw=await callGemini(key,
        `Ты — блестящий эссеист журнала «СИНТЕЗ». Пиши глубоко, красиво, образно. Только на русском.

Верни ТОЛЬКО валидный JSON без markdown:
{"intro":"...","sections":[{"heading":"...","content":"..."},{"heading":"...","content":"..."},{"heading":"...","content":"..."}],"conclusion":"...","readingTime":7,"pullQuote":"..."}

- intro: вступление, минимум 3 абзаца через \\n
- sections: 3 раздела, каждый content — 3+ абзаца через \\n, глубоко и образно  
- conclusion: 2 абзаца через \\n
- pullQuote: самая сильная афористичная мысль (одно предложение)
- readingTime: реалистичное время чтения в минутах

Тема: «${topic.topic}» — ${topic.subtitle}
Выпуск: ${SLOT_NAMES[slot]} ${SLOT_ICONS[slot]}
Пиши с неожиданными метафорами, конкретными примерами и философской глубиной.`,3000);
      let content;
      try{content=parseJSON(contentRaw);}
      catch(_){
        content={intro:"Каждый выпуск начинается с вопроса.\n\nСегодня мы останавливаемся перед горизонтом.\n\nЭто и есть цель путешествия.",
          sections:[
            {heading:"Первое приближение",content:"Идея начинается с ощущения.\n\nПотом приходит слово.\n\nМир меняется."},
            {heading:"Углубляемся",content:"Чем дальше заходишь, тем больше вопросов.\n\nЭто нормально.\n\nПродолжаем."},
            {heading:"К сути",content:"Любая мысль возвращается к началу.\n\nНо уже на другом уровне.\n\nЭто понимание."},
          ],
          conclusion:"Мы заканчиваем там, где начали.\n\nДо следующего выпуска.",
          readingTime:7,pullQuote:"Любопытство — начало всякой мудрости."};
      }

      upd("🎨 Генерирую обложку...");
      const seed=parseInt(today.replace(/-/g,""))+slot;
      const imageUrl=`https://image.pollinations.ai/prompt/${encodeURIComponent(topic.imagePrompt+", dramatic cinematic lighting, ultra detailed, 8k")}?width=1200&height=675&nologo=true&seed=${seed}`;

      const newPost={id,date:today,slot,slotName:SLOT_NAMES[slot],slotIcon:SLOT_ICONS[slot],...topic,...content,imageUrl,generated:new Date().toISOString()};
      const updated=[newPost,...postsRef.current.filter(p=>p.id!==id)].sort((a,b)=>b.id.localeCompare(a.id));
      postsRef.current=updated;
      setPosts(updated);
      await stSet("aiblog_posts_v3",updated);
    } catch(err){
      console.error(`Slot ${slot}:`,err);
      upd(`❌ ${err.message}`);
      setTimeout(()=>setGenStatus(g=>{const n={...g};delete n[id];return n;}),5000);
    }
    setQueue(q=>q.filter(s=>s!==slot));
    setGenStatus(g=>{const n={...g};delete n[id];return n;});
  }

  async function addComment(pid,author,text) {
    const c={id:uid(),author:author.trim(),text:text.trim(),date:new Date().toISOString(),likes:[]};
    const updated={...comments,[pid]:[c,...(comments[pid]||[])]};
    setComments(updated);await stSet("aiblog_comments_v1",updated);return c;
  }
  async function toggleLike(pid,commentId,userId) {
    const updated={...comments,[pid]:(comments[pid]||[]).map(c=>c.id!==commentId?c:
      {...c,likes:c.likes.includes(userId)?c.likes.filter(x=>x!==userId):[...c.likes,userId]})};
    setComments(updated);await stSet("aiblog_comments_v1",updated);
  }
  async function deleteComment(pid,commentId) {
    const updated={...comments,[pid]:(comments[pid]||[]).filter(c=>c.id!==commentId)};
    setComments(updated);await stSet("aiblog_comments_v1",updated);
  }

  if(!apiKey) return <KeyScreen input={apiKeyInput} setInput={setApiKeyInput} error={keyError} onSave={async()=>{
    const k=apiKeyInput.trim();
    if(!k||k.length<20){setKeyError("Вставьте ключ Gemini (начинается с AIza...)");return;}
    setKeyError("");await stSet("aiblog_gemini_key",k);setApiKey(k);
  }}/>;

  if(selectedPost) return <PostView post={selectedPost} comments={comments[selectedPost.id]||[]} apiKey={apiKey}
    onBack={()=>setSelectedPost(null)} onAddComment={(a,t)=>addComment(selectedPost.id,a,t)}
    onLike={(cId,uid)=>toggleLike(selectedPost.id,cId,uid)} onDelete={(cId)=>deleteComment(selectedPost.id,cId)}/>;

  const filtered=filter==="all"?posts:posts.filter(p=>p.category===filter);
  const usedCats=[...new Set(posts.map(p=>p.category))];
  const today=new Date().toISOString().split("T")[0];
  const todayPosts=posts.filter(p=>p.date===today);

  return (
    <div style={s.root}><GS/>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logoArea}>
            <div style={s.logoEye}>◈</div>
            <div>
              <div style={s.logoTitle}>СИНТЕЗ</div>
              <div style={s.logoSub}>4 выпуска в день · Gemini 2.5 Flash</div>
            </div>
          </div>
          <div style={s.headerMeta}>
            <div style={s.dateBadge}>{new Date().toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long"})}</div>
            <div style={{display:"flex",gap:6,marginTop:4}}>
              {SLOTS.map(sl=>{
                const id=postId(today,sl);
                const done=posts.some(p=>p.id===id);
                const inProg=queue.includes(sl);
                const due=new Date().getHours()>=sl;
                return(<div key={sl} title={SLOT_NAMES[sl]} style={{width:28,height:28,borderRadius:"50%",border:"1px solid",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,
                  borderColor:done?"#c8b99a22":inProg?"#ffcc8044":"#2a2520",
                  background:done?"#1a1510":inProg?"#1a1000":"transparent",
                  color:done?"#c8b99a":inProg?"#ffcc80":due?"#444":"#2a2520",
                  animation:inProg?"pulse 1s infinite":undefined}}>{SLOT_ICONS[sl]}</div>);
              })}
            </div>
          </div>
        </div>
        {queue.length>0&&(
          <div style={{background:"#0f0d00",borderTop:"1px solid #2a2010",padding:"7px 24px"}}>
            <div style={{maxWidth:1200,margin:"0 auto",display:"flex",gap:20,flexWrap:"wrap"}}>
              {queue.map(sl=>{const id=postId(today,sl);return(
                <div key={sl} style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:"#ffcc80",animation:"pulse 1s infinite"}}/>
                  <span style={{fontFamily:"Space Mono",fontSize:10,color:"#ffcc80"}}>{SLOT_ICONS[sl]} {SLOT_NAMES[sl]}: {genStatus[id]||"генерирую..."}</span>
                </div>
              );})}
            </div>
          </div>
        )}
        <div style={s.headerLine}/>
      </header>

      {todayPosts.length>0&&(
        <div style={s.scheduleBar}>
          <div style={{maxWidth:1200,margin:"0 auto",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span style={{fontFamily:"Space Mono",fontSize:10,color:"#3a3025",letterSpacing:1}}>СЕГОДНЯ:</span>
            {SLOTS.map(sl=>{
              const id=postId(today,sl);const post=posts.find(p=>p.id===id);
              const inPg=queue.includes(sl);const h=new Date().getHours();
              return(<div key={sl} onClick={post?()=>setSelectedPost(post):undefined}
                style={{display:"flex",alignItems:"center",gap:6,padding:"4px 12px",borderRadius:2,
                  border:"1px solid",cursor:post?"pointer":"default",transition:"all .2s",
                  borderColor:post?"#2a2520":inPg?"#2a2010":"#1a1510",
                  background:post?"#0f0d0a":inPg?"#0f0d00":"transparent",
                  opacity:!post&&!inPg&&h<sl?0.3:1}}>
                <span style={{fontSize:12}}>{SLOT_ICONS[sl]}</span>
                <span style={{fontFamily:"Space Mono",fontSize:10,color:post?"#c8b99a":inPg?"#ffcc80":"#444"}}>
                  {sl.toString().padStart(2,"0")}:00
                </span>
                {post&&<span style={{fontFamily:"EB Garamond",fontSize:13,color:"#6a6055",fontStyle:"italic",
                  maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{post.topic}</span>}
                {inPg&&<span style={{fontFamily:"Space Mono",fontSize:9,color:"#ffcc80",animation:"pulse 1s infinite"}}>●</span>}
              </div>);
            })}
          </div>
        </div>
      )}

      {usedCats.length>1&&(
        <div style={s.filterBar}>
          <button className="cat-btn" onClick={()=>setFilter("all")}
            style={{...s.catBtn,background:filter==="all"?"#fff":"transparent",color:filter==="all"?"#0a0a0a":"#888"}}>
            Все ({posts.length})
          </button>
          {usedCats.map(cat=>(
            <button key={cat} className="cat-btn" onClick={()=>setFilter(cat)}
              style={{...s.catBtn,background:filter===cat?(CATEGORIES[cat]?.color||"#fff"):"transparent",
                color:filter===cat?"#0a0a0a":(CATEGORIES[cat]?.color||"#888"),
                borderColor:CATEGORIES[cat]?.color||"#444"}}>
              {CATEGORIES[cat]?.label||cat}
            </button>
          ))}
        </div>
      )}

      <main style={s.main}>
        {loading&&<LoadingState/>}
        {!loading&&posts.length===0&&queue.length===0&&(
          <div style={s.empty}><div style={{fontSize:48,marginBottom:16}}>◈</div>
            <p style={{color:"#666",fontFamily:"EB Garamond",fontSize:20}}>Первый пост генерируется...</p></div>
        )}
        {!loading&&posts.length===0&&queue.length>0&&<GeneratingHero slot={queue[0]} status={genStatus[postId(today,queue[0])]}/>}
        {filtered.length>0&&<FeaturedPost post={filtered[0]} commentCount={(comments[filtered[0].id]||[]).length} onClick={()=>setSelectedPost(filtered[0])}/>}
        {filtered.length>1&&(
          <div style={s.grid}>
            {filtered.slice(1).map((p,i)=>(
              <PostCard key={p.id} post={p} index={i} commentCount={(comments[p.id]||[]).length} onClick={()=>setSelectedPost(p)}/>
            ))}
          </div>
        )}
      </main>
      <footer style={s.footer}>
        <span style={{color:"#333",fontFamily:"Space Mono",fontSize:10}}>
          СИНТЕЗ · 4 выпуска в день · Gemini 2.5 Flash + Pollinations.ai ·{" "}
          <span style={{cursor:"pointer",textDecoration:"underline"}} onClick={async()=>{
            await stSet("aiblog_gemini_key","");setApiKey("");initialized.current=false;
          }}>сменить ключ</span>
        </span>
      </footer>
    </div>
  );
}

function KeyScreen({input,setInput,error,onSave}) {
  return(
    <div style={s.root}><GS/>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:24}}>
        <div style={{maxWidth:460,width:"100%"}}>
          <div style={{textAlign:"center",marginBottom:44}}>
            <div style={{fontFamily:"Playfair Display",fontSize:52,color:"#c8b99a",marginBottom:8}}>◈</div>
            <h1 style={{fontFamily:"Playfair Display",fontSize:34,fontWeight:900,color:"#f5f0e8",letterSpacing:4,marginBottom:6}}>СИНТЕЗ</h1>
            <p style={{fontFamily:"EB Garamond",fontSize:17,color:"#6a6055",fontStyle:"italic"}}>ИИ-журнал · 4 выпуска в день</p>
          </div>
          <div style={s.keyCard}>
            <div style={{fontFamily:"Space Mono",fontSize:11,color:"#554f45",letterSpacing:2,marginBottom:18}}>GEMINI API КЛЮЧ</div>
            <p style={{fontFamily:"EB Garamond",fontSize:16,color:"#7a7060",lineHeight:1.7,marginBottom:22}}>
              Получи бесплатный ключ на{" "}
              <a href="https://ai.google.dev" target="_blank" rel="noreferrer" style={{color:"#c8b99a",textDecoration:"none"}}>ai.google.dev</a>
              {" "}→ «Get API key» → «Create API key in new project». Карточка не нужна.
            </p>
            <input placeholder="AIzaSy..." value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&onSave()}
              style={{...s.input,marginBottom:10,fontSize:14,letterSpacing:1}} type="password" autoFocus/>
            {error&&<div style={{fontFamily:"Space Mono",fontSize:10,color:"#ef9a9a",marginBottom:10}}>{error}</div>}
            <button className="submit-btn" onClick={onSave} style={{...s.submitBtn,width:"100%",padding:"12px",display:"flex",justifyContent:"center"}}>
              Запустить журнал →
            </button>
            <p style={{fontFamily:"Space Mono",fontSize:9,color:"#2a2520",marginTop:14,lineHeight:1.7}}>
              Ключ хранится только локально в браузере. 4 поста × ~3000 токенов = ~12K токенов/день — полностью бесплатно на тире Gemini 2.5 Flash.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostView({post,comments,apiKey,onBack,onAddComment,onLike,onDelete}) {
  const cat=CATEGORIES[post.category]||{label:post.category,color:"#fff"};
  return(
    <div style={s.root}><GS/>
      <div style={{maxWidth:780,margin:"0 auto",padding:"0 24px 80px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"22px 0"}}>
          <button className="back-btn" onClick={onBack}
            style={{background:"none",border:"none",color:"#666",fontFamily:"Space Mono",fontSize:12,display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
            ← ВЕРНУТЬСЯ В ЖУРНАЛ
          </button>
          <div style={{display:"flex",alignItems:"center",gap:8,fontFamily:"Space Mono",fontSize:12,color:"#4a4035"}}>
            <span>{post.slotIcon}</span><span>{post.slotName}</span>
          </div>
        </div>
        <div style={{borderRadius:4,overflow:"hidden",marginBottom:36,aspectRatio:"16/9",background:"#111"}}>
          <img src={post.imageUrl} alt={post.topic} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.style.display="none";}}/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:22,flexWrap:"wrap",animation:"fadeUp .4s ease forwards"}}>
          <span style={{...s.catTag,background:cat.color+"22",color:cat.color,borderColor:cat.color+"44"}}>{cat.label}</span>
          <span style={s.dateSmall}>{fmtDate(post.date)}</span>
          <span style={s.dateSmall}>{post.slotIcon} {post.slotName}</span>
          <span style={s.dateSmall}>{post.readingTime} мин</span>
          <span style={{...s.dateSmall,color:"#4a4035"}}>💬 {comments.length} {pluralC(comments.length)}</span>
        </div>
        <h1 style={{fontFamily:"Playfair Display",fontSize:"clamp(26px,5vw,48px)",fontWeight:900,color:"#f5f0e8",lineHeight:1.1,marginBottom:14,animation:"fadeUp .4s .1s ease forwards",opacity:0}}>
          {post.topic}
        </h1>
        <p style={{fontFamily:"EB Garamond",fontSize:21,color:"#9a8f7e",fontStyle:"italic",marginBottom:36,animation:"fadeUp .4s .15s ease forwards",opacity:0}}>
          {post.subtitle}
        </p>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:36}}>
          <div style={{flex:1,height:1,background:"linear-gradient(to right,#2a2520,transparent)"}}/>
          <span style={{color:"#3a3020",fontFamily:"Playfair Display",fontSize:18}}>◈</span>
          <div style={{flex:1,height:1,background:"linear-gradient(to left,#2a2520,transparent)"}}/>
        </div>
        <div style={{animation:"fadeUp .4s .2s ease forwards",opacity:0}}>
          {post.intro?.split("\n").filter(Boolean).map((p,i)=><p key={i} style={s.proseP}>{p}</p>)}
        </div>
        {post.pullQuote&&(
          <blockquote style={s.pullQuote}>
            <span style={{fontFamily:"Playfair Display",fontSize:"clamp(16px,2.5vw,23px)",fontStyle:"italic",color:"#c8b99a",lineHeight:1.45}}>«{post.pullQuote}»</span>
          </blockquote>
        )}
        {post.sections?.map((sec,i)=>(
          <div key={i} style={{marginBottom:44,animation:`fadeUp .4s ${.25+i*.08}s ease forwards`,opacity:0}}>
            <h2 style={s.sectionH}>{sec.heading}</h2>
            {sec.content?.split("\n").filter(Boolean).map((p,j)=><p key={j} style={s.proseP}>{p}</p>)}
          </div>
        ))}
        {post.conclusion&&(
          <div style={{borderTop:"1px solid #1e1a15",paddingTop:36,marginTop:12,animation:"fadeUp .4s .5s ease forwards",opacity:0}}>
            {post.conclusion.split("\n").filter(Boolean).map((p,i)=><p key={i} style={{...s.proseP,color:"#9a8f7e"}}>{p}</p>)}
          </div>
        )}
        {post.tags&&(
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:36,paddingTop:28,borderTop:"1px solid #1a1510"}}>
            {post.tags.map(t=><span key={t} style={s.tag}>#{t}</span>)}
          </div>
        )}
        <CommentsSection comments={comments} apiKey={apiKey} onAdd={onAddComment} onLike={onLike} onDelete={onDelete}/>
      </div>
    </div>
  );
}

function CommentsSection({comments,apiKey,onAdd,onLike,onDelete}) {
  const [author,setAuthor]=useState("");
  const [text,setText]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState("");
  const [aiReplying,setAiReplying]=useState(null);
  const userId=useRef((()=>{try{let id=localStorage.getItem("blog_uid");if(!id){id=uid();localStorage.setItem("blog_uid",id);}return id;}catch(_){return uid();}})()).current;

  async function handleSubmit() {
    if(!author.trim()){setError("Введите имя");return;}
    if(text.trim().length<3){setError("Комментарий слишком короткий");return;}
    setError("");setSubmitting(true);await onAdd(author,text);setText("");setSubmitting(false);
  }
  async function handleAIReply(comment) {
    setAiReplying(comment.id);
    try {
      const reply=await callGemini(apiKey,
        `Ты — вдумчивый автор интеллектуального журнала «СИНТЕЗ». Читатель оставил комментарий, ответь тепло, содержательно и кратко (2–4 предложения). Только на русском.\n\nКомментарий от ${comment.author}: "${comment.text}"`,400);
      await onAdd("Редактор СИНТЕЗ ◈",reply.trim());
    } catch(_){
      await onAdd("Редактор СИНТЕЗ ◈","Спасибо за интересную мысль! Именно такие наблюдения и делают журнал живым.");
    }
    setAiReplying(null);
  }

  return(
    <div style={{marginTop:60,borderTop:"2px solid #1a1510",paddingTop:44}}>
      <div style={{display:"flex",alignItems:"baseline",gap:16,marginBottom:36}}>
        <h3 style={{fontFamily:"Playfair Display",fontSize:25,fontWeight:700,color:"#f5f0e8",margin:0}}>Обсуждение</h3>
        <span style={{fontFamily:"Space Mono",fontSize:11,color:"#4a4035"}}>{comments.length} {pluralC(comments.length)}</span>
      </div>
      <div style={s.commentForm}>
        <div style={{fontFamily:"Space Mono",fontSize:11,color:"#554f45",marginBottom:18,letterSpacing:1}}>ОСТАВИТЬ КОММЕНТАРИЙ</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:12,marginBottom:12}}>
          <input placeholder="Ваше имя" value={author} onChange={e=>setAuthor(e.target.value)} style={s.input} maxLength={40}/>
          <div style={{position:"relative"}}>
            <input placeholder="Поделитесь мыслями..." value={text} onChange={e=>setText(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleSubmit();}}}
              style={s.input} maxLength={500}/>
            <span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontFamily:"Space Mono",fontSize:9,color:"#2a2520",pointerEvents:"none"}}>{text.length}/500</span>
          </div>
        </div>
        {error&&<div style={{fontFamily:"Space Mono",fontSize:10,color:"#ef9a9a",marginBottom:10}}>{error}</div>}
        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <button className="submit-btn" onClick={handleSubmit} disabled={submitting} style={{...s.submitBtn,opacity:submitting?0.5:1}}>
            {submitting?"Отправляю...":"Опубликовать →"}
          </button>
        </div>
      </div>
      {comments.length===0
        ?<div style={{textAlign:"center",padding:"44px 0",color:"#333",fontFamily:"EB Garamond",fontSize:17,fontStyle:"italic"}}>Будьте первым, кто поделится мыслью...</div>
        :comments.map((c,i)=>(
          <CommentItem key={c.id} comment={c} index={i} userId={userId}
            isAI={c.author==="Редактор СИНТЕЗ ◈"}
            liked={c.likes?.includes(userId)} likeCount={c.likes?.length||0}
            onLike={()=>onLike(c.id,userId)} onDelete={()=>onDelete(c.id)}
            onAIReply={()=>handleAIReply(c)} aiReplying={aiReplying===c.id}/>
        ))
      }
    </div>
  );
}

function CommentItem({comment,index,isAI,liked,likeCount,onLike,onDelete,onAIReply,aiReplying}) {
  const [hov,setHov]=useState(false);
  return(
    <div onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{padding:"20px",borderRadius:4,marginBottom:2,transition:"background .2s",
        background:isAI?"#0f1a0f":hov?"#0f0e0c":"transparent",
        borderLeft:isAI?"2px solid #a5d6a7":"2px solid transparent",
        animation:`fadeUp .35s ${index*.05}s ease forwards`,opacity:0}}>
      <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
        <div style={{width:36,height:36,borderRadius:"50%",flexShrink:0,
          background:isAI?"#1a2f1a":"#1a1510",border:`1px solid ${isAI?"#2a4f2a":"#2a2015"}`,
          display:"flex",alignItems:"center",justifyContent:"center",
          fontFamily:"Space Mono",fontSize:14,color:isAI?"#a5d6a7":"#c8b99a"}}>
          {isAI?"◈":getAvatar(comment.author)}
        </div>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6,flexWrap:"wrap"}}>
            <span style={{fontFamily:"Space Mono",fontSize:11,fontWeight:700,color:isAI?"#a5d6a7":"#c8b99a"}}>{comment.author}</span>
            {isAI&&<span style={{fontFamily:"Space Mono",fontSize:9,color:"#2a4f2a",background:"#0f2010",border:"1px solid #1a3018",padding:"2px 6px",borderRadius:2}}>АИ РЕДАКТОР</span>}
            <span style={{fontFamily:"Space Mono",fontSize:10,color:"#333"}}>{fmtDT(comment.date)}</span>
          </div>
          <p style={{fontFamily:"EB Garamond",fontSize:17,lineHeight:1.7,color:isAI?"#b8c8b0":"#a09080",margin:"0 0 10px"}}>{comment.text}</p>
          <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
            <button className="action-btn" onClick={onLike}
              style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:5,padding:0,
                color:liked?"#ef9a9a":"#444",fontFamily:"Space Mono",fontSize:11,transition:"color .15s"}}>
              <span style={{fontSize:14}}>{liked?"♥":"♡"}</span>
              {likeCount>0&&<span>{likeCount}</span>}
            </button>
            {!isAI&&(
              <button className="action-btn" onClick={onAIReply} disabled={!!aiReplying}
                style={{background:"none",border:"none",cursor:aiReplying?"wait":"pointer",display:"flex",alignItems:"center",gap:6,padding:0,
                  color:"#444",fontFamily:"Space Mono",fontSize:11,transition:"color .15s",opacity:aiReplying?0.5:1}}>
                {aiReplying
                  ?<><span style={{animation:"spin .8s linear infinite",display:"inline-block"}}>◈</span><span>редактор отвечает...</span></>
                  :<><span>◈</span><span>ответ редактора</span></>}
              </button>
            )}
            {hov&&likeCount===0&&(
              <button className="action-btn" onClick={onDelete}
                style={{background:"none",border:"none",cursor:"pointer",padding:0,marginLeft:"auto",color:"#555",fontFamily:"Space Mono",fontSize:10}}>
                удалить
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeaturedPost({post,commentCount,onClick}) {
  const cat=CATEGORIES[post.category]||{label:post.category,color:"#fff"};
  return(
    <div className="post-card" onClick={onClick} style={{...s.featured,animationDelay:".1s"}}>
      <div style={s.featuredImgWrap}>
        <img src={post.imageUrl} alt={post.topic} style={s.featuredImg} onError={e=>{e.target.style.display="none";}}/>
        <div className="img-overlay" style={s.featuredOverlay}/>
        <div style={{position:"absolute",top:16,left:16,fontFamily:"Space Mono",fontSize:11,color:"#c8b99a",
          background:"#0a0906bb",border:"1px solid #2a2520",padding:"4px 10px",borderRadius:2}}>
          {post.slotIcon} {post.slotName}
        </div>
      </div>
      <div style={s.featuredContent}>
        <div style={s.metaRow}>
          <span style={{...s.catTag,background:cat.color+"22",color:cat.color,borderColor:cat.color+"44"}}>{cat.label}</span>
          <span style={s.dateSmall}>{fmtDate(post.date)} · {post.readingTime} мин</span>
          {commentCount>0&&<span style={{...s.dateSmall,color:"#4a4035"}}>💬 {commentCount}</span>}
        </div>
        <h1 style={s.featuredTitle}>{post.topic}</h1>
        <p style={s.featuredSub}>{post.subtitle}</p>
        <p style={s.featuredIntro}>{post.intro?.split("\n").filter(Boolean)[0]?.slice(0,230)}...</p>
        {post.tags&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>{post.tags.map(t=><span key={t} style={s.tag}>#{t}</span>)}</div>}
      </div>
    </div>
  );
}

function PostCard({post,index,commentCount,onClick}) {
  const cat=CATEGORIES[post.category]||{label:post.category,color:"#fff"};
  return(
    <div className="post-card" onClick={onClick} style={{...s.card,animationDelay:`${.15+index*.07}s`}}>
      <div style={s.cardImgWrap}>
        <img src={post.imageUrl} alt={post.topic} style={s.cardImg} onError={e=>{e.target.style.display="none";e.target.parentElement.style.background="#111";}}/>
        <div className="img-overlay" style={s.cardOverlay}/>
        <span style={{...s.catTag,position:"absolute",top:12,left:12,background:cat.color+"22",color:cat.color,borderColor:cat.color+"44"}}>{cat.label}</span>
        <span style={{position:"absolute",top:12,right:12,fontFamily:"Space Mono",fontSize:10,color:"#c8b99a",background:"#0a0906cc",padding:"3px 8px",borderRadius:2}}>
          {post.slotIcon} {String(post.slot??0).padStart(2,"0")}:00{commentCount>0&&` · 💬${commentCount}`}
        </span>
      </div>
      <div style={s.cardContent}>
        <div style={s.cardDate}>{fmtDate(post.date)}</div>
        <h3 style={s.cardTitle}>{post.topic}</h3>
        <p style={s.cardSub}>{post.subtitle}</p>
        <div style={s.cardFooter}><span style={s.readTime}>↗ {post.readingTime} мин</span></div>
      </div>
    </div>
  );
}

function LoadingState() {
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:400,gap:16}}>
      <div style={{width:40,height:40,border:"2px solid #2a2520",borderTopColor:"#c8b99a",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <span style={{fontFamily:"EB Garamond",color:"#555",fontSize:18}}>Загружаю журнал...</span>
    </div>
  );
}
function GeneratingHero({slot,status}) {
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:500,gap:24}}>
      <div style={{fontSize:72,animation:"pulse2 2s ease-in-out infinite"}}>{SLOT_ICONS[slot??0]}</div>
      <div style={{textAlign:"center"}}>
        <h2 style={{fontFamily:"Playfair Display",color:"#f5f0e8",fontSize:28,marginBottom:8}}>{SLOT_NAMES[slot??0]}</h2>
        <p style={{fontFamily:"EB Garamond",color:"#666",fontSize:18}}>{status||"Gemini думает..."}</p>
      </div>
    </div>
  );
}

function GS() {
  return(
    <style>{`
      @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
      @keyframes pulse2{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.15);opacity:1}}
      @keyframes spin{to{transform:rotate(360deg)}}
      .post-card{transition:transform .3s,box-shadow .3s;cursor:pointer;animation:fadeUp .5s ease forwards;opacity:0}
      .post-card:hover{transform:translateY(-6px);box-shadow:0 20px 60px rgba(0,0,0,.6)!important}
      .cat-btn{transition:all .2s;cursor:pointer;border:none}
      .cat-btn:hover{opacity:.85;transform:translateY(-1px)}
      .img-overlay{transition:opacity .3s}
      .post-card:hover .img-overlay{opacity:.5!important}
      .back-btn:hover{opacity:.7!important;transform:translateX(-3px)!important}
      .action-btn{transition:color .15s}
      .action-btn:hover{color:#c8b99a!important}
      .submit-btn:hover{background:#c8b99a!important;color:#0a0906!important}
      input:focus{outline:none;border-color:#3a3025!important;background:#1a1713!important}
      ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#111}::-webkit-scrollbar-thumb{background:#333;border-radius:3px}
    `}</style>
  );
}

const s={
  root:            {minHeight:"100vh",background:"#0a0906",color:"#f5f0e8"},
  header:          {borderBottom:"1px solid #1a1510",padding:"0 24px"},
  headerInner:     {maxWidth:1200,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 0"},
  logoArea:        {display:"flex",alignItems:"center",gap:16},
  logoEye:         {fontSize:30,color:"#c8b99a",fontFamily:"Playfair Display",lineHeight:1},
  logoTitle:       {fontFamily:"Playfair Display",fontSize:24,fontWeight:900,letterSpacing:4,color:"#f5f0e8"},
  logoSub:         {fontFamily:"Space Mono",fontSize:9,color:"#3a3520",letterSpacing:1,marginTop:3},
  headerMeta:      {display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6},
  dateBadge:       {fontFamily:"Space Mono",fontSize:10,color:"#3a3025",textTransform:"uppercase"},
  headerLine:      {height:1,background:"linear-gradient(to right,transparent,#2a2520 20%,#2a2520 80%,transparent)",maxWidth:1200,margin:"0 auto"},
  scheduleBar:     {borderBottom:"1px solid #111",padding:"9px 24px",background:"#090807"},
  filterBar:       {maxWidth:1200,margin:"0 auto",padding:"14px 24px",display:"flex",flexWrap:"wrap",gap:8},
  catBtn:          {fontFamily:"Space Mono",fontSize:11,padding:"5px 12px",borderRadius:20,border:"1px solid #2a2520",letterSpacing:1},
  main:            {maxWidth:1200,margin:"0 auto",padding:"32px 24px 80px"},
  footer:          {borderTop:"1px solid #111",padding:"18px 24px",textAlign:"center"},
  empty:           {textAlign:"center",padding:"120px 24px"},
  featured:        {display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,background:"#0f0d0a",border:"1px solid #1a1510",borderRadius:4,overflow:"hidden",marginBottom:28,minHeight:380},
  featuredImgWrap: {position:"relative",overflow:"hidden",minHeight:320},
  featuredImg:     {width:"100%",height:"100%",objectFit:"cover",display:"block"},
  featuredOverlay: {position:"absolute",inset:0,background:"linear-gradient(to right,transparent 50%,#0f0d0a)",opacity:.8,transition:"opacity .3s"},
  featuredContent: {padding:"36px 32px",display:"flex",flexDirection:"column",justifyContent:"center"},
  metaRow:         {display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"},
  catTag:          {fontFamily:"Space Mono",fontSize:10,padding:"3px 9px",border:"1px solid",borderRadius:2,letterSpacing:1,textTransform:"uppercase"},
  dateSmall:       {fontFamily:"Space Mono",fontSize:10,color:"#554f45"},
  featuredTitle:   {fontFamily:"Playfair Display",fontSize:"clamp(20px,2.5vw,34px)",fontWeight:900,lineHeight:1.15,color:"#f5f0e8",marginBottom:10},
  featuredSub:     {fontFamily:"EB Garamond",fontSize:16,color:"#9a8f7e",fontStyle:"italic",marginBottom:16},
  featuredIntro:   {fontFamily:"EB Garamond",fontSize:15,color:"#6a6055",lineHeight:1.7},
  tag:             {fontFamily:"Space Mono",fontSize:10,color:"#554f45",letterSpacing:1},
  grid:            {display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:18},
  card:            {background:"#0f0d0a",border:"1px solid #1a1510",borderRadius:4,overflow:"hidden"},
  cardImgWrap:     {position:"relative",height:180,overflow:"hidden"},
  cardImg:         {width:"100%",height:"100%",objectFit:"cover",display:"block"},
  cardOverlay:     {position:"absolute",inset:0,background:"linear-gradient(to top,#0f0d0a,transparent 60%)",opacity:.8},
  cardContent:     {padding:"18px"},
  cardDate:        {fontFamily:"Space Mono",fontSize:10,color:"#3a3025",marginBottom:8},
  cardTitle:       {fontFamily:"Playfair Display",fontSize:18,fontWeight:700,lineHeight:1.25,color:"#f5f0e8",marginBottom:6},
  cardSub:         {fontFamily:"EB Garamond",fontSize:14,color:"#6a6055",fontStyle:"italic",marginBottom:12,lineHeight:1.5},
  cardFooter:      {borderTop:"1px solid #1a1510",paddingTop:10,display:"flex",alignItems:"center"},
  readTime:        {fontFamily:"Space Mono",fontSize:10,color:"#3a3025"},
  proseP:          {fontFamily:"EB Garamond",fontSize:"clamp(16px,2vw,19px)",lineHeight:1.85,color:"#c8bfb0",marginBottom:18},
  pullQuote:       {borderLeft:"3px solid #c8b99a",margin:"40px 0",padding:"18px 26px",background:"#0f0d0a"},
  sectionH:        {fontFamily:"Playfair Display",fontSize:"clamp(19px,2.5vw,27px)",fontWeight:700,color:"#f5f0e8",marginBottom:20,marginTop:8},
  commentForm:     {background:"#0d0c0a",border:"1px solid #1e1a15",borderRadius:4,padding:"22px",marginBottom:32},
  input:           {width:"100%",background:"#141210",border:"1px solid #2a2520",borderRadius:3,padding:"10px 14px",color:"#c8bfb0",fontFamily:"EB Garamond",fontSize:16,boxSizing:"border-box",transition:"all .2s"},
  submitBtn:       {background:"transparent",border:"1px solid #3a3025",color:"#c8b99a",fontFamily:"Space Mono",fontSize:11,padding:"10px 24px",cursor:"pointer",borderRadius:2,letterSpacing:1,transition:"all .2s"},
  keyCard:         {background:"#0d0c0a",border:"1px solid #1e1a15",borderRadius:4,padding:"30px"},
};
