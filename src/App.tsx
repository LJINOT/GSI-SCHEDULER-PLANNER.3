import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import Projects from "./pages/Projects";
import AddTask from "./pages/AddTask";
import CalendarView from "./pages/CalendarView";
import Schedule from "./pages/Schedule";
import Priorities from "./pages/Priorities";
import Today from "./pages/Today";
import ThisWeek from "./pages/ThisWeek";
import Completed from "./pages/Completed";
import SmartSuggestions from "./pages/SmartSuggestions";
import AdaptiveScheduling from "./pages/AdaptiveScheduling";
import FocusMode from "./pages/FocusMode";
import DeadlineRisk from "./pages/DeadlineRisk";
import ProductivityInsights from "./pages/ProductivityInsights";
import ProfilePage from "./pages/ProfilePage";
import GeneralSettings from "./pages/GeneralSettings";
import PersonalizationPage from "./pages/PersonalizationPage";
import HelpAbout from "./pages/HelpAbout";
import AlgorithmInsights from "./pages/AlgorithmInsights";
import DeveloperMode from "./pages/DeveloperMode";
import Analytics from "./pages/Analytics";
import Timesheet from "./pages/Timesheet";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="projects" element={<Projects />} />
            <Route path="add-task" element={<AddTask />} />
            <Route path="calendar" element={<CalendarView />} />
            <Route path="auto-schedule" element={<Schedule />} />
            <Route path="priorities" element={<Priorities />} />
            <Route path="today" element={<Today />} />
            <Route path="this-week" element={<ThisWeek />} />
            <Route path="completed" element={<Completed />} />
            <Route path="smart-suggestions" element={<SmartSuggestions />} />
            <Route path="adaptive-scheduling" element={<AdaptiveScheduling />} />
            <Route path="focus-mode" element={<FocusMode />} />
            <Route path="deadline-risk" element={<DeadlineRisk />} />
            <Route path="productivity-insights" element={<ProductivityInsights />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="timesheet" element={<Timesheet />} />
            <Route path="settings/profile" element={<ProfilePage />} />
            <Route path="settings/general" element={<GeneralSettings />} />
            <Route path="settings/personalization" element={<PersonalizationPage />} />
            <Route path="settings/help" element={<HelpAbout />} />
            <Route path="settings/algorithm-insights" element={<AlgorithmInsights />} />
            <Route path="settings/developer" element={<DeveloperMode />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
