/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import DiffPage from "./pages/DiffPage";
import Settings from "./pages/Settings";

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Dashboard} />
      <Route path="/diff/:owner/:repo/:number" component={DiffPage} />
      <Route path="/settings" component={Settings} />
    </Router>
  ),
  document.getElementById("root") as HTMLElement,
);
