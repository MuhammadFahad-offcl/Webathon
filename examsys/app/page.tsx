import type { Metadata } from "next";
import { LandingPage } from "@/frontend/marketing/landing-page";

export const metadata: Metadata = {
  title: "A calmer, fairer way to take exams",
  description: "A secure, simple examination experience for students and educators.",
};

export default function Home() {
  return <LandingPage />;
}
