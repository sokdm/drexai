export type NicheDraft = {
  name: string;
  description: string;
  category: string;
  audience: string;
  contentStyle: string;
  language: string;
  preferredVideoDuration: string;
  visualStyle: string;
  storytellingStyle: string;
};

export type SavedNiche = NicheDraft & { _id: string; selected: boolean; updatedAt?: string };
export type NicheTemplate = NicheDraft & { id: string };

export const emptyNiche: NicheDraft = {
  name: "", description: "", category: "", audience: "General audience",
  contentStyle: "Faceless explainer", language: "English", preferredVideoDuration: "5-8 minutes",
  visualStyle: "", storytellingStyle: ""
};

export const nicheFormats = ["Faceless explainer", "Documentary", "Animated story", "Tutorial", "Shorts", "Commentary", "Interview", "Vlog", "Podcast"];

const ideas = [
  ["Everyday science", "Science & education", "Faceless explainer", "Explain the science behind familiar objects and everyday questions."],
  ["Space discoveries", "Science & education", "Documentary", "Explore planets, space missions, and the questions scientists are studying."],
  ["Math made visual", "Science & education", "Tutorial", "Build visual explanations of mathematical ideas with worked examples."],
  ["Language in a minute", "Science & education", "Shorts", "Teach vocabulary, pronunciation, and everyday phrases in short lessons."],
  ["AI tools in practice", "Technology", "Tutorial", "Demonstrate useful creative workflows and test what AI tools can actually do."],
  ["Coding small projects", "Technology", "Tutorial", "Build small apps and explain one programming idea at a time."],
  ["How technology works", "Technology", "Faceless explainer", "Unpack the systems behind everyday devices and software."],
  ["Game design breakdowns", "Gaming", "Commentary", "Study level design, storytelling, accessibility, and mechanics in video games."],
  ["Cozy game journeys", "Gaming", "Vlog", "Share relaxed gameplay, creative builds, and discoveries."],
  ["Game lore stories", "Gaming", "Faceless explainer", "Explore fictional worlds with original commentary and research."],
  ["Forgotten inventions", "History & culture", "Documentary", "Tell the stories behind inventions and the people who developed them."],
  ["Culture through objects", "History & culture", "Faceless explainer", "Explore the history of food, clothing, buildings, and everyday objects."],
  ["Local history walks", "History & culture", "Vlog", "Discover local landmarks and the stories connected to them."],
  ["Original animated adventures", "Stories & animation", "Animated story", "Create original characters and imaginative, family-friendly adventures."],
  ["Science-fiction shorts", "Stories & animation", "Shorts", "Tell original short stories about imaginary futures and discoveries."],
  ["Folklore retold", "Stories & animation", "Animated story", "Develop original retellings of public-domain folktales and legends."],
  ["Hidden city details", "Travel & places", "Documentary", "Look closely at architecture, public spaces, and local stories."],
  ["Virtual geography", "Travel & places", "Faceless explainer", "Use maps and original narration to explore landscapes and places."],
  ["Accessible day trips", "Travel & places", "Vlog", "Document local outings with practical accessibility observations."],
  ["Kitchen science", "Food & cooking", "Faceless explainer", "Explain what happens to ingredients during everyday cooking."],
  ["Simple home recipes", "Food & cooking", "Tutorial", "Share approachable recipes, ingredients, and clear cooking demonstrations."],
  ["Food and culture", "Food & cooking", "Documentary", "Explore how recipes connect to communities and traditions."],
  ["Drawing from scratch", "Art & design", "Tutorial", "Teach drawing through simple shapes, exercises, and original projects."],
  ["Design breakdowns", "Art & design", "Commentary", "Examine typography, composition, and visual communication."],
  ["Crafting small worlds", "Art & design", "Tutorial", "Make miniature scenes and paper crafts with accessible materials."],
  ["Music theory visualized", "Music & sound", "Faceless explainer", "Explain rhythm, harmony, and arrangement using original sound examples."],
  ["Original soundscapes", "Music & sound", "Vlog", "Create and document original ambient recordings and compositions."],
  ["Nature close up", "Nature & environment", "Documentary", "Observe ecosystems, plants, and seasonal changes with sourced context."],
  ["Small-space gardening", "Nature & environment", "Tutorial", "Document growing plants, caring for them, and learning from experiments."],
  ["Sport tactics explained", "Sports", "Commentary", "Explain strategy, teamwork, and game rules with original diagrams."],
  ["Stories behind sports", "Sports", "Documentary", "Research the history, equipment, and communities behind sports."],
  ["Study systems", "Lifestyle & learning", "Tutorial", "Explore planning, note-taking, and manageable study routines."],
  ["Creative routines", "Lifestyle & learning", "Vlog", "Document sustainable creative habits and personal projects."],
  ["Books and ideas", "Books & ideas", "Commentary", "Offer original reviews, reading discussions, and thematic analysis."],
  ["Conversations with creators", "People & creativity", "Interview", "Ask creators about their process, experiments, and lessons learned."],
  ["Creative conversations", "People & creativity", "Podcast", "Discuss ideas, storytelling, and creative work with different perspectives."]
] as const;

export const nicheTemplates: NicheTemplate[] = ideas.map(([name, category, contentStyle, description], index) => ({
  ...emptyNiche, id: `idea-${index + 1}`, name, category, contentStyle, description,
  preferredVideoDuration: contentStyle === "Shorts" ? "30-60 seconds" : "5-8 minutes",
  visualStyle: contentStyle === "Animated story" ? "Original character animation" : "Clear visuals with captions",
  storytellingStyle: contentStyle === "Documentary" ? "Research-led narrative" : "Clear, engaging, and conversational"
}));

export const nicheCategories = [...new Set(nicheTemplates.map(({ category }) => category))].sort();
