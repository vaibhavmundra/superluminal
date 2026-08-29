import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './lib/auth.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Home from './routes/Home.jsx';
import Login from './routes/Login.jsx';
import Dashboard from './routes/Dashboard.jsx';
import ProjectDetail from './routes/ProjectDetail.jsx';
import Planner from './routes/Planner.jsx';
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
//   /dashboard        every project
//   /projects/:id     every plan in one project
//   /plans/:id        the editor — what used to be the whole app
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
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/projects/:projectId" element={<RequireAuth><ProjectDetail /></RequireAuth>} />
          <Route path="/plans/:planId" element={<RequireAuth><Planner /></RequireAuth>} />

          <Route path="/admin/users" element={<RequireAuth><AdminUsers /></RequireAuth>} />
          <Route path="/admin/users/:userId" element={<RequireAuth><AdminUserView /></RequireAuth>} />
          <Route path="/admin/users/:userId/projects/:projectId"
            element={<RequireAuth><AdminUserProject /></RequireAuth>} />
          <Route path="/admin/plans/:planId" element={<RequireAuth><AdminPlanViewer /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
