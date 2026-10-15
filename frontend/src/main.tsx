import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

import { AuthProvider } from "@/auth/AuthContext";
import { themeController } from "@/lib/theme";
import { router } from "@/router";
import "@/styles/tokens.css";

// Before the first render, so a stored Light choice never flashes dark.
themeController().start();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const container = document.getElementById("root");
if (!container) throw new Error("Application root element is missing");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // service worker registration failures should not block the app
    });
  });
}
