import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";
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
    <>
      <Toaster
        position="top-right"
        gutter={8}
        toastOptions={{
          duration: 3500,
          style: {
            background: '#141417',
            color: '#f4f4f5',
            border: '1px solid #27272a',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: '500',
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            boxShadow:
              '0 12px 24px -6px rgba(0, 0, 0, 0.6), 0 0 1px 1px rgba(255, 255, 255, 0.05)',
            padding: '10px 14px',
          },
          success: {
            iconTheme: {
              primary: '#10b981',
              secondary: '#141417',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: '#141417',
            },
          },
        }}
      />
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
    </>
  );
}
