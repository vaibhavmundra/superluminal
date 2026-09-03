import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './lib/auth.jsx';
import { BillingProvider } from './lib/billing.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Home from './routes/Home.jsx';
import Login from './routes/Login.jsx';
import Pricing from './routes/Pricing.jsx';
import Dashboard from './routes/Dashboard.jsx';
import ProjectDetail from './routes/ProjectDetail.jsx';
import Planner from './routes/Planner.jsx';
import SharedProject from './routes/SharedProject.jsx';
import SharedPlanViewer from './routes/SharedPlanViewer.jsx';
import AdminUsers from './routes/AdminUsers.jsx';
import AdminUserView from './routes/AdminUserView.jsx';
import AdminUserProject from './routes/AdminUserProject.jsx';
import AdminPlanViewer from './routes/AdminPlanViewer.jsx';
import './styles.css';

// ---------------------------------------------------------------------------
// THE FIVE SCREENS.
//
//   /                 the promise, and the upload that starts everything
//   /login            an email and a six-digit code
//   /pricing          the three tiers, and instant checkout
//   /dashboard        every project — yours, and the ones shared with you
//   /projects/:id     every plan in one project
//   /plans/:id        the editor — what used to be the whole app
//
// AND TWO FOR A VIEW LINK, which are the middle two again with a token where the
// id would be:
//
//   /shared/:token                    the project a link points at, read only
//   /shared/:token/plans/:planId      one of its plans, on the real canvas
//
// AND FOUR MORE FOR THE OPERATOR, which are a mirror of the middle three plus a
// list at the top:
//
//   /admin/users                          who is using this, and what they made
//   /admin/users/:userId                  their dashboard, as they see it
//   /admin/users/:userId/projects/:id     their plans in one project
//   /admin/plans/:planId                  one plan on the real canvas, read only
//
// THEY ARE WRAPPED IN RequireAuth AND NOTHING MORE, and that is not an oversight.
// A route guard that also checked `isAdmin` would be checking a value the browser
// computes from a row it fetched — worth doing for the RAIL, where the cost of
// being wrong is a link that leads nowhere, and worth nothing as security. The
// real gate is in api/admin.js, server-side, on every request. A non-admin who
// types one of these URLs gets the screen and then an honest "This is an
// admin-only screen." where the data would have been.
//
// BROWSER ROUTER, NOT HASH ROUTER, and that decision reaches into vite.config.js
// and vercel.json: real paths need the host to serve index.html for a URL that
// is not a file (the rewrite in vercel.json) and need `base: '/'` rather than
// './' (a relative base resolves /assets against /projects/, which 404s the
// bundle on a deep link — see the note in vite.config.js).
//
// AuthProvider IS OUTSIDE THE ROUTER'S ROUTES BUT INSIDE THE ROUTER, because
// RequireAuth calls useLocation to remember where somebody was heading.
// ---------------------------------------------------------------------------
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        {/* INSIDE AuthProvider, BECAUSE THE BALANCE IS READ WITH THE SESSION'S
            TOKEN AND IS EMPTY WITHOUT ONE. Outside the Routes so the profile
            menu, the pricing page and the editor's paywall all read one copy of
            it: three fetches of the same balance is three answers that can
            disagree by a click. */}
        <BillingProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          {/* PUBLIC, AND NOT AN OVERSIGHT. A price a visitor cannot read without
              making an account is a price they assume is bad, and this page is
              also what gets forwarded to whoever signs the cheque — who has no
              login. Choosing a tier while signed out defers to /login and comes
              back with the choice intact. */}
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/projects/:projectId" element={<RequireAuth><ProjectDetail /></RequireAuth>} />
          <Route path="/plans/:planId" element={<RequireAuth><Planner /></RequireAuth>} />

          {/* A VIEW LINK, REDEEMED. Two screens, mirroring /projects/:id and
              /plans/:id, and the token stands where the ids would.

              BEHIND RequireAuth LIKE EVERYTHING ELSE, which is the whole reason
              the flow works with no extra code: an anonymous visitor is sent to
              /login with this path remembered, and Login navigates back to it
              the moment a session appears. "Sign in first, then see the plan" is
              the guard's existing behaviour, not a special case.

              NOTE THE TWO PATHS. The address people are GIVEN is /s/<token>,
              which is not a route at all — it is rewritten to api/share.js so a
              scraper gets an Open Graph card with the layout in it, and a person
              is redirected here. See the endpoint's header.

              AND THAT REWRITE MUST STAY ABOVE THE CATCH-ALL IN vercel.json,
              where JSON gives it nowhere to say so itself. The catch-all matches
              everything that is not /api/ — /s/ included — so if the two ever
              swap places every share link is handed index.html and every preview
              in every chat window falls back to the generic site card, silently
              and only in production. */}
          <Route path="/shared/:token" element={<RequireAuth><SharedProject /></RequireAuth>} />
          <Route path="/shared/:token/plans/:planId"
            element={<RequireAuth><SharedPlanViewer /></RequireAuth>} />

          <Route path="/admin/users" element={<RequireAuth><AdminUsers /></RequireAuth>} />
          <Route path="/admin/users/:userId" element={<RequireAuth><AdminUserView /></RequireAuth>} />
          <Route path="/admin/users/:userId/projects/:projectId"
            element={<RequireAuth><AdminUserProject /></RequireAuth>} />
          <Route path="/admin/plans/:planId" element={<RequireAuth><AdminPlanViewer /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </BillingProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
