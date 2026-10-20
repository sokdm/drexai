import {AIAssistantDashboard} from './pages/dashboard/AIAssistantDashboard';
import {CharacterAnimatorPage} from './pages/dashboard/CharacterAnimatorPage';
import { PrivacyPage } from "./pages/PrivacyPage";
import { AdminPage } from "./pages/AdminPage";
import { PlatformStatus } from "./components/PlatformStatus";
import { SupportPage } from "./pages/dashboard/SupportPage";
import { FeedbackPage } from "./pages/dashboard/FeedbackPage";
import { NotificationsPage } from "./pages/dashboard/NotificationsPage";
import { PublishingPage } from "./pages/dashboard/PublishingPage";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, ProtectedRoute } from "./lib/auth";
import { LandingPage } from "./pages/LandingPage";
import { TermsPage } from "./pages/TermsPage";
import { AuthPage } from "./pages/auth/AuthPage";
import { DashboardLayout } from "./pages/dashboard/DashboardLayout";
import { DashboardHome } from "./pages/dashboard/DashboardHome";
import { ToolPlaceholder } from "./pages/dashboard/ToolPlaceholder";
import { SettingsPage } from "./pages/dashboard/SettingsPage";
import { WalletPage } from "./pages/dashboard/WalletPage";
import { YouTubeResearchPage } from "./pages/dashboard/YouTubeWorkspace";
import { MyYouTubeChannelPage } from "./pages/dashboard/MyYouTubeChannelPage";
import { NichesPage } from "./pages/dashboard/NichesPage";
import { ScriptBuilderPage } from "./pages/dashboard/ScriptBuilderPage";
import { ProjectsPage } from "./pages/dashboard/ProjectsPage";
import { AIStudioPage } from "./pages/dashboard/AIStudioPage";
import { TextToImagePage } from "./pages/dashboard/TextToImagePage";
import { ImageToVideoPage } from "./pages/dashboard/ImageToVideoPage";
import { VoiceStudioPage } from "./pages/dashboard/VoiceStudioPage";
import { VideoEditorPage } from "./pages/dashboard/VideoEditorPage";
import "./styles.css";
import "./admin.css";
import "./agent.css";
import "./production-reference.css";

const queryClient = new QueryClient();
const tools = [
  "youtube-research", "ai-assistant", "my-niches", "script-builder", "text-to-image",
  "image-to-video", "voice-studio", "ai-studio", "video-editor", "projects",
  "media-library", "publishing", "credit-wallet", "support", "feedback", "settings"
];

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
        <PlatformStatus><Routes>
          <Route path="/admin/*" element={<AdminPage />} />
          <Route path="/" element={<LandingPage />} />
          <Route path="/terms" element={<TermsPage />} /><Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
          <Route path="/verify-email" element={<AuthPage mode="verify" />} />
          <Route path="/reset-password" element={<AuthPage mode="reset" />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
            <Route index element={<DashboardHome />} />
            {tools.filter((tool) => !["support", "feedback", "settings", "credit-wallet", "youtube-research", "publishing", "ai-assistant", "my-niches", "script-builder", "projects", "ai-studio", "text-to-image", "image-to-video", "voice-studio", "video-editor"].includes(tool)).map((tool) => <Route key={tool} path={tool} element={<ToolPlaceholder slug={tool} />} />)}
            <Route path="youtube-research/*" element={<YouTubeResearchPage />} />
            <Route path="youtube-channel" element={<MyYouTubeChannelPage />} />
            <Route path="publishing" element={<PublishingPage />} />
            <Route path="ai-assistant" element={<AIAssistantDashboard />} />
            <Route path="my-niches" element={<NichesPage />} />
            <Route path="script-builder" element={<ScriptBuilderPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="ai-studio" element={<AIStudioPage />} />
            <Route path="video-editor" element={<VideoEditorPage />} />
            <Route path="text-to-image" element={<TextToImagePage />} />
            <Route path="image-to-video" element={<ImageToVideoPage />} />
            <Route path="character-animator" element={<CharacterAnimatorPage />} />
            <Route path="voice-studio" element={<VoiceStudioPage />} />
            <Route path="credit-wallet" element={<WalletPage />} />
            <Route path="wallet" element={<Navigate to="/dashboard/credit-wallet" replace />} />
            <Route path="support" element={<SupportPage />} />
            <Route path="feedback" element={<FeedbackPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></PlatformStatus>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
