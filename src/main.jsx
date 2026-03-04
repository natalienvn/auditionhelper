import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "./supabaseClient";
import Auth from "./Auth";
import App from "./App";
import "./index.css";

function Root() {
  var [session, setSession] = useState(undefined);

  useEffect(function() {
    supabase.auth.getSession().then(function({ data: { session: s } }) {
      setSession(s);
    });
    var { data: { subscription } } = supabase.auth.onAuthStateChange(function(_event, s) {
      setSession(s);
    });
    return function() { subscription.unsubscribe(); };
  }, []);

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    );
  }

  if (!session) return <Auth />;

  return <App session={session} />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
