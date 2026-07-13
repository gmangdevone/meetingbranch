import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";

import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Dashboard } from "./pages/Dashboard";
import { Register } from "./pages/Register";
import { RegistrationDetail } from "./pages/RegistrationDetail";
import { Schedule } from "./pages/Schedule";
import { Announcements } from "./pages/Announcements";
import { FAQ } from "./pages/FAQ";

import { AdminGuard } from "./components/AdminGuard";
import { AdminOverview } from "./pages/admin/AdminOverview";
import { AdminRegistrations } from "./pages/admin/AdminRegistrations";
import { AdminRegistrationDetail } from "./pages/admin/AdminRegistrationDetail";
import { AdminReports } from "./pages/admin/AdminReports";
import { AdminAnnouncements } from "./pages/admin/AdminAnnouncements";
import { AdminSchedule } from "./pages/admin/AdminSchedule";
import { AdminUsers } from "./pages/admin/AdminUsers";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(15 80% 55%)",
    colorForeground: "hsl(220 15% 15%)",
    colorMutedForeground: "hsl(220 10% 45%)",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(35 20% 95%)",
    colorInputForeground: "hsl(220 15% 15%)",
    colorNeutral: "hsl(35 20% 85%)",
    fontFamily: '"Outfit", sans-serif',
    borderRadius: "1rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-3xl w-[440px] max-w-full overflow-hidden shadow-xl border border-[hsl(35,20%,85%)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-serif text-3xl font-bold text-[hsl(220,15%,15%)]",
    headerSubtitle: "text-[hsl(220,10%,45%)] font-medium",
    socialButtonsBlockButtonText: "font-bold text-[hsl(220,15%,15%)]",
    formFieldLabel: "font-bold text-sm text-[hsl(220,15%,15%)]",
    footerActionLink: "font-bold text-[hsl(15,80%,55%)] hover:text-[hsl(15,80%,45%)]",
    footerActionText: "text-[hsl(220,10%,45%)] font-medium",
    dividerText: "text-[hsl(220,10%,45%)] font-medium",
    identityPreviewEditButton: "text-[hsl(15,80%,55%)] font-medium",
    formFieldSuccessText: "text-[hsl(120,60%,40%)]",
    alertText: "text-[hsl(0,84%,60%)]",
    logoBox: "h-12 flex justify-center mb-4",
    logoImage: "h-12 w-auto object-contain",
    socialButtonsBlockButton: "border border-[hsl(35,20%,85%)] rounded-xl py-3 hover:bg-[hsl(35,15%,95%)] transition-colors",
    formButtonPrimary: "bg-[hsl(15,80%,55%)] text-white hover:bg-[hsl(15,80%,45%)] rounded-full py-3 font-bold text-base transition-colors shadow-md",
    formFieldInput: "bg-[hsl(35,15%,95%)] border-transparent focus:border-[hsl(15,80%,55%)] focus:ring-[hsl(15,80%,55%)] rounded-xl px-4 py-3 font-medium",
    footerAction: "mt-6 border-t border-[hsl(35,20%,85%)] pt-6 flex flex-col gap-2 items-center",
    dividerLine: "bg-[hsl(35,20%,85%)]",
    alert: "bg-red-50 border border-red-200 rounded-xl p-3",
    otpCodeFieldInput: "bg-[hsl(35,15%,95%)] border-transparent focus:border-[hsl(15,80%,55%)] focus:ring-[hsl(15,80%,55%)] rounded-xl",
    formFieldRow: "mb-5",
    main: "p-8",
  },
};

function SignInPage() {
  return (
    <Layout>
      <div className="flex items-center justify-center py-12 px-4">
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </Layout>
  );
}

function SignUpPage() {
  return (
    <Layout>
      <div className="flex items-center justify-center py-12 px-4">
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      </div>
    </Layout>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Layout><Home /></Layout>
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType<any> }) {
  return (
    <>
      <Show when="signed-in">
        <Layout><Component /></Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function NotFound() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h1 className="font-serif text-6xl font-bold text-secondary mb-4">404</h1>
        <p className="text-xl text-muted-foreground mb-8">This page got lost in the family tree.</p>
        <Redirect to="/" />
      </div>
    </Layout>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome to FamJam",
            subtitle: "Sign in to access your family account",
          },
        },
        signUp: {
          start: {
            title: "Join the Family",
            subtitle: "Create an account to register",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
          <Route path="/register" component={() => <ProtectedRoute component={Register} />} />
          <Route path="/registrations/:id" component={() => <ProtectedRoute component={RegistrationDetail} />} />
          <Route path="/schedule" component={() => <Layout><Schedule /></Layout>} />
          <Route path="/announcements" component={() => <Layout><Announcements /></Layout>} />
          <Route path="/faq" component={() => <Layout><FAQ /></Layout>} />
          
          <Route path="/admin" component={() => <AdminGuard><AdminOverview /></AdminGuard>} />
          <Route path="/admin/registrations" component={() => <AdminGuard><AdminRegistrations /></AdminGuard>} />
          <Route path="/admin/registrations/:id" component={() => <AdminGuard><AdminRegistrationDetail /></AdminGuard>} />
          <Route path="/admin/reports" component={() => <AdminGuard><AdminReports /></AdminGuard>} />
          <Route path="/admin/announcements" component={() => <AdminGuard><AdminAnnouncements /></AdminGuard>} />
          <Route path="/admin/schedule" component={() => <AdminGuard><AdminSchedule /></AdminGuard>} />
          <Route path="/admin/users" component={() => <AdminGuard><AdminUsers /></AdminGuard>} />

          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
