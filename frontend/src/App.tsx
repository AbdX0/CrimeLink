import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import DataCenterPage from "./pages/DataCenterPage";
import EntitySearchPage from "./pages/EntitySearchPage";
import GraphPage from "./pages/GraphPage";
import AlertsPage from "./pages/AlertsPage";
import AuditLogsPage from "./pages/AuditLogsPage";
import DocumentsPage from "./pages/DocumentsPage";
import ProcessingPage from "./pages/ProcessingPage";
import CasesPage from "./pages/CasesPage";
import CreateCasePage from "./pages/CreateCasePage";
import CaseDetailPage from "./pages/CaseDetailPage";
import AIAssistantPage from "./pages/AIAssistantPage";
import ReportsPage from "./pages/ReportsPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="cases" element={<CasesPage />} />
        <Route path="cases/create" element={<CreateCasePage />} />
        <Route path="cases/:id" element={<CaseDetailPage />} />
        <Route path="datacenter" element={<DataCenterPage />} />
        <Route path="records" element={<DataCenterPage />} />
        <Route path="processing" element={<ProcessingPage />} />
        <Route path="entities" element={<EntitySearchPage />} />
        <Route path="network" element={<GraphPage />} />
        <Route path="graph" element={<GraphPage />} />
        <Route path="analytics" element={<GraphPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="ai" element={<AIAssistantPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="logs" element={<AuditLogsPage />} />
        <Route path="audit-logs" element={<AuditLogsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
