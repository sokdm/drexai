import { z } from "zod";

export const dialogueLineSchema = z.object({
  speaker: z.string().min(1).max(80), text: z.string().min(1).max(8000),
  language: z.string().max(80).optional(), accent: z.string().max(150).optional(),
  emotion: z.string().max(200).optional(), delivery: z.string().max(200).optional()
});
// Optional fields keep older approved scripts readable without rewriting them.
export const sceneAudioFields = {
  dialogueLines: z.array(dialogueLineSchema).max(50).optional(),
  dialogueLanguage: z.string().max(80).optional(), preferredAccent: z.string().max(150).optional(),
  emotionAndDelivery: z.string().max(500).optional(), characterActions: z.string().max(2000).optional(),
  cameraPosition: z.string().max(500).optional(), cameraMovements: z.string().max(500).optional(),
  environmentalSounds: z.string().max(1000).optional(), soundEffects: z.string().max(1000).optional(),
  backgroundAmbience: z.string().max(1000).optional(), estimatedDurationSeconds: z.number().min(1).max(3600).optional(),
  visibleSpeakingCharacters: z.boolean().optional(), offscreenNarration: z.boolean().optional()
};
export type DialogueLine = z.infer<typeof dialogueLineSchema>;
export function sceneDialogue(scene: any): DialogueLine[] {
  if (scene.dialogueLines?.length) return z.array(dialogueLineSchema).parse(scene.dialogueLines);
  return String(scene.dialogue || "").split(/\n+/).filter(s => s.trim()).map(line => {
    const match = line.match(/^([^:]{1,80}):\s*(.+)$/);
    const speaker = match?.[1].trim() || (scene.characters?.length === 1 ? scene.characters[0] : "");
    if (!speaker) throw new Error(`Scene ${scene.order ?? ""}: identify each speaker using Name: dialogue before production.`);
    return { speaker, text: match?.[2] || line.trim() };
  });
}
export function needsNarration(scene: any) {
  return Boolean(scene.narration?.trim()) && (scene.offscreenNarration === true || (scene.offscreenNarration !== false && !sceneDialogue(scene).length));
}
export function segmentDialogue(lines: DialogueLine[], seconds = 8): DialogueLine[][] {
  // Conservative speaking estimate; slower delivery should be split further by the creator.
  const limit = Math.max(1, Math.floor((seconds - 1) * 2));
  const result: DialogueLine[][] = []; let group: DialogueLine[] = [], count = 0;
  for (const line of lines) {
    const words = line.text.trim().split(/\s+/);
    for (let i = 0; i < words.length;) {
      if (count === limit) { result.push(group); group = []; count = 0; }
      const chunk = words.slice(i, i + limit - count); i += chunk.length; count += chunk.length;
      group.push({ ...line, text: chunk.join(" ") });
    }
  }
  if (group.length) result.push(group);
  return result;
}
export function buildVeoPrompt(input: any) {
  const lines: DialogueLine[] = input.dialogueLines ?? [];
  return [input.motionPrompt, input.sceneDescription,
    input.characterDescriptions && `Character continuity: ${input.characterDescriptions}`,
    input.characterActions && `Actions: ${input.characterActions}`,
    [input.cameraDirection, input.cameraPosition, input.cameraMovements].filter(Boolean).join(". "),
    ...lines.map((line, i) => `${i + 1}. ${line.speaker} says ${JSON.stringify(line.text)}. Language: ${line.language || input.dialogueLanguage || "English"}. Accent preference: ${line.accent || input.preferredAccent || "natural"}. Delivery: ${[line.emotion, line.delivery, input.emotionAndDelivery].filter(Boolean).join(", ") || "natural"}.`),
    lines.length ? "Generate the spoken lines in the listed order as native synchronized speech. Frame the speaking character's face with natural expressions and mouth movements matching the speech. Do not add a narrator or subtitles." : "No spoken dialogue. Generate suitable environmental audio with the footage. Do not add speech or narration.",
    input.environmentalSounds && `Environmental sounds: ${input.environmentalSounds}`,
    input.soundEffects && `Sound effects: ${input.soundEffects}`,
    input.backgroundAmbience && `Background ambience: ${input.backgroundAmbience}`,
    `Complete this segment within ${input.durationSeconds || 8} seconds. Voice descriptions are guidance, not cloned or guaranteed voice identities.`
  ].filter(Boolean).join("\n");
}
