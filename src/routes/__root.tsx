import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { AuthProvider } from "../lib/auth-context";
import { I18nProvider } from "../lib/i18n";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-6xl font-bold text-foreground">404</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This page doesn't exist.
        </p>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Nelson Fixture Management System" },
      { name: "description", content: "Nelson Global fixture tracking system." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Nelson Fixture Management System" },
      { name: "twitter:title", content: "Nelson Fixture Management System" },
      { property: "og:description", content: "Nelson Global fixture tracking system." },
      { name: "twitter:description", content: "Nelson Global fixture tracking system." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/b2390df3-712f-4ccd-b8ab-7e7633625881/id-preview-3a12665d--6ff39a64-698c-4ea9-a9cd-5ff47061fd88.lovable.app-1780332710397.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/b2390df3-712f-4ccd-b8ab-7e7633625881/id-preview-3a12665d--6ff39a64-698c-4ea9-a9cd-5ff47061fd88.lovable.app-1780332710397.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthProvider>
          <Outlet />
          <Toaster position="bottom-right" richColors />
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
