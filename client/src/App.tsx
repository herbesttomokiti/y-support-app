import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import TaskList from "./pages/TaskList";
import TaskWork from "./pages/TaskWork";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminTaskCreate from "./pages/admin/AdminTaskCreate";
import AdminProgress from "./pages/admin/AdminProgress";
import AdminTemplates from "./pages/admin/AdminTemplates";
import AdminRecords from "./pages/admin/AdminRecords";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      {/* 作業確認モード */}
      <Route path="/tasks" component={TaskList} />
      <Route path="/tasks/:id/work" component={TaskWork} />
      {/* 管理者モード */}
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/tasks/create" component={AdminTaskCreate} />
      <Route path="/admin/progress" component={AdminProgress} />
      <Route path="/admin/templates" component={AdminTemplates} />
      <Route path="/admin/records" component={AdminRecords} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster richColors position="top-center" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
