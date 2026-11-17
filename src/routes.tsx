import type { RouteObject } from "react-router";
import App from "./App";
import Admin from "./pages/Admin";
import Home from "./pages/Home";
import SecurityLayout from "./security/SecurityLayout";
import SecurityScan from "./pages/SecurityScan";
import SecurityGuide from "./pages/SecurityGuide";
import SecurityHistory from "./pages/SecurityHistory";

// Every page of the app is listed here, and only here. main.tsx builds the router from this
// array and exposes it as window.__baze.routes so the BAZE preview can list the pages.
// App (src/App.tsx) is the shell around every page; it renders the current page in <Outlet />.
// A page only the owner opens carries handle: { owner: true }: the preview's page list groups it
// apart from the visitor pages. The owner layer is in src/owner/ (src/owner/OWNER.md).
export const routes: RouteObject[] = [
  {
    element: <App />,
    children: [
      { path: "/admin", element: <Admin />, handle: { owner: true } },
      { element: <SecurityLayout />, children: [
        { index: true, element: <Home /> },
        { path: "scan", element: <SecurityScan /> },
        { path: "guide", element: <SecurityGuide /> },
        { path: "history", element: <SecurityHistory /> },
        { path: "*", element: <Home /> },
      ] },
    ],
  },
];
