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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
