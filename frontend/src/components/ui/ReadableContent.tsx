/** Provider formatting is converted to ordinary text; never render raw HTML or JSON. */
export function plainText(value: unknown): string {
  return String(value ?? "")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/gm, "")
    .replace(/\*\*|__|`|~~/g, "")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,!?]|$)/g, "$1$2")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/\s*\|\s*/g, "   ").trim();
}
const names: Record<string, string> = { mainNiche: "Channel focus", contentThemes: "Content themes", commonVideoFormats: "Video formats", publishingPatterns: "Posting pattern", popularTopics: "Popular topics", audiencePositioningInference: "Likely audience", titlePatterns: "Title ideas", creativeOpportunities: "Opportunities to try", potentialNicheIdeas: "Niche ideas", limitations: "What to keep in mind", rationale: "Why this could work" };
export function readableLabel(key: string) { return names[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, s => s.toUpperCase()); }
export function ReadableContent({ value }: { value: unknown }) {
  if (typeof value === "string") {
    const text = value.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
    if (/^[\[{]/.test(text)) { try { return <ReadableContent value={JSON.parse(text)} />; } catch { /* Ordinary text remains ordinary text. */ } }
    return <div className="readable-content">{plainText(text).split(/\n\s*\n/).filter(Boolean).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>;
  }
  if (Array.isArray(value)) return <div className="readable-items">{value.map((item, i) => <div key={i}><ReadableContent value={item} /></div>)}</div>;
  if (value && typeof value === "object") return <div className="readable-sections">{Object.entries(value).filter(([, content]) => content !== null && content !== "" && !(Array.isArray(content) && !content.length)).map(([key, content]) => <section key={key}><h4>{readableLabel(key)}</h4><ReadableContent value={content} /></section>)}</div>;
  return <p>{plainText(value)}</p>;
}
