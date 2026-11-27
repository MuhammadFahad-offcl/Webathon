"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExamForm } from "./exam-form";

export function NewExam() {
  const router = useRouter();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <Link href="/examiner/exams" className="text-sm text-blue-700 hover:underline dark:text-blue-300">
          ← All exams
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New exam</h1>
        <p className="text-sm opacity-70">
          The exam starts as a draft. Add questions and candidates next, then review and publish.
        </p>
      </div>
      <div className="rounded-xl border border-black/10 p-6 dark:border-white/15">
        <ExamForm
          exam={null}
          onSaved={(exam) => router.push(`/examiner/exams/${exam.id}`)}
          onCancel={() => router.push("/examiner/exams")}
        />
      </div>
    </div>
  );
}
