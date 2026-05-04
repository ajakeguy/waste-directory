"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const USER_TYPES = [
  { value: "waste_broker", label: "Waste Broker" },
  { value: "commercial_waste_manager", label: "Commercial Waste Manager" },
  { value: "municipality", label: "Municipality" },
  { value: "hauler_operator", label: "Hauler Operator" },
  { value: "facility_operator", label: "Facility Operator" },
  { value: "researcher", label: "Researcher" },
  { value: "other", label: "Other" },
];

export function RegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userType, setUserType] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    // Create the Supabase auth user
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, user_type: userType },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Insert public profile row if we got a user back (email confirm disabled)
    if (data.user) {
      await supabase.from("users").upsert({
        id: data.user.id,
        email,
        name,
        user_type: userType || null,
      });
    }

    router.push(next);
    router.refresh();
  };

  const handleGoogleRegister = async () => {
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) setError(error.message);
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Google OAuth */}
      <button
        type="button"
        onClick={handleGoogleRegister}
        className="w-full flex items-center justify-center gap-3 h-11 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors mb-6"
      >
        <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Sign up with Google
      </button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs text-gray-400">
          <span className="bg-white px-3">or create an account</span>
        </div>
      </div>

      <form onSubmit={handleRegister} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            Full name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
          />
        </div>

        <div>
          <label
            htmlFor="user-type"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            I am a… <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <select
            id="user-type"
            value={userType}
            onChange={(e) => setUserType(e.target.value)}
            className="w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F] text-gray-700"
          >
            <option value="">Select your role</option>
            {USER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
          />
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]/30 focus:border-[#2D6A4F]"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-lg bg-[#2D6A4F] text-white text-sm font-semibold hover:bg-[#245a42] disabled:opacity-60 transition-colors"
        >
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-6">
        Already have an account?{" "}
        <Link
          href={`/login${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
          prefetch={false}
          className="font-medium text-[#2D6A4F] hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
