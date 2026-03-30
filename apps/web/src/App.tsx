import { Navigate, Route, Routes } from "react-router-dom";
import { GuestOnly } from "./components/auth/GuestOnly";
import { RequireAuth } from "./components/auth/RequireAuth";
import { AdminLayout } from "./components/admin/AdminLayout";
import { AppShell } from "./components/layout/AppShell";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { AgentsPage } from "./pages/AgentsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { AssistantDetailPage } from "./pages/AssistantDetailPage";
import { AssistantsPage } from "./pages/AssistantsPage";
import { ConversationsPage } from "./pages/ConversationsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { SettingsPage } from "./pages/SettingsPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";
import { AdminLeadsPage } from "./pages/admin/AdminLeadsPage";
import { AdminOrganizationsPage } from "./pages/admin/AdminOrganizationsPage";
import { AdminPlansPage } from "./pages/admin/AdminPlansPage";
import { AdminUsagePage } from "./pages/admin/AdminUsagePage";
import { AdminUsersPage } from "./pages/admin/AdminUsersPage";

export default function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="organizations" replace />} />
          <Route path="organizations" element={<AdminOrganizationsPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="plans" element={<AdminPlansPage />} />
          <Route path="usage" element={<AdminUsagePage />} />
          <Route path="leads" element={<AdminLeadsPage />} />
        </Route>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="assistants" element={<AssistantsPage />} />
          <Route path="assistants/:assistantId" element={<AssistantDetailPage />} />
          <Route path="agents/:agentId" element={<AgentDetailPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="conversations" element={<ConversationsPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="api-keys" element={<ApiKeysPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
