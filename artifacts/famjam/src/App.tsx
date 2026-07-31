import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, RedirectToSignIn } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect, Link } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { useGetMyAccess, getGetMyAccessQueryKey, useListMyRegistrations, useListMyReunions } from "@workspace/api-client-react";

import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Dashboard } from "./pages/Dashboard";
import { CreateReunion } from "./pages/CreateReunion";
import { JoinReunion } from "./pages/JoinReunion";
import { ReunionHub } from "./pages/ReunionHub";
import { ReunionRegister } from "./pages/ReunionRegister";
import { ReunionSchedule } from "./pages/ReunionSchedule";
import { ReunionAnnouncements } from "./pages/ReunionAnnouncements";
import { ReunionPolls } from "./pages/ReunionPolls";
import { RegistrationDetail } from "./pages/RegistrationDetail";
import { FAQ } from "./pages/FAQ";

import { OrganizerOverview } from "./pages/organize/OrganizerOverview";
import { OrganizerRegistrations } from "./pages/organize/OrganizerRegistrations";
import { OrganizerReports } from "./pages/organize/OrganizerReports";
import { OrganizerAnnouncements } from "./pages/organize/OrganizerAnnouncements";
import { OrganizerSchedule } from "./pages/organize/OrganizerSchedule";
import { OrganizerBranches } from "./pages/organize/OrganizerBranches";
import { OrganizerSettings } from "./pages/organize/OrganizerSettings";
import { OrganizerSponsorship } from "./pages/organize/OrganizerSponsorship";
import { OrganizerPolls } from "./pages/organize/OrganizerPolls";
import { OrganizerVendors } from "./pages/organize/OrganizerVendors";

import { AdminArea } from "./pages/admin/AdminArea";

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
    colorPrimary: "#1F5D8C",
    colorForeground: "#1E2A33",
    colorMutedForeground: "#617079",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "#FFFDF6",
    colorInput: "#EADFC9",
    colorInputForeground: "#1E2A33",
    colorNeutral: "#EADFC9",
    fontFamily: '"Mulish", system-ui, sans-serif',
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

function PostLoginLanding() {
  const { data: registrations, isLoading: loadingRegistrations } = useListMyRegistrations();
  const { data: reunions, isLoading: loadingReunions } = useListMyReunions();

  if (loadingRegistrations || loadingReunions) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  // Organizers go to the dashboard where their reunions are managed.
  if (reunions && reunions.length > 0) {
    return <Redirect to="/dashboard" />;
  }

  // Unique reunions the user has an active registration in.
  const joined = new Map<string, { code: string; name: string }>();
  for (const reg of registrations ?? []) {
    if (reg.status === "cancelled" || !reg.reunionCode) continue;
    if (!joined.has(reg.reunionCode)) {
      joined.set(reg.reunionCode, {
        code: reg.reunionCode,
        name: reg.reunionName || `Reunion ${reg.reunionCode}`,
      });
    }
  }

  if (joined.size === 0) {
    return <Redirect to="/dashboard" />;
  }

  if (joined.size === 1) {
    const only = joined.values().next().value!;
    return <Redirect to={`/r/${only.code}`} />;
  }

  return (
    <div className="max-w-xl mx-auto py-16 px-4 flex flex-col gap-8">
      <div className="text-center">
        <h1 className="font-serif text-4xl font-bold mb-2">Welcome Back</h1>
        <p className="text-lg text-muted-foreground">Which reunion would you like to visit?</p>
      </div>
      <div className="flex flex-col gap-4">
        {[...joined.values()].map((r) => (
          <Link
            key={r.code}
            href={`/r/${r.code}`}
            className="bg-card border shadow-sm rounded-3xl p-6 flex items-center justify-between gap-4 hover:border-primary/50 hover:shadow-md transition-all group"
          >
            <div>
              <h3 className="font-bold text-lg group-hover:text-primary transition-colors">{r.name}</h3>
              <p className="text-sm text-muted-foreground font-mono">{r.code}</p>
            </div>
            <span className="text-primary font-medium shrink-0">Go to Hub →</span>
          </Link>
        ))}
      </div>
      <div className="text-center">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground text-sm font-medium hover:underline">
          Go to my dashboard instead
        </Link>
      </div>
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Layout><PostLoginLanding /></Layout>
      </Show>
      <Show when="signed-out">
        <Layout><Home /></Layout>
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const [location] = useLocation();
  // Preserve the page the user was trying to reach so they land back on it
  // (e.g. the registration form) after signing in, instead of being bounced home.
  const returnUrl = `${basePath}${location}`;
  return (
    <>
      <Show when="signed-in">
        <AccessGate>
          <Layout><Component /></Layout>
        </AccessGate>
      </Show>
      <Show when="signed-out">
        <RedirectToSignIn signInForceRedirectUrl={returnUrl} signUpForceRedirectUrl={returnUrl} />
      </Show>
    </>
  );
}

function AccessGate({ children }: { children: React.ReactNode }) {
  const { signOut } = useClerk();
  const { data: access, isLoading } = useGetMyAccess({
    query: { queryKey: getGetMyAccessQueryKey() }
  });

  if (isLoading) {
    return <Layout><div className="flex justify-center py-20 text-muted-foreground">Checking access...</div></Layout>;
  }

  if (access && !access.allowed) {
    return (
      <Layout>
        <div className="max-w-xl mx-auto py-20 text-center flex flex-col items-center">
          <div className="bg-destructive/10 text-destructive w-20 h-20 rounded-full flex items-center justify-center mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </div>
          <h1 className="font-serif text-4xl font-bold mb-4">Temporarily Closed</h1>
          <p className="text-lg text-muted-foreground mb-8">
            The platform is currently locked down for testing and maintenance. Only organizers and testing accounts are permitted right now. Please check back later!
          </p>
          <button 
            onClick={() => signOut()} 
            className="text-primary font-bold hover:underline"
          >
            Sign out
          </button>
        </div>
      </Layout>
    );
  }

  return <>{children}</>;
}

function NotFound() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h1 className="font-serif text-6xl font-bold text-secondary mb-4">404</h1>
        <p className="text-xl text-muted-foreground mb-8">This page got lost in the family tree.</p>
        <Link href="/" className="text-primary font-bold hover:underline">Go Home</Link>
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
          <Route path="/create" component={() => <ProtectedRoute component={CreateReunion} />} />
          
          <Route path="/join" component={() => <Layout><JoinReunion /></Layout>} />
          
          <Route path="/r/:code">
            {(params) => <Layout><ReunionHub params={params} /></Layout>}
          </Route>
          <Route path="/r/:code/register">
            {(params) => <ProtectedRoute component={() => <ReunionRegister params={params} />} />}
          </Route>
          <Route path="/r/:code/register/edit/:editId">
            {(params) => <ProtectedRoute component={() => <ReunionRegister params={params} />} />}
          </Route>
          <Route path="/r/:code/schedule">
            {(params) => <Layout><ReunionSchedule params={params} /></Layout>}
          </Route>
          <Route path="/r/:code/announcements">
            {(params) => <Layout><ReunionAnnouncements params={params} /></Layout>}
          </Route>
          <Route path="/r/:code/polls">
            {(params) => <Layout><ReunionPolls params={params} /></Layout>}
          </Route>

          <Route path="/registrations/:id">
            {(params) => <ProtectedRoute component={() => <RegistrationDetail params={params} />} />}
          </Route>

          {/* Organizer routes */}
          <Route path="/organize/:reunionId">
            {(params) => <ProtectedRoute component={() => <OrganizerOverview params={params} />} />}
          </Route>
          <Route path="/organize/:reunionId/registrations">
            {(params) => <ProtectedRoute component={() => <OrganizerRegistrations params={params} />} />}
          </Route>
          <Route path="/organize/:reunionId/reports">
            {(params) => <ProtectedRoute component={() => <OrganizerReports params={params} />} />}
          </Route>
          <Route path="/organize/:reunionId/announcements">
            {(params) => <ProtectedRoute component={() => <OrganizerAnnouncements params={params} />} />}
          </Route>
          <Route path="/organize/:reunionId/schedule">
            {(params) => <ProtectedRoute component={() => <OrganizerSchedule params={params} />} />}
          </Route>
          <Route path="/organize/:reunionId/branches">
            {(params) => <ProtectedRoute component={() => <OrganizerBranches params={params} />} />}
          </Route>
          <Route path="/organize/:reunionId/sponsorship">
            {(params) => <ProtectedRoute component={() => <OrganizerSponsorship params={params} />} />}
          </Route>
          <Route path="/organize/:reunionId/polls">
            {(params) => <ProtectedRoute component={() => <OrganizerPolls params={params} />} />}
          </Route>
          <Route path="/organize/:reunionId/vendors">
            {(params) => <ProtectedRoute component={() => <OrganizerVendors params={params} />} />}
          </Route>
          <Route path="/organize/:reunionId/settings">
            {(params) => <ProtectedRoute component={() => <OrganizerSettings params={params} />} />}
          </Route>

          <Route path="/admin" component={() => <ProtectedRoute component={AdminArea} />} />
          
          <Route path="/faq" component={() => <Layout><FAQ /></Layout>} />

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
