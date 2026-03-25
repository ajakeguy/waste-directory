import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign In | WasteDirectory",
  description: "Sign in to your WasteDirectory account to save haulers and manage your profile.",
};

export default function LoginPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#2D6A4F] text-white py-14 px-4 text-center">
        <h1 className="text-2xl font-bold mb-1">Welcome back</h1>
        <p className="text-white/70 text-sm">Sign in to your WasteDirectory account</p>
      </section>

      {/* Form card */}
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="bg-white rounded-xl border border-gray-200 p-8">
          {/* useSearchParams inside LoginForm requires Suspense */}
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
