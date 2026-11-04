import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { AuthProvider, PERM, useAuth } from './lib/auth';
import { ReferenceProvider } from './lib/reference';
import { ToastProvider } from './lib/toast';
import { AppLayout } from './layout/AppLayout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const SubjectAnalysis = lazy(() => import('./pages/SubjectAnalysis'));
const Students = lazy(() => import('./pages/Students'));
const StudentProfile = lazy(() => import('./pages/StudentProfile'));
const Classes = lazy(() => import('./pages/Classes'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Movements = lazy(() => import('./pages/Movements'));
const Assessments = lazy(() => import('./pages/Assessments'));
const Journal = lazy(() => import('./pages/Journal'));
const Plan = lazy(() => import('./pages/Plan'));
const TjbAnalysis = lazy(() => import('./pages/TjbAnalysis'));
const QuarterReport = lazy(() => import('./pages/QuarterReport'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));
const Audit = lazy(() => import('./pages/Audit'));
const Admin = lazy(() => import('./pages/Admin'));

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function Guard({ perm, children }: { perm?: string; children: JSX.Element }) {
  const { can } = useAuth();
  if (perm && !can(perm)) return <Navigate to="/" replace />;
  return children;
}

function Root() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner block />;
  if (!me) return <LoginPage />;
  return (
    <ReferenceProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route
            path="*"
            element={
              <Suspense fallback={<Spinner block />}>
                <Routes>
                  <Route index element={<Dashboard />} />
                  <Route path="students" element={<Students />} />
                  <Route path="students/:id" element={<StudentProfile />} />
                  <Route path="classes" element={<Classes />} />
                  <Route path="attendance" element={<Attendance />} />
                  <Route path="movements" element={<Movements />} />
                  <Route path="journal" element={<Journal />} />
                  <Route path="plan" element={<Plan />} />
                  <Route path="bjb" element={<Assessments type="BJB" />} />
                  <Route path="tjb" element={<Assessments type="TJB" />} />
                  <Route path="aralyk" element={<Assessments type="ARALYK" />} />
                  <Route path="tjb-analysis" element={<TjbAnalysis />} />
                  <Route path="subject-analysis" element={<SubjectAnalysis />} />
                  <Route path="report" element={<QuarterReport />} />
                  <Route path="analytics" element={<Analytics />} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="audit" element={<Guard perm={PERM.AUDIT}><Audit /></Guard>} />
                  <Route path="admin" element={<Guard perm={PERM.CLASSES}><Admin /></Guard>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </ReferenceProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <Root />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
