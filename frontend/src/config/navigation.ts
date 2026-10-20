import { Bell, Bot, Clapperboard, Coins, Compass, CreditCard, Edit3, Headphones, Image, LayoutDashboard, Library, Megaphone, MessageCircle, Mic, PenLine, Rocket, Settings, Sparkles, Users, Video } from "lucide-react";

export const dashboardItems = [
  { label: "Overview", path: "/dashboard", icon: LayoutDashboard },
  { label: "YouTube Research", path: "/dashboard/youtube-research", icon: Compass },
  { label: "My YouTube Channel", path: "/dashboard/youtube-channel", icon: Users },
  { label: "AI Assistant", path: "/dashboard/ai-assistant", icon: Bot },
  { label: "My Niches", path: "/dashboard/my-niches", icon: Sparkles },
  { label: "Script Builder", path: "/dashboard/script-builder", icon: PenLine },
  { label: "Text to Image", path: "/dashboard/text-to-image", icon: Image },
  { label: "Image to Video", path: "/dashboard/image-to-video", icon: Video },
  { label: "Character Animator", path: "/dashboard/character-animator", icon: Sparkles },
  { label: "Voice Studio", path: "/dashboard/voice-studio", icon: Mic },
  { label: "AI Studio", path: "/dashboard/ai-studio", icon: Clapperboard },
  { label: "Video Editor", path: "/dashboard/video-editor", icon: Edit3 },
  { label: "Projects", path: "/dashboard/projects", icon: Rocket },
  { label: "Media Library", path: "/dashboard/media-library", icon: Library },
  { label: "Publishing", path: "/dashboard/publishing", icon: Megaphone },
  { label: "Credit Wallet", path: "/dashboard/credit-wallet", icon: Coins },
  { label: "Notifications", path: "/dashboard/notifications", icon: Bell },
  { label: "Support", path: "/dashboard/support", icon: Headphones },
  { label: "Feedback", path: "/dashboard/feedback", icon: MessageCircle },
  { label: "Settings", path: "/dashboard/settings", icon: Settings, settings: true }
];

export const quickTools = dashboardItems.slice(1, 7);
