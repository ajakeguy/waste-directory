import { Suspense } from "react";
import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/RegisterForm";

export const metadata: Metadata = {
  title: "Create Account | WasteDirectory",
  description: "Create a free WasteDirectory account to save haulers and get personalized results.",
};

export default function RegisterPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#2D6A4F] text-white py-14 px-4 text-center">
        <h1 className="text-2xl font-bold mb-1">Create your account</h1>
        <p className="text-white/70 text-sm">Free access to the waste industry directory</p>
      </section>

      {/* Form card */}
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="bg-white rounded-xl border border-gray-200 p-8">
          <Suspense>
            <RegisterForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
