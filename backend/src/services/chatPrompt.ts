// Keep the latest request intact and bound older context/evidence by UTF-8 bytes.
export function chatPrompt(message:string,sections:string[],maxBytes:number){
 const header='Latest request:\n'+message+'\nSaved context and evidence (bounded excerpts):\n';
 const remaining=maxBytes-Buffer.byteLength(header,'utf8');
 if(remaining<0)throw new Error('This message is too long for the current chat allowance. Please shorten it.');
 const budget=Math.max(0,Math.floor(remaining/Math.max(1,sections.length))-4);
 return header+sections.map(s=>Buffer.from(s,'utf8').subarray(0,budget).toString('utf8').replace(/\uFFFD$/,'')).join('\n');
}
