"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) {
      router.push("/meetings");
    } else {
      router.push("/login");
    }
  }, [isAuthenticated, router]);

  return <main>Loading...</main>;
}
