import { useState } from "react";
import { supabase } from "./supabaseClient";

export default function Auth() {
  var [email, setEmail] = useState("");
  var [password, setPassword] = useState("");
  var [isSignUp, setIsSignUp] = useState(false);
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    if (isSignUp) {
      var { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message);
      } else {
        setMessage("Check your email for a confirmation link!");
      }
    } else {
      var { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
      }
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm max-w-sm w-full space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center justify-center gap-2">
            <svg width="32" height="32" viewBox="0 0 100 100">
              <ellipse cx="50" cy="88" rx="22" ry="14" fill="#1e1b4b" />
              <ellipse cx="50" cy="85" rx="10" ry="8" fill="white" opacity="0.9" />
              <polygon points="45,78 50,81 55,78 55,84 50,81 45,84" fill="#ef4444" />
              <circle cx="50" cy="55" r="22" fill="#fcd34d" />
              <circle cx="36" cy="60" r="5" fill="#fca5a5" opacity="0.5" />
              <circle cx="64" cy="60" r="5" fill="#fca5a5" opacity="0.5" />
              <text x="40" y="56" textAnchor="middle" fontSize="10" fill="#1e1b4b">◠</text>
              <text x="60" y="56" textAnchor="middle" fontSize="10" fill="#1e1b4b">◠</text>
              <text x="50" y="68" textAnchor="middle" fontSize="14" fill="#1e1b4b">◡</text>
              <g><rect x="32" y="18" width="36" height="22" rx="3" fill="#1e1b4b" /><rect x="27" y="37" width="46" height="5" rx="2" fill="#1e1b4b" /><rect x="34" y="30" width="32" height="3" rx="1" fill="#6366f1" /></g>
              <g><line x1="74" y1="70" x2="96" y2="50" stroke="#92400e" strokeWidth="2.5" strokeLinecap="round" /><circle cx="96" cy="49" r="2" fill="white" /></g>
            </svg>
            <span>Audition Tracker</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">{isSignUp ? "Create your account" : "Sign in to continue"}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Email</label>
            <input
              type="email"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={email}
              onChange={function(e) { setEmail(e.target.value); }}
              placeholder="you@email.com"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Password</label>
            <input
              type="password"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={password}
              onChange={function(e) { setPassword(e.target.value); }}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {message && <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40"
          >
            {loading ? "..." : isSignUp ? "Sign Up" : "Sign In"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            onClick={function() { setIsSignUp(!isSignUp); setError(""); setMessage(""); }}
            className="text-indigo-600 font-medium hover:underline"
          >
            {isSignUp ? "Sign In" : "Sign Up"}
          </button>
        </p>
      </div>
    </div>
  );
}
