import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";

export default function Page() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <div className="w-full max-w-md">
        <Suspense>
          <AuthCard mode="sign-up" />
        </Suspense>
      </div>
    </div>
  );
}
