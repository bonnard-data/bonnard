import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import { App } from "./app";
import { StatusPage } from "./pages/status";
import { SchemaPage } from "./pages/schema";
import { SchemaDetailPage } from "./pages/schema-detail";
import { McpPage } from "./pages/mcp";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<StatusPage />} />
          <Route path="schema" element={<SchemaPage />} />
          <Route path="schema/:name" element={<SchemaDetailPage />} />
          <Route path="mcp" element={<McpPage />} />
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>,
);
