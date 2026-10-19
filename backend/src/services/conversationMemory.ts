export function conversationContext(messages:any[],query:string,maxChars=10000){
 const tokens=[...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[])];const recent=messages.slice(-12);const older=messages.slice(0,-12).map((m,i)=>({m,i,score:tokens.reduce((n,t)=>n+(String(m.content).toLowerCase().includes(t)?1:0),0)+(m.role==="user"&&i<2?1:0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||b.i-a.i).slice(0,8).sort((a,b)=>a.i-b.i);
 const format=(m:any)=>m.role+': '+String(m.content).slice(0,1800)+(m.metadata?.toolResult?' Saved tool result: '+JSON.stringify(m.metadata.toolResult).slice(0,1600):'');
 const history=older.map(r=>format(r.m)).join('\n').slice(0,Math.floor(maxChars*.4));const latest=recent.map(format).join('\n').slice(-Math.floor(maxChars*.6));return (history?'Relevant saved earlier messages:\n'+history+'\n':'')+'Recent conversation:\n'+latest;
}
