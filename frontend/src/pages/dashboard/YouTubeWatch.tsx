import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

let playerApi: Promise<any> | undefined;
function youtubePlayer() {
  if ((window as any).YT?.Player) return Promise.resolve((window as any).YT);
  return playerApi ||= new Promise((resolve, reject) => {
    const w = window as any, previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { clearTimeout(timer); previous?.(); resolve(w.YT); };
    const script = document.createElement("script"); script.src = "https://www.youtube.com/iframe_api";
    const timer = window.setTimeout(() => { playerApi = undefined; reject(new Error("The YouTube player could not load. Check your connection and try again.")); }, 20000);
    script.onerror = () => { clearTimeout(timer); playerApi = undefined; script.remove(); reject(new Error("The YouTube player was blocked. Check your connection or browser settings.")); };
    document.head.appendChild(script);
  });
}
const count = (n: any) => n == null ? "Unavailable" : Number(n).toLocaleString();
const date = (v: string) => v ? new Date(v).toLocaleDateString() : "";
export function YouTubeWatch({ id, config, onChef, onVideo }: { id: string; config: any; onChef: () => void; onVideo: (video: any) => void }) {
  const [video, setVideo] = useState<any>(null), [error, setError] = useState(""), [playerError, setPlayerError] = useState(""), [retry, setRetry] = useState(0);
  const [recommended, setRecommended] = useState<any[]>([]), [recToken, setRecToken] = useState(""), [recError, setRecError] = useState(""), [recBusy, setRecBusy] = useState(false);
  const [comments, setComments] = useState<any[]>([]), [commentToken, setCommentToken] = useState(""), [order, setOrder] = useState("relevance"), [commentError, setCommentError] = useState(""), [commentBusy, setCommentBusy] = useState(false), [disabled, setDisabled] = useState(false);
  const [text, setText] = useState(""), [posting, setPosting] = useState(false), [notice, setNotice] = useState("");
  const host = useRef<HTMLDivElement>(null), generation = useRef(0), commentGeneration = useRef(0), postLock = useRef(false);
  const canPost = config?.connection?.scopes?.some((s: string) => ["https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/youtube"].includes(s));
  useEffect(() => { const current = ++generation.current; setVideo(null); setError(""); setPlayerError(""); setText(""); setNotice(""); setRecommended([]); setRecToken(""); setComments([]); setCommentToken("");
    api<any>(`/api/youtube/watch/${id}`).then(d => { if (current === generation.current) { setVideo(d.video); onVideo(d.video); } }).catch(e => { if (current === generation.current) setError(e.message); });
    void recommendations(false, current); return () => { generation.current++; };
  }, [id, retry]);
  useEffect(() => { void loadComments(false); }, [id, order, retry]);
  useEffect(() => {
    if (!video || video.embeddable === false || !host.current) return;
    let alive = true, player: any;
    const readyTimer = window.setTimeout(() => { if (alive) setPlayerError("YouTube is taking too long to load. Check your connection or browser settings, then retry."); }, 25000); const mount = document.createElement("div"); host.current.replaceChildren(mount);
    youtubePlayer().then(YT => { if (!alive) return; player = new YT.Player(mount, { videoId: id, width: "100%", height: "100%", playerVars: { controls: 1, playsinline: 1, fs: 1, origin: window.location.origin }, events: { onReady: () => { clearTimeout(readyTimer); const frame = player.getIframe(); frame.title = video.title; frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin"); frame.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture"); }, onError: (e: any) => { clearTimeout(readyTimer); if (alive) setPlayerError(({ 2: "This video link is invalid.", 5: "Your browser could not play this video.", 100: "This video is unavailable or private.", 101: "The owner does not allow this video to be embedded.", 150: "The owner does not allow this video to be embedded.", 153: "YouTube could not verify this website. Allow referrers in your browser and retry." } as any)[e.data] || "YouTube could not play this video. Try again or watch it on YouTube."); } } }); }).catch(e => { clearTimeout(readyTimer); if (alive) setPlayerError(e.message); });
    return () => { alive = false; clearTimeout(readyTimer); player?.destroy(); };
  }, [video, id, retry]);
  async function recommendations(more = false, current = generation.current) {
    setRecBusy(true); setRecError(""); try { const d = await api<any>(`/api/youtube/watch/${id}/recommendations${more ? `?pageToken=${encodeURIComponent(recToken)}` : ""}`); if (current !== generation.current) return; setRecommended(old => more ? [...old, ...d.items.filter((x: any) => !old.some(v => v.id === x.id))] : d.items); setRecToken(d.nextPageToken || ""); } catch (e: any) { if (current === generation.current) setRecError(e.message); } finally { if (current === generation.current) setRecBusy(false); }
  }
  async function loadComments(more = false) {
    const current = generation.current, request = ++commentGeneration.current; setCommentBusy(true); setCommentError(""); setDisabled(false);
    try { const d = await api<any>(`/api/youtube/watch/${id}/comments?order=${order}${more ? `&pageToken=${encodeURIComponent(commentToken)}` : ""}`); if (current !== generation.current || request !== commentGeneration.current) return; setComments(old => more ? [...old, ...d.items.filter((x: any) => !old.some(v => v.id === x.id))] : d.items); setCommentToken(d.nextPageToken || ""); setDisabled(!!d.disabled); } catch (e: any) { if (current === generation.current && request === commentGeneration.current) setCommentError(e.message); } finally { if (current === generation.current && request === commentGeneration.current) setCommentBusy(false); }
  }
  async function authorize() { try { const d = await api<any>(`/api/youtube/oauth/start?commenting=true&videoId=${id}`); window.location.assign(d.url); } catch (e: any) { setCommentError(e.message); } }
  async function post(value: string, parentId?: string) {
    if (postLock.current) return false; postLock.current = true; setPosting(true); setCommentError(""); const current = generation.current;
    try { const d = await api<any>(`/api/youtube/watch/${id}/comments`, { method: "POST", body: JSON.stringify({ text: value, parentId }) }); if (current !== generation.current) return false; setNotice(`Comment posted. ${d.moderationNotice || ""}`); if (!parentId) { setText(""); await loadComments(); } return true; } catch (e: any) { if (current === generation.current) setCommentError(e.message); return false; } finally { postLock.current = false; setPosting(false); }
  }
  return <section className="yt-watch" aria-label="Watch video"><header><Link to="/dashboard/youtube-research">Back to research</Link><button onClick={onChef}>Ask YouTube Chef</button></header>
    {error ? <div role="alert"><p>{error}</p><button onClick={() => setRetry(retry + 1)}>Try again</button></div> : <div className="yt-watch-grid"><main>
      <section className="yt-watch-content">{!video ? <div className="yt-watch-skeleton" role="status">Loading video</div> : <><div className="yt-watch-player" ref={host} />{(video.embeddable === false || playerError) && <div className="yt-watch-error" role="alert"><p>{video.embeddable === false ? "The owner does not allow this video to be embedded." : playerError}</p><a href={video.url} target="_blank" rel="noreferrer">Watch on YouTube</a>{video.embeddable !== false && <button onClick={() => setRetry(retry + 1)}>Retry player</button>}</div>}<h1>{video.title}</h1><p className="yt-watch-channel">{video.channelTitle}</p><p>{count(video.statistics?.viewCount)} views {video.statistics?.likeCount != null && ` · ${count(video.statistics.likeCount)} likes`} · {date(video.publishedAt)}</p><details className="yt-watch-description"><summary>Description</summary><p>{video.description || "No description available."}</p></details></>}</section>
      <section className="yt-watch-comments"><div className="yt-watch-heading"><h2>Comments</h2><select aria-label="Sort comments" value={order} onChange={e => setOrder(e.target.value)}><option value="relevance">Top comments</option><option value="time">Newest first</option></select></div>
        {notice && <p role="status">{notice}</p>}{commentError && <div role="alert"><p>{commentError}</p><button onClick={() => void loadComments()}>Retry comments</button></div>}
        {disabled ? <p>Comments are turned off for this video.</p> : <>{canPost ? <form onSubmit={e => { e.preventDefault(); void post(text); }}><label>Add a comment<textarea maxLength={10000} required value={text} onChange={e => setText(e.target.value)} /></label><button disabled={posting || !text.trim()}>{posting ? "Posting" : "Post comment"}</button><small>Posting as {config.connection.channelTitle}. Your comment is public.</small></form> : <div className="yt-watch-signin"><p>{config?.connection ? "Allow YouTube commenting to join the conversation." : "Connect your Google account to comment with your YouTube channel."}</p><button disabled={!config?.oauthConfigured} onClick={() => void authorize()}>{config?.connection ? "Authorize commenting" : "Sign in with Google to comment"}</button></div>}
          {commentBusy && !comments.length && <div role="status" className="yt-watch-skeleton">Loading comments</div>}{!commentBusy && !comments.length && !commentError && <p>No comments yet.</p>}
          {comments.map(c => <Comment key={`${id}-${c.id}`} item={c} canPost={canPost} posting={posting} post={post} />)}{commentToken && <button disabled={commentBusy} onClick={() => void loadComments(true)}>{commentBusy ? "Loading" : "Load more comments"}</button>}</>}
      </section></main><aside className="yt-watch-recommendations"><h2>Recommended videos</h2><p>Related topics and videos from this channel.</p>{recommended.map(v => <Link key={v.id} to={`/dashboard/youtube-research/watch/${v.id}`} className="yt-watch-rec"><img src={v.thumbnail} alt="" loading="lazy" /><div><h3>{v.title}</h3><p>{v.channelTitle}</p><small>{count(v.statistics?.viewCount)} views</small></div></Link>)}{recBusy && <div role="status" className="yt-watch-skeleton">Loading recommendations</div>}{recError && <div role="alert"><p>{recError}</p><button onClick={() => void recommendations()}>Retry recommendations</button></div>}{!recBusy && !recError && !recommended.length && <p>No recommendations available.</p>}{recToken && <button disabled={recBusy} onClick={() => void recommendations(true)}>More videos</button>}</aside></div>}
  </section>;
}
function Comment({ item, canPost, posting, post }: any) {
  const [open, setOpen] = useState(false), [replies, setReplies] = useState<any[]>([]), [token, setToken] = useState(""), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [replying, setReplying] = useState(false), [text, setText] = useState("");
  async function load(more = false) { setBusy(true); setError(""); try { const d = await api<any>(`/api/youtube/comment-replies/${encodeURIComponent(item.id)}${more ? `?pageToken=${encodeURIComponent(token)}` : ""}`); setReplies(old => more ? [...old, ...d.items.filter((v: any) => !old.some(x => x.id === v.id))] : d.items); setToken(d.nextPageToken || ""); setLoaded(true); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }
  return <article className="yt-watch-comment"><img src={item.avatar} alt="" loading="lazy" /><div><strong>{item.author}</strong><time>{date(item.date)}</time><p>{item.text}</p><small>{count(item.likes)} likes</small>{canPost && item.canReply !== false && <button onClick={() => setReplying(!replying)}>Reply</button>}{replying && <form onSubmit={async e => { e.preventDefault(); if (await post(text, item.id)) { setText(""); setReplying(false); setOpen(true); void load(); } }}><label>Write a reply<textarea required maxLength={10000} value={text} onChange={e => setText(e.target.value)} /></label><button disabled={posting || !text.trim()}>Post reply</button></form>}{(item.replyCount > 0 || loaded) && <button aria-expanded={open} onClick={() => { setOpen(!open); if (!loaded && !open) void load(); }}>{open ? "Hide replies" : `View ${item.replyCount} replies`}</button>}{open && <div className="yt-watch-replies">{busy && <p role="status">Loading replies</p>}{error && <div role="alert">{error}<button onClick={() => void load()}>Retry replies</button></div>}{replies.map(r => <Comment key={r.id} item={{ ...r, canReply: false }} canPost={false} />)}{token && <button disabled={busy} onClick={() => void load(true)}>More replies</button>}</div>}</div></article>;
}
